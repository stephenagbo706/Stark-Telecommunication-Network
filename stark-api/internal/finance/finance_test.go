// Financial safety tests.
//
// Pure unit tests run always (`go test ./...`).
// Integration tests are gated behind environment variables so CI can run
// them against the Docker Compose stack:
//
//	STARK_TEST_DB_URL=postgres://stark:pass@localhost:5432/stark?sslmode=disable \
//	STARK_TEST_REDIS=localhost:6379 \
//	go test ./internal/finance/ -run Integration -race
package finance

import (
	"context"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"stark-api/internal/platform"
)

/* ====================== PURE UNIT TESTS ============================ */

func TestValidateEntries_RejectsUnbalanced(t *testing.T) {
	err := ValidateEntries([]Entry{
		{AccountKind: "WALLET", Direction: "DEBIT", AmountKobo: 200000},
		{AccountKind: "SETTLEMENT", Direction: "CREDIT", AmountKobo: 199999},
	})
	if err == nil || !strings.Contains(err.Error(), "unbalanced") {
		t.Fatalf("expected unbalanced posting error, got %v", err)
	}
}

func TestValidateEntries_RejectsNegativeOrZero(t *testing.T) {
	for _, amount := range []int64{0, -100} {
		err := ValidateEntries([]Entry{
			{AccountKind: "WALLET", Direction: "DEBIT", AmountKobo: amount},
			{AccountKind: "SETTLEMENT", Direction: "CREDIT", AmountKobo: amount},
		})
		if err == nil {
			t.Fatalf("expected positive-amount error for %d", amount)
		}
	}
}

func TestValidateEntries_RejectsSingleLeg(t *testing.T) {
	err := ValidateEntries([]Entry{{AccountKind: "WALLET", Direction: "DEBIT", AmountKobo: 100}})
	if err == nil {
		t.Fatal("single-leg posting must be rejected — double-entry requires balance")
	}
}

func TestValidateEntries_AcceptsBalancedMultiLeg(t *testing.T) {
	// ₦2,000 purchase with ₦50 fee: wallet debit 205000,
	// settlement credit 200000 + fee credit 5000.
	err := ValidateEntries([]Entry{
		{AccountKind: "WALLET", Direction: "DEBIT", AmountKobo: 205000},
		{AccountKind: "SETTLEMENT", Direction: "CREDIT", AmountKobo: 200000},
		{AccountKind: "FEE", Direction: "CREDIT", AmountKobo: 5000},
	})
	if err != nil {
		t.Fatalf("balanced multi-leg posting must pass: %v", err)
	}
}

func TestStateMachine_AllowedTransitions(t *testing.T) {
	allowed := [][2]string{
		{"PENDING", "PROCESSING"},
		{"PROCESSING", "SUCCESSFUL"},
		{"PROCESSING", "FAILED"},
		{"FAILED", "REFUNDED"},
		{"SUCCESSFUL", "REVERSED"},
	}
	for _, tr := range allowed {
		if !canTransition(tr[0], tr[1]) {
			t.Errorf("transition %s → %s must be allowed", tr[0], tr[1])
		}
	}
}

func TestStateMachine_ForbiddenTransitions(t *testing.T) {
	forbidden := [][2]string{
		{"PENDING", "SUCCESSFUL"},    // cannot skip provider confirmation
		{"SUCCESSFUL", "PROCESSING"}, // terminal states never go backwards
		{"FAILED", "SUCCESSFUL"},     // a failure cannot become success
		{"REVERSED", "SUCCESSFUL"},
	}
	for _, tr := range forbidden {
		if canTransition(tr[0], tr[1]) {
			t.Errorf("transition %s → %s must be forbidden", tr[0], tr[1])
		}
	}
}

func TestStarkRef_FormatAndUniqueness(t *testing.T) {
	pattern := regexp.MustCompile(`^STK-\d{8}-[0-9A-F]{8}$`)
	seen := map[string]bool{}
	for i := 0; i < 5000; i++ {
		ref := starkRef(time.Now())
		if !pattern.MatchString(ref) {
			t.Fatalf("ref %q does not match STK-YYYYMMDD-XXXXXXXX", ref)
		}
		if seen[ref] {
			t.Fatalf("duplicate ref generated: %s", ref)
		}
		seen[ref] = true
	}
}

/* ================== INTEGRATION (gated by env) ===================== */

func testModule(t *testing.T) (*Module, *pgxpool.Pool, *redis.Client) {
	t.Helper()
	dbURL := os.Getenv("STARK_TEST_DB_URL")
	if dbURL == "" {
		t.Skip("set STARK_TEST_DB_URL to run financial integration tests")
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("connect db: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: envOr("STARK_TEST_REDIS", "localhost:6379")})
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		t.Skipf("redis unavailable: %v", err)
	}
	cfg := platform.Config{
		Env: "test", DatabaseURL: dbURL,
		JWTAccessSecret: "test-access", JWTRefreshSecret: "test-refresh",
		PaystackBaseURL: "https://api.paystack.co",
	}
	return New(cfg, pool, rdb, slog.Default()), pool, rdb
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func seedUserWithWallet(t *testing.T, pool *pgxpool.Pool, balanceKobo int64) string {
	t.Helper()
	ctx := context.Background()
	uid := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, phone, password_hash) VALUES ($1,'08000000000','argon2id$test')`, uid); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO wallets (user_id, available_kobo) VALUES ($1,$2)`, uid, balanceKobo); err != nil {
		t.Fatalf("seed wallet: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM ledger_entries WHERE user_id=$1`, uid)
		_, _ = pool.Exec(ctx, `DELETE FROM wallets WHERE user_id=$1`, uid)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, uid)
	})
	return uid
}

// Double-spend defense: a wallet holding exactly ₦2,000 is attacked by
// 10 concurrent ₦2,000 reservations. Exactly ONE may succeed and the
// ledger must stay balanced — no negative balance, ever.
func TestIntegration_ConcurrentReserveNeverOverdraws(t *testing.T) {
	m, pool, _ := testModule(t)
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 200000) // ₦2,000

	const n = 10
	var wg sync.WaitGroup
	successes := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			successes <- m.ReserveFunds(ctx, uid, uuid.NewString(), 200000, uuid.NewString())
		}(i)
	}
	wg.Wait()
	close(successes)

	ok := 0
	for err := range successes {
		if err == nil {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("expected exactly 1 successful reserve, got %d — double spend!", ok)
	}

	var available, reserved int64
	if err := pool.QueryRow(ctx, `SELECT available_kobo, reserved_kobo FROM wallets WHERE user_id=$1`, uid).
		Scan(&available, &reserved); err != nil {
		t.Fatal(err)
	}
	if available != 0 || reserved != 200000 {
		t.Fatalf("balances wrong after concurrent reserve: available=%d reserved=%d", available, reserved)
	}

	// Every ledger posting must still sum to zero.
	var imbalance int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_kobo ELSE -amount_kobo END), 0)
		FROM ledger_entries WHERE user_id=$1`, uid).Scan(&imbalance); err != nil {
		t.Fatal(err)
	}
	if imbalance != 0 {
		t.Fatalf("ledger is unbalanced by %d kobo", imbalance)
	}
}

// Automatic reversal: reserve ₦2,000, provider fails, reverse.
// The wallet must return to exactly its starting balance.
func TestIntegration_ReserveThenReverseRestoresBalance(t *testing.T) {
	m, pool, _ := testModule(t)
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 1000000) // ₦10,000

	txID := uuid.NewString()
	if err := m.ReserveFunds(ctx, uid, txID, 200000, uuid.NewString()); err != nil {
		t.Fatalf("reserve: %v", err)
	}
	var available int64
	_ = pool.QueryRow(ctx, `SELECT available_kobo FROM wallets WHERE user_id=$1`, uid).Scan(&available)
	if available != 800000 {
		t.Fatalf("expected 800000 after reserve, got %d", available)
	}

	if err := m.Reverse(ctx, uid, txID, 200000, uuid.NewString()); err != nil {
		t.Fatalf("reverse: %v", err)
	}
	_ = pool.QueryRow(ctx, `SELECT available_kobo FROM wallets WHERE user_id=$1`, uid).Scan(&available)
	if available != 1000000 {
		t.Fatalf("reversal must restore the full balance: got %d", available)
	}
}

// Duplicate-webhook defense: the same Paystack reference can only be
// claimed for ledger credit once. A replayed webhook is a no-op.
func TestIntegration_DuplicateWebhookProcessedOnce(t *testing.T) {
	_, _, rdb := testModule(t)
	ctx := context.Background()
	ref := "PSK_" + uuid.NewString()

	first, err := platform.ClaimIdempotency(ctx, rdb, "webhook:"+ref, 24*time.Hour)
	if err != nil || !first {
		t.Fatalf("first webhook claim must succeed: first=%v err=%v", first, err)
	}
	second, err := platform.ClaimIdempotency(ctx, rdb, "webhook:"+ref, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if second {
		t.Fatal("replayed webhook must NOT be re-processed — duplicate credit blocked")
	}
}
