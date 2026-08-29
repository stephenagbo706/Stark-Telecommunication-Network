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
	"errors"
	"log/slog"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"stark-api/internal/payments"
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
	// Normalized identity columns are NOT NULL since migration 000002 —
	// every seed must satisfy them (unique per test user).
	suffix := strings.ReplaceAll(uid[:8], "-", "0")
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, email, email_normalized, phone, phone_normalized, password_hash)
		 VALUES ($1,$2,$2,$3,$4,'argon2id$test')`,
		uid, "seed-"+suffix+"@test.stark", "080"+suffix+"00", "+23480"+suffix+"00"); err != nil {
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

/* ================= PAYMENT SECURITY TESTS (§26) ======================
 *
 * These exercise the LIVE-MONEY funding path (settlePayment / webhook /
 * reconciler) against a real database with a stubbed gateway. The stub
 * is test-only; production wires payments.NewPaystack via finance.New.
 */

// stubGateway is a deterministic payments.Gateway for hermetic tests.
type stubGateway struct {
	verify    payments.VerifyResult
	verifyErr error
}

func (s *stubGateway) Name() string { return "paystack" }
func (s *stubGateway) Initialize(_ context.Context, req payments.InitRequest) (payments.InitResult, error) {
	return payments.InitResult{
		AuthorizationURL: "https://gateway.example/charge",
		AccessCode:       "test-access-code",
		Reference:        req.Reference,
	}, nil
}
func (s *stubGateway) Verify(_ context.Context, _ string) (payments.VerifyResult, error) {
	return s.verify, s.verifyErr
}
func (s *stubGateway) VerifyWebhookSignature(_ []byte, signature string) bool {
	return signature == "valid-sig"
}

func testPaymentModule(t *testing.T, gw payments.Gateway) (*Module, *pgxpool.Pool) {
	t.Helper()
	dbURL := os.Getenv("STARK_TEST_DB_URL")
	if dbURL == "" {
		t.Skip("set STARK_TEST_DB_URL to run payment security tests")
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
		PaystackSecretKey: "sk_test_unit_only", PaystackBaseURL: "https://api.paystack.co",
		APIBaseURL: "https://api.stark.test",
	}
	return NewWithGateway(cfg, pool, rdb, slog.Default()), pool
}

// seedPendingPayment inserts a PENDING funding payment owned by uid.
func seedPendingPayment(t *testing.T, pool *pgxpool.Pool, uid, ref string, amountKobo int64) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO payments (id, user_id, gateway, reference, amount_kobo, status)
		 VALUES ($1,$2,'paystack',$3,$4,'pending')`,
		uuid.NewString(), uid, ref, amountKobo); err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM ledger_entries WHERE idempotency_key=$1`, "fund:"+ref)
		_, _ = pool.Exec(ctx, `DELETE FROM payments WHERE reference=$1`, ref)
	})
}

func walletAvailable(t *testing.T, pool *pgxpool.Pool, uid string) int64 {
	t.Helper()
	var v int64
	if err := pool.QueryRow(context.Background(),
		`SELECT available_kobo FROM wallets WHERE user_id=$1`, uid).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func okVerify(amount int64) payments.VerifyResult {
	return payments.VerifyResult{Status: "success", AmountKobo: amount, Currency: "NGN", TransactionID: 424242, Channel: "card"}
}

// §26 Test 1 — a verified successful charge credits the wallet EXACTLY once.
func TestPayment_SuccessfulChargeCreditsOnce(t *testing.T) {
	m, pool := testPaymentModule(t, &stubGateway{verify: okVerify(1000000)})
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 0)
	ref := "STK-PAY-TEST-" + uuid.NewString()[:8]
	seedPendingPayment(t, pool, uid, ref, 1000000)

	outcome, err := m.settlePayment(ctx, ref, okVerify(1000000))
	if err != nil {
		t.Fatal(err)
	}
	if outcome != "credited" {
		t.Fatalf("expected credited, got %s", outcome)
	}
	if got := walletAvailable(t, pool, uid); got != 1000000 {
		t.Fatalf("wallet must hold exactly ₦10,000, got %d kobo", got)
	}
	var status string
	var provID *int64
	_ = pool.QueryRow(ctx, `SELECT status, provider_transaction_id FROM payments WHERE reference=$1`, ref).
		Scan(&status, &provID)
	if status != "successful" || provID == nil || *provID != 424242 {
		t.Fatalf("payment row wrong: status=%s provID=%v", status, provID)
	}
	// The credit must exist as an immutable ledger entry.
	var credits int
	_ = pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key=$1 AND account_kind='WALLET' AND direction='CREDIT'`,
		"fund:"+ref).Scan(&credits)
	if credits != 1 {
		t.Fatalf("expected exactly 1 WALLET CREDIT ledger entry, got %d", credits)
	}
}

// §26 Test 2 — the same settlement twice credits only once.
func TestPayment_DuplicateSettlementCreditsOnce(t *testing.T) {
	m, pool := testPaymentModule(t, &stubGateway{verify: okVerify(500000)})
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 0)
	ref := "STK-PAY-TEST-" + uuid.NewString()[:8]
	seedPendingPayment(t, pool, uid, ref, 500000)

	first, err := m.settlePayment(ctx, ref, okVerify(500000))
	if err != nil || first != "credited" {
		t.Fatalf("first settlement: %s / %v", first, err)
	}
	second, err := m.settlePayment(ctx, ref, okVerify(500000))
	if err != nil {
		t.Fatal(err)
	}
	if second != "duplicate" {
		t.Fatalf("second settlement must be duplicate, got %s", second)
	}
	if got := walletAvailable(t, pool, uid); got != 500000 {
		t.Fatalf("double credit! wallet=%d kobo", got)
	}
}

// §26 Test 3 — identical settlements racing concurrently credit ONCE.
func TestPayment_ConcurrentSettlementSingleCredit(t *testing.T) {
	m, pool := testPaymentModule(t, &stubGateway{verify: okVerify(250000)})
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 0)
	ref := "STK-PAY-TEST-" + uuid.NewString()[:8]
	seedPendingPayment(t, pool, uid, ref, 250000)

	const n = 10
	var wg sync.WaitGroup
	outcomes := make(chan string, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o, err := m.settlePayment(ctx, ref, okVerify(250000))
			if err != nil {
				o = "error"
			}
			outcomes <- o
		}()
	}
	wg.Wait()
	close(outcomes)
	credited := 0
	for o := range outcomes {
		if o == "credited" {
			credited++
		}
	}
	if credited != 1 {
		t.Fatalf("expected exactly 1 credited outcome, got %d — double credit race!", credited)
	}
	if got := walletAvailable(t, pool, uid); got != 250000 {
		t.Fatalf("wallet must hold exactly one credit: got %d kobo", got)
	}
}

// §26 Tests 4 + 7 — a tampered signature is rejected (401) and an unknown
// reference is ignored; neither moves money.
func TestPayment_WebhookBadSignatureAndUnknownRef(t *testing.T) {
	m, pool := testPaymentModule(t, &stubGateway{verify: okVerify(1000000)})
	uid := seedUserWithWallet(t, pool, 0)
	_ = uid

	// 4. Tampered signature ⇒ 401, nothing processed.
	body := `{"event":"charge.success","data":{"reference":"STK-PAY-EVIL-1"}}`
	req := httptest.NewRequest("POST", "/api/v1/payments/webhook/paystack", strings.NewReader(body))
	req.Header.Set("x-paystack-signature", "forged")
	rec := httptest.NewRecorder()
	m.PaystackWebhook(rec, req)
	if rec.Code != 401 {
		t.Fatalf("forged signature must be rejected, got %d", rec.Code)
	}

	// 7. Valid signature but UNKNOWN reference ⇒ 200, no credit.
	req = httptest.NewRequest("POST", "/api/v1/payments/webhook/paystack", strings.NewReader(body))
	req.Header.Set("x-paystack-signature", "valid-sig")
	rec = httptest.NewRecorder()
	m.PaystackWebhook(rec, req)
	if rec.Code != 200 {
		t.Fatalf("unknown reference must be acknowledged, got %d", rec.Code)
	}
	if got := walletAvailable(t, pool, uid); got != 0 {
		t.Fatalf("no money may move for unknown references: wallet=%d", got)
	}
}

// §26 Test 5 — amount mismatch ⇒ discrepancy recorded, NO credit.
func TestPayment_AmountMismatchNoCredit(t *testing.T) {
	m, pool := testPaymentModule(t, &stubGateway{})
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 0)
	ref := "STK-PAY-TEST-" + uuid.NewString()[:8]
	seedPendingPayment(t, pool, uid, ref, 1000000) // customer authorized ₦10,000

	// Gateway reports only ₦1,000 — Stark must NOT credit ₦10,000 (or anything).
	outcome, err := m.settlePayment(ctx, ref, okVerify(100000))
	if err != nil {
		t.Fatal(err)
	}
	if outcome != "amount_mismatch" {
		t.Fatalf("expected amount_mismatch, got %s", outcome)
	}
	if got := walletAvailable(t, pool, uid); got != 0 {
		t.Fatalf("amount mismatch must not credit: wallet=%d", got)
	}
	var status, reason string
	_ = pool.QueryRow(ctx, `SELECT status, COALESCE(failure_reason,'') FROM payments WHERE reference=$1`, ref).
		Scan(&status, &reason)
	if status != "failed" || reason != "amount_mismatch" {
		t.Fatalf("discrepancy must be recorded for review: %s/%s", status, reason)
	}
}

// §26 Test 6 — currency mismatch ⇒ NO credit.
func TestPayment_CurrencyMismatchNoCredit(t *testing.T) {
	m, pool := testPaymentModule(t, &stubGateway{})
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 0)
	ref := "STK-PAY-TEST-" + uuid.NewString()[:8]
	seedPendingPayment(t, pool, uid, ref, 1000000)

	bad := okVerify(1000000)
	bad.Currency = "USD"
	outcome, err := m.settlePayment(ctx, ref, bad)
	if err != nil {
		t.Fatal(err)
	}
	if outcome != "currency_mismatch" {
		t.Fatalf("expected currency_mismatch, got %s", outcome)
	}
	if got := walletAvailable(t, pool, uid); got != 0 {
		t.Fatalf("currency mismatch must not credit: wallet=%d", got)
	}
}

// §26 Test 8 — an already-successful payment cannot be credited again.
func TestPayment_AlreadySuccessfulNoSecondCredit(t *testing.T) {
	m, pool := testPaymentModule(t, &stubGateway{})
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 0)
	ref := "STK-PAY-TEST-" + uuid.NewString()[:8]
	seedPendingPayment(t, pool, uid, ref, 300000)

	if o, err := m.settlePayment(ctx, ref, okVerify(300000)); err != nil || o != "credited" {
		t.Fatalf("first: %s/%v", o, err)
	}
	// Simulate a very late webhook for the same charge.
	o, err := m.settlePayment(ctx, ref, okVerify(300000))
	if err != nil || o != "duplicate" {
		t.Fatalf("late replay must be duplicate: %s/%v", o, err)
	}
	if got := walletAvailable(t, pool, uid); got != 300000 {
		t.Fatalf("second credit detected: wallet=%d", got)
	}
}

// §26 — abandoned/failed gateway outcomes are recorded honestly with no credit.
func TestPayment_FailedGatewayStatusNoCredit(t *testing.T) {
	m, pool := testPaymentModule(t, &stubGateway{})
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 0)
	ref := "STK-PAY-TEST-" + uuid.NewString()[:8]
	seedPendingPayment(t, pool, uid, ref, 200000)

	failed := okVerify(200000)
	failed.Status = "abandoned"
	outcome, err := m.settlePayment(ctx, ref, failed)
	if err != nil {
		t.Fatal(err)
	}
	if outcome != "gateway_failed" {
		t.Fatalf("expected gateway_failed, got %s", outcome)
	}
	if got := walletAvailable(t, pool, uid); got != 0 {
		t.Fatalf("abandoned payment must not credit: wallet=%d", got)
	}
	var status string
	_ = pool.QueryRow(ctx, `SELECT status FROM payments WHERE reference=$1`, ref).Scan(&status)
	if status != "abandoned" {
		t.Fatalf("status must be abandoned, got %s", status)
	}
}

// §26 Tests 9 + 10 — the reconciler settles a stuck PENDING payment once
// the gateway becomes reachable again (customer closed the app mid-pay),
// and leaves payments untouched while verification is unavailable.
func TestPayment_ReconcilerSettlesStuckPending(t *testing.T) {
	gw := &stubGateway{verifyErr: errors.New("gateway down")}
	m, pool := testPaymentModule(t, gw)
	ctx := context.Background()
	uid := seedUserWithWallet(t, pool, 0)
	ref := "STK-PAY-TEST-" + uuid.NewString()[:8]
	seedPendingPayment(t, pool, uid, ref, 750000)
	// Age the payment past the 5-minute webhook window.
	if _, err := pool.Exec(ctx,
		`UPDATE payments SET created_at = now() - interval '10 minutes' WHERE reference=$1`, ref); err != nil {
		t.Fatal(err)
	}

	// Pass 1: gateway unavailable ⇒ payment stays pending, wallet untouched.
	m.reconcilePaymentsOnce(ctx)
	if got := walletAvailable(t, pool, uid); got != 0 {
		t.Fatalf("unverifiable payment must not credit: wallet=%d", got)
	}
	var status string
	_ = pool.QueryRow(ctx, `SELECT status FROM payments WHERE reference=$1`, ref).Scan(&status)
	if status != "pending" {
		t.Fatalf("payment must remain pending while unverifiable, got %s", status)
	}

	// Pass 2: gateway recovers ⇒ exactly one credit, terminal state.
	gw.verifyErr = nil
	gw.verify = okVerify(750000)
	m.reconcilePaymentsOnce(ctx)
	m.reconcilePaymentsOnce(ctx) // a second pass must be a no-op (idempotent)
	if got := walletAvailable(t, pool, uid); got != 750000 {
		t.Fatalf("reconciler must credit exactly once: wallet=%d", got)
	}
	_ = pool.QueryRow(ctx, `SELECT status FROM payments WHERE reference=$1`, ref).Scan(&status)
	if status != "successful" {
		t.Fatalf("payment must be successful after reconciliation, got %s", status)
	}
}

// Stark payment references are crypto-random, correctly shaped, unique.
func TestPayRef_FormatAndUniqueness(t *testing.T) {
	pattern := regexp.MustCompile(`^STK-PAY-\d{8}-[0-9A-F]{8}$`)
	seen := map[string]bool{}
	for i := 0; i < 5000; i++ {
		ref := payRef(time.Now())
		if !pattern.MatchString(ref) {
			t.Fatalf("ref %q does not match STK-PAY-YYYYMMDD-XXXXXXXX", ref)
		}
		if seen[ref] {
			t.Fatalf("duplicate payment ref generated: %s", ref)
		}
		seen[ref] = true
	}
}
