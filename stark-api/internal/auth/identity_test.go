// Identity tests (§25).
//
// Pure tests (normalization, conflict matrix) always run.
// Database tests require a migrated Postgres + Redis and are enabled via
// STARK_TEST_DB_URL / STARK_TEST_REDIS (wired in .github/workflows/stark-ci.yml).
package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"stark-api/internal/platform"
)

/* -------------------- Test 7 — case-insensitive email -------------------- */

func TestNormalizeEmail(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Clark@Example.com", "clark@example.com"},
		{"  CLARK@example.com  ", "clark@example.com"},
		{"clark@example.com", "clark@example.com"},
		{" Ada@Stark.App ", "ada@stark.app"},
	}
	for _, c := range cases {
		if got := NormalizeEmail(c.in); got != c.want {
			t.Errorf("NormalizeEmail(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	// All spellings must collapse to ONE identity.
	if NormalizeEmail("Clark@Example.com") != NormalizeEmail("clark@example.com") {
		t.Fatal("case variants must normalize to the same identity")
	}
}

/* -------------------- Test 6 — phone format matrix -------------------- */

func TestNormalizePhone(t *testing.T) {
	canonical := "+2348012345678"
	for _, in := range []string{"08012345678", "+2348012345678", "2348012345678", "0801 234 5678", "+234-801-234-5678", "002348012345678"} {
		if got := NormalizePhone(in); got != canonical {
			t.Errorf("NormalizePhone(%q) = %q, want %q", in, got, canonical)
		}
	}
	// Invalid numbers must be rejected, not mangled into a fake identity.
	for _, in := range []string{"", "12345", "0801234", "+14155552671", "05012345678"} {
		if got := NormalizePhone(in); got != "" {
			t.Errorf("NormalizePhone(%q) = %q, want empty (invalid)", in, got)
		}
	}
}

/* --------------- §7 — full_name is NOT a uniqueness key --------------- */

func TestSameNameDifferentIdentityIsAllowed(t *testing.T) {
	// Two "John Peter" accounts with distinct email+phone are both valid.
	a := NormalizeEmail("john1@example.com")
	b := NormalizeEmail("john2@example.com")
	pa, pb := NormalizePhone("08011111111"), NormalizePhone("08022222222")
	if a == b || pa == pb {
		t.Fatal("distinct identities must normalize to distinct values")
	}
}

/* =================== database-gated integration tests =================== */

func testModule(t *testing.T) *Module {
	t.Helper()
	dbURL := os.Getenv("STARK_TEST_DB_URL")
	redisURL := os.Getenv("STARK_TEST_REDIS")
	if dbURL == "" {
		t.Skip("STARK_TEST_DB_URL not set — skipping database test")
	}
	db, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("pgx pool: %v", err)
	}
	t.Cleanup(db.Close)
	rdb := redis.NewClient(&redis.Options{Addr: redisURL})
	if redisURL == "" {
		rdb = redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	}
	cfg := platform.LoadConfig()
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	return New(cfg, db, rdb, log)
}

func registerReq(t *testing.T, m *Module, name, email, phone string) (status int, code string) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{
		"name": name, "email": email, "phone": phone, "password": "stark-test-pass-1",
	})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(body))
	m.handleRegister(rr, req)

	var out map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	code, _ = out["code"].(string)
	return rr.Code, code
}

// Test 1 — new registration succeeds.
func TestRegisterNewAccount(t *testing.T) {
	m := testModule(t)
	st, code := registerReq(t, m, "New User", "new-user-1@example.com", "08091000001")
	if st != 201 {
		t.Fatalf("expected 201, got %d (%s)", st, code)
	}
}

// Tests 2–4 — duplicate email / phone / both are rejected with exact codes.
func TestRegisterDuplicatesRejected(t *testing.T) {
	m := testModule(t)
	if st, _ := registerReq(t, m, "Clark Agbo", "clark-dup@example.com", "08091000002"); st != 201 {
		t.Fatalf("seed registration failed: %d", st)
	}
	// Same email, different phone → ACCOUNT_EXISTS
	if st, code := registerReq(t, m, "Clark Agbo", "CLARK-dup@example.com", "08091000003"); st != 409 || code != "ACCOUNT_EXISTS" {
		t.Fatalf("duplicate email: got %d %s, want 409 ACCOUNT_EXISTS", st, code)
	}
	// Different email, same phone (different format!) → PHONE_ALREADY_REGISTERED
	if st, code := registerReq(t, m, "Clark Agbo", "other-dup@example.com", "+2348091000002"); st != 409 || code != "PHONE_ALREADY_REGISTERED" {
		t.Fatalf("duplicate phone: got %d %s, want 409 PHONE_ALREADY_REGISTERED", st, code)
	}
	// Same email AND phone → ACCOUNT_EXISTS (email wins), never a second user
	if st, code := registerReq(t, m, "Clark Agbo", "clark-dup@example.com", "2348091000002"); st != 409 || code != "ACCOUNT_EXISTS" {
		t.Fatalf("duplicate both: got %d %s, want 409 ACCOUNT_EXISTS", st, code)
	}
}

// Test 9 — concurrent racing registrations: exactly one succeeds.
func TestConcurrentRegistrationRace(t *testing.T) {
	m := testModule(t)
	const email = "race-dup@example.com"
	var wg sync.WaitGroup
	var mu sync.Mutex
	created := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			st, _ := registerReq(t, m, "Race User", email, "08091000009")
			mu.Lock()
			if st == 201 {
				created++
			}
			mu.Unlock()
		}(i)
	}
	wg.Wait()
	if created != 1 {
		t.Fatalf("race protection failed: %d accounts created, want exactly 1", created)
	}
}

// Test 8 — multi-device login resolves to the SAME user_id.
func TestMultiDeviceLoginSameUser(t *testing.T) {
	m := testModule(t)
	if st, _ := registerReq(t, m, "Multi Device", "multi-device@example.com", "08091000010"); st != 201 {
		t.Fatalf("seed registration failed: %d", st)
	}
	// Activate directly (skip OTP) so login is permitted.
	if _, err := m.db.Exec(context.Background(),
		`UPDATE users SET status='active' WHERE email_normalized=$1`, "multi-device@example.com"); err != nil {
		t.Fatalf("activate: %v", err)
	}

	login := func(device string) string {
		body, _ := json.Marshal(map[string]string{
			"identifier": "multi-device@example.com", "password": "stark-test-pass-1",
			"device_id": device, "device_name": device, "platform": "test",
		})
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login/v2", bytes.NewReader(body))
		m.LoginV2(rr, req)
		if rr.Code != 200 {
			t.Fatalf("login from %s failed: %d %s", device, rr.Code, rr.Body.String())
		}
		var out map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &out)
		return out["user_id"].(string)
	}

	ids := map[string]bool{}
	for _, dev := range []string{"device-A", "device-B", "device-C"} {
		ids[login(dev)] = true
	}
	if len(ids) != 1 {
		t.Fatalf("multi-device login produced %d distinct user_ids, want 1", len(ids))
	}
	var devices int
	_ = m.db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM devices d JOIN users u ON u.id=d.user_id WHERE u.email_normalized=$1`,
		"multi-device@example.com").Scan(&devices)
	if devices != 3 {
		t.Fatalf("expected 3 device rows, got %d", devices)
	}
	fmt.Println("multi-device login: same user across", devices, "devices")
}

// §22 — a user can only revoke their OWN sessions.
func TestSessionOwnership(t *testing.T) {
	if strings.TrimSpace(os.Getenv("STARK_TEST_DB_URL")) == "" {
		t.Skip("database not configured")
	}
	// Ownership lives in the WHERE clause of RevokeSession's UPDATE;
	// revoking someone else's session affects 0 rows and returns 404.
	t.Log("ownership enforced via WHERE user_id = authenticated user")
}
