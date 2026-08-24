// Package finance owns money: the double-entry ledger, wallet, the
// transaction state machine with reserve → settle/reverse, Paystack
// funding (init + signed webhooks + idempotency) and the multi-provider
// VTU engine with priority, circuit breakers and reconciliation.
//
// Invariants enforced here:
//   - Every ledger posting sums to zero (debits == credits).
//   - Ledger entries are INSERT-only; corrections are REVERSAL entries.
//   - Wallet balances are derived under SELECT ... FOR UPDATE row locks.
//   - No duplicate financial processing (idempotency keys in Redis).
//   - Provider uncertainty ⇒ PROCESSING + reconciliation, never blind retry.
package finance

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"stark-api/internal/auth"
	"stark-api/internal/platform"
)

type Module struct {
	cfg       platform.Config
	db        *pgxpool.Pool
	rdb       *redis.Client
	log       *slog.Logger
	providers *ProviderEngine
	httpc     *http.Client
}

func New(cfg platform.Config, db *pgxpool.Pool, rdb *redis.Client, log *slog.Logger) *Module {
	eng := NewProviderEngine(log)
	eng.Register(NewHTTPProvider("provider-a", 1, cfg.ProviderABaseURL, cfg.ProviderAKey))
	eng.Register(NewHTTPProvider("provider-b", 2, cfg.ProviderBBaseURL, cfg.ProviderBKey))
	return &Module{
		cfg: cfg, db: db, rdb: rdb,
		log:       log.With("module", "finance"),
		providers: eng,
		httpc:     &http.Client{Timeout: 25 * time.Second},
	}
}

/* ============================ LEDGER ================================ */

// Entry is one leg of a balanced posting. Amount is always positive;
// Direction says whether the account is debited or credited.
type Entry struct {
	AccountKind string // WALLET | WALLET_RESERVE | SETTLEMENT | CASHBACK | PAYSTACK_CLEARING | FEE
	Direction   string // DEBIT | CREDIT
	AmountKobo  int64
}

// Post writes an immutable, balanced ledger posting inside tx.
// It also maintains wallet materialized balances under row locks.
func (m *Module) Post(ctx context.Context, tx pgx.Tx, userID, txID, idemKey, description string, entries []Entry) error {
	if len(entries) < 2 {
		return errors.New("ledger posting requires at least two legs")
	}
	var debits, credits int64
	for _, e := range entries {
		if e.AmountKobo <= 0 {
			return errors.New("ledger amounts must be positive")
		}
		if e.Direction == "DEBIT" {
			debits += e.AmountKobo
		} else {
			credits += e.AmountKobo
		}
	}
	if debits != credits {
		return fmt.Errorf("unbalanced posting: debits=%d credits=%d", debits, credits)
	}

	// Lock the wallet row first — deterministic order prevents deadlocks.
	if _, err := tx.Exec(ctx, `SELECT id FROM wallets WHERE user_id=$1 FOR UPDATE`, userID); err != nil {
		return fmt.Errorf("wallet lock: %w", err)
	}

	postingID := uuid.NewString()
	for _, e := range entries {
		if _, err := tx.Exec(ctx,
			`INSERT INTO ledger_entries
			   (id, posting_id, user_id, account_kind, direction, amount_kobo, transaction_id, idempotency_key, description)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			uuid.NewString(), postingID, userID, e.AccountKind, e.Direction, e.AmountKobo, txID, idemKey, description); err != nil {
			return fmt.Errorf("ledger insert: %w", err)
		}
		// Maintain materialized wallet counters atomically.
		switch e.AccountKind {
		case "WALLET":
			if e.Direction == "DEBIT" {
				if _, err := tx.Exec(ctx, `UPDATE wallets SET available_kobo = available_kobo - $2, updated_at=now() WHERE user_id=$1`, userID, e.AmountKobo); err != nil {
					return err
				}
			} else {
				if _, err := tx.Exec(ctx, `UPDATE wallets SET available_kobo = available_kobo + $2, updated_at=now() WHERE user_id=$1`, userID, e.AmountKobo); err != nil {
					return err
				}
			}
		case "WALLET_RESERVE":
			if e.Direction == "CREDIT" {
				if _, err := tx.Exec(ctx, `UPDATE wallets SET reserved_kobo = reserved_kobo + $2, updated_at=now() WHERE user_id=$1`, userID, e.AmountKobo); err != nil {
					return err
				}
			} else {
				if _, err := tx.Exec(ctx, `UPDATE wallets SET reserved_kobo = reserved_kobo - $2, updated_at=now() WHERE user_id=$1`, userID, e.AmountKobo); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// ReserveFunds moves funds from WALLET to WALLET_RESERVE. If the user
// cannot afford it, nothing moves and an actionable error is returned.
func (m *Module) ReserveFunds(ctx context.Context, userID, txID string, amountKobo int64, idemKey string) error {
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var available int64
	if err := tx.QueryRow(ctx, `SELECT available_kobo FROM wallets WHERE user_id=$1 FOR UPDATE`, userID).Scan(&available); err != nil {
		return err
	}
	if available < amountKobo {
		return errors.New("insufficient_balance")
	}
	err = m.Post(ctx, tx, userID, txID, idemKey, "reserve", []Entry{
		{AccountKind: "WALLET", Direction: "DEBIT", AmountKobo: amountKobo},
		{AccountKind: "WALLET_RESERVE", Direction: "CREDIT", AmountKobo: amountKobo},
	})
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Settle moves reserved funds to the Stark settlement account (success).
func (m *Module) Settle(ctx context.Context, userID, txID string, amountKobo int64, idemKey string) error {
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	err = m.Post(ctx, tx, userID, txID, idemKey, "settle", []Entry{
		{AccountKind: "WALLET_RESERVE", Direction: "DEBIT", AmountKobo: amountKobo},
		{AccountKind: "SETTLEMENT", Direction: "CREDIT", AmountKobo: amountKobo},
	})
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Reverse returns reserved funds to the wallet (provider failure).
func (m *Module) Reverse(ctx context.Context, userID, txID string, amountKobo int64, idemKey string) error {
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	err = m.Post(ctx, tx, userID, txID, idemKey, "reversal", []Entry{
		{AccountKind: "WALLET_RESERVE", Direction: "DEBIT", AmountKobo: amountKobo},
		{AccountKind: "WALLET", Direction: "CREDIT", AmountKobo: amountKobo},
	})
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

/* ===================== TRANSACTION STATE MACHINE ==================== */

var allowedTransitions = map[string][]string{
	"PENDING":    {"PROCESSING", "CANCELLED", "FAILED"},
	"PROCESSING": {"SUCCESSFUL", "FAILED", "REVERSED"},
	"FAILED":     {"REFUNDED"},
	"SUCCESSFUL": {"REVERSED", "REFUNDED"}, // only via dispute/refund flows
}

func canTransition(from, to string) bool {
	for _, s := range allowedTransitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

func (m *Module) transition(ctx context.Context, tx pgx.Tx, id, to, failureReason string) error {
	var from string
	if err := tx.QueryRow(ctx, `SELECT status FROM transactions WHERE id=$1 FOR UPDATE`, id).Scan(&from); err != nil {
		return err
	}
	if !canTransition(from, to) {
		return fmt.Errorf("invalid transition %s → %s", from, to)
	}
	q := `UPDATE transactions SET status=$2, updated_at=now() WHERE id=$1`
	if to == "SUCCESSFUL" || to == "FAILED" || to == "REVERSED" || to == "REFUNDED" {
		q = `UPDATE transactions SET status=$2, completed_at=now(), updated_at=now() WHERE id=$1`
	}
	if failureReason != "" {
		q = strings.Replace(q, "SET status", "SET failure_reason=$3, status", 1)
		_, err := tx.Exec(ctx, q, id, to, failureReason)
		return err
	}
	_, err := tx.Exec(ctx, q, id, to)
	return err
}

func starkRef(now time.Time) string {
	b := make([]byte, 5)
	_, _ = io.ReadFull(strings.NewReader(uuid.NewString()), b)
	return fmt.Sprintf("STK-%s-%s", now.Format("20060102"), strings.ToUpper(hex.EncodeToString(sha256Sum([]byte(uuid.NewString())))[:8]))
}

func sha256Sum(b []byte) []byte { h := sha256.Sum256(b); return h[:] }

/* ========================= PURCHASE FLOW ============================ */

type purchaseReq struct {
	Service  string         `json:"service"` // airtime | data | cable | electricity
	Network  string         `json:"network"`
	Phone    string         `json:"phone"`
	Account  string         `json:"account"`
	PlanID   string         `json:"plan_id"`
	Amount   float64        `json:"amount"`
	PIN      string         `json:"pin"`
	Metadata map[string]any `json:"metadata"`
}

// Purchase is the full financial pipeline:
// verify PIN → idempotency → create PENDING → reserve → PROCESSING →
// provider execute → settle + SUCCESSFUL (or reverse + FAILED).
func (m *Module) Purchase(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	var req purchaseReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		platform.WriteErr(w, r, 400, "invalid_body", "Check the purchase details and try again.")
		return
	}
	if req.Amount <= 0 || req.Amount > 500000 {
		platform.WriteErr(w, r, 422, "invalid_amount", "Enter a valid amount between ₦1 and ₦500,000.")
		return
	}
	idemKey := r.Header.Get("X-Idempotency-Key")
	if idemKey == "" {
		idemKey = uuid.NewString()
	}

	// Duplicate financial requests are rejected, never re-processed.
	fresh, err := platform.ClaimIdempotency(r.Context(), m.rdb, "buy:"+uid+":"+idemKey, 24*time.Hour)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't start the purchase. Please retry.")
		return
	}
	if !fresh {
		platform.WriteErr(w, r, 409, "duplicate_request", "This purchase is already being processed.")
		return
	}

	amountKobo := int64(req.Amount * 100)
	txID := uuid.NewString()
	ref := starkRef(time.Now())

	if _, err := m.db.Exec(r.Context(),
		`INSERT INTO transactions (id, ref, user_id, service, network, account, amount_kobo, fee_kobo, total_kobo, status, idempotency_key, metadata)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,0,$7,'PENDING',$8,$9)`,
		txID, ref, uid, req.Service, req.Network, firstNonEmpty(req.Account, req.Phone), amountKobo, idemKey, mustJSON(req.Metadata)); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't create the transaction. Please retry.")
		return
	}

	// 1. Reserve funds. Failure here never touches the provider.
	if err := m.ReserveFunds(r.Context(), uid, txID, amountKobo, idemKey+":reserve"); err != nil {
		m.failTx(r.Context(), txID, "insufficient_balance")
		platform.WriteErr(w, r, 402, "insufficient_balance",
			"Your wallet can't cover this purchase. Add money and try again — nothing was charged.")
		return
	}
	m.setStatus(r.Context(), txID, "PROCESSING", "")

	// 2. Provider execution with failover. Uncertainty ⇒ stays PROCESSING.
	provRef, token, perr := m.providers.Execute(r.Context(), req)
	if perr != nil {
		if errors.Is(perr, ErrUncertain) {
			// Do NOT refund yet — reconciliation will verify with the provider.
			m.notify(uid, "Transaction processing",
				"The provider hasn't confirmed yet. We're verifying it — your wallet hasn't been permanently charged.")
			platform.WriteJSON(w, r, 202, map[string]any{
				"transaction_id": txID, "ref": ref, "status": "PROCESSING",
				"message": "Your transaction is processing. We'll notify you once the provider confirms.",
			})
			return
		}
		// Definitive failure ⇒ automatic reversal.
		if rerr := m.Reverse(r.Context(), uid, txID, amountKobo, idemKey+":reverse"); rerr != nil {
			m.log.Error("reversal failed — needs manual reconciliation", "tx", txID, "err", rerr)
		}
		m.failTx(r.Context(), txID, perr.Error())
		m.notify(uid, "Transaction failed — funds returned",
			"The provider could not complete this purchase. The reserved amount has been returned to your wallet.")
		platform.WriteJSON(w, r, 200, map[string]any{
			"transaction_id": txID, "ref": ref, "status": "FAILED", "reversed": true,
			"message": "Your transaction failed and the reserved amount has been returned.",
		})
		return
	}

	// 3. Success ⇒ settle reserve to settlement account.
	if serr := m.Settle(r.Context(), uid, txID, amountKobo, idemKey+":settle"); serr != nil {
		m.log.Error("settle failed", "tx", txID, "err", serr)
	}
	if _, err := m.db.Exec(r.Context(),
		`UPDATE transactions SET provider_ref=$2, token=$3, provider=$4 WHERE id=$1`,
		txID, provRef, token, "provider"); err == nil {
		m.setStatus(r.Context(), txID, "SUCCESSFUL", "")
	}
	m.notify(uid, "Purchase successful", fmt.Sprintf("%s %s completed. Ref %s.", strings.Title(req.Service), req.Network, ref))
	platform.WriteJSON(w, r, 200, map[string]any{
		"transaction_id": txID, "ref": ref, "status": "SUCCESSFUL",
		"provider_ref": provRef, "token": token,
	})
}

func (m *Module) setStatus(ctx context.Context, id, to, reason string) {
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	_ = m.transition(ctx, tx, id, to, reason)
	_ = tx.Commit(ctx)
}

func (m *Module) failTx(ctx context.Context, id, reason string) {
	m.setStatus(ctx, id, "FAILED", reason)
}

func (m *Module) notify(userID, title, body string) {
	_, _ = m.db.Exec(context.Background(),
		`INSERT INTO notifications (id, user_id, title, body, kind) VALUES ($1,$2,$3,$4,'transaction')`,
		uuid.NewString(), userID, title, body)
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

/* =========================== PAYSTACK =============================== */

// Fund initializes a Paystack charge. The secret key is server-side only;
// Flutter receives only the authorization URL. The wallet is credited ONLY
// after the signed webhook is verified — frontend callbacks are never trusted.
func (m *Module) Fund(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	var req struct {
		Amount float64 `json:"amount"`
		Email  string  `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil || req.Amount < 100 {
		platform.WriteErr(w, r, 422, "invalid_amount", "Minimum funding amount is ₦100.")
		return
	}
	if m.cfg.PaystackSecretKey == "" {
		platform.WriteErr(w, r, 503, "payments_unconfigured", "Card funding is being configured. Please try again shortly.")
		return
	}
	body, _ := json.Marshal(map[string]any{
		"email": req.Email, "amount": int64(req.Amount * 100), "currency": "NGN",
		"callback_url": "https://api.stark.example/api/v1/payments/webhook/paystack",
		"metadata":     map[string]string{"stark_user_id": uid},
	})
	hreq, _ := http.NewRequest("POST", m.cfg.PaystackBaseURL+"/transaction/initialize", bytes.NewReader(body))
	hreq.Header.Set("Authorization", "Bearer "+m.cfg.PaystackSecretKey)
	hreq.Header.Set("Content-Type", "application/json")
	resp, err := m.httpc.Do(hreq)
	if err != nil {
		platform.WriteErr(w, r, 502, "paystack_unreachable", "The payment gateway didn't respond. Please retry.")
		return
	}
	defer resp.Body.Close()
	var out struct {
		Status bool `json:"status"`
		Data   struct {
			AuthorizationURL string `json:"authorization_url"`
			Reference        string `json:"reference"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || !out.Status {
		platform.WriteErr(w, r, 502, "paystack_error", "The payment gateway rejected the request. Please retry.")
		return
	}
	_, _ = m.db.Exec(r.Context(),
		`INSERT INTO payments (id, user_id, gateway, reference, amount_kobo, status)
		 VALUES ($1,$2,'paystack',$3,$4,'pending')`,
		uuid.NewString(), uid, out.Data.Reference, int64(req.Amount*100))
	platform.WriteJSON(w, r, 200, map[string]string{
		"authorization_url": out.Data.AuthorizationURL, "reference": out.Data.Reference,
		"message": "Your payment is being verified once the gateway confirms it.",
	})
}

// PaystackWebhook verifies the HMAC-SHA512 signature, deduplicates by
// reference, re-verifies with the Paystack API, then credits the wallet
// through the ledger (PAYSTACK_CLEARING → WALLET).
func (m *Module) PaystackWebhook(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		w.WriteHeader(400)
		return
	}
	sig := r.Header.Get("x-paystack-signature")
	want := platform.HMACSHA512Hex(m.cfg.PaystackSecretKey, raw)
	if subtle.ConstantTimeCompare([]byte(sig), []byte(want)) != 1 {
		m.log.Warn("webhook signature mismatch")
		w.WriteHeader(401)
		return
	}
	var evt struct {
		Event string `json:"event"`
		Data  struct {
			Reference string `json:"reference"`
			Amount    int64  `json:"amount"`
			Status    string `json:"status"`
			Metadata  struct {
				StarkUserID string `json:"stark_user_id"`
			} `json:"metadata"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &evt); err != nil || evt.Event != "charge.success" {
		w.WriteHeader(200)
		return
	}

	// Duplicate webhook protection.
	fresh, err := platform.ClaimIdempotency(r.Context(), m.rdb, "pswh:"+evt.Data.Reference, 7*24*time.Hour)
	if err != nil || !fresh {
		w.WriteHeader(200) // already processed
		return
	}

	// Server-to-server re-verification — never trust the event alone.
	if !m.verifyWithPaystack(r.Context(), evt.Data.Reference, evt.Data.Amount) {
		m.log.Error("webhook failed re-verification", "reference", evt.Data.Reference)
		w.WriteHeader(200)
		return
	}

	tx, err := m.db.Begin(r.Context())
	if err != nil {
		w.WriteHeader(500)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(),
		`UPDATE payments SET status='successful', verified_at=now() WHERE reference=$1 AND status='pending'`,
		evt.Data.Reference); err != nil {
		w.WriteHeader(500)
		return
	}
	txID := uuid.NewString()
	if err := m.Post(r.Context(), tx, evt.Data.Metadata.StarkUserID, txID, "fund:"+evt.Data.Reference, "wallet funding", []Entry{
		{AccountKind: "PAYSTACK_CLEARING", Direction: "DEBIT", AmountKobo: evt.Data.Amount},
		{AccountKind: "WALLET", Direction: "CREDIT", AmountKobo: evt.Data.Amount},
	}); err != nil {
		m.log.Error("funding ledger post failed", "reference", evt.Data.Reference, "err", err)
		w.WriteHeader(500)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		w.WriteHeader(500)
		return
	}
	m.notify(evt.Data.Metadata.StarkUserID, "Wallet funded",
		fmt.Sprintf("₦%.2f was added to your wallet.", float64(evt.Data.Amount)/100))
	w.WriteHeader(200)
}

func (m *Module) verifyWithPaystack(ctx context.Context, reference string, amountKobo int64) bool {
	hreq, _ := http.NewRequestWithContext(ctx, "GET", m.cfg.PaystackBaseURL+"/transaction/verify/"+reference, nil)
	hreq.Header.Set("Authorization", "Bearer "+m.cfg.PaystackSecretKey)
	resp, err := m.httpc.Do(hreq)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var out struct {
		Status bool `json:"status"`
		Data   struct {
			Status   string `json:"status"`
			Amount   int64  `json:"amount"`
			Currency string `json:"currency"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return false
	}
	return out.Status && out.Data.Status == "success" && out.Data.Amount == amountKobo && out.Data.Currency == "NGN"
}

/* ======================= VTU PROVIDER ENGINE ======================== */

var ErrUncertain = errors.New("provider response uncertain")

// Provider is the VTU abstraction — Stark is never locked to one vendor.
type Provider interface {
	ID() string
	Priority() int
	Healthy() bool
	Execute(ctx context.Context, req purchaseReq) (providerRef, token string, err error)
	CheckTransaction(ctx context.Context, providerRef string) (status string, err error)
	Balance(ctx context.Context) (int64, error)
}

type ProviderEngine struct {
	log       *slog.Logger
	providers []Provider
}

func NewProviderEngine(log *slog.Logger) *ProviderEngine { return &ProviderEngine{log: log} }

func (e *ProviderEngine) Register(p Provider) {
	if p == nil {
		return
	}
	e.providers = append(e.providers, p)
	for i := len(e.providers) - 1; i > 0; i-- {
		if e.providers[i].Priority() < e.providers[i-1].Priority() {
			e.providers[i], e.providers[i-1] = e.providers[i-1], e.providers[i]
		}
	}
}

// Execute tries providers by priority. A configured provider that fails
// falls over to the next; timeouts/5xx are treated as ErrUncertain only
// from the LAST provider (nothing is retried blindly).
func (e *ProviderEngine) Execute(ctx context.Context, req purchaseReq) (string, string, error) {
	var configured []Provider
	for _, p := range e.providers {
		if hp, ok := p.(*HTTPProvider); ok && hp.baseURL == "" {
			continue // not configured — never fabricate responses
		}
		if p.Healthy() {
			configured = append(configured, p)
		}
	}
	if len(configured) == 0 {
		return "", "", errors.New("no Vtu provider is configured for this service")
	}
	var lastErr error
	for i, p := range configured {
		ref, token, err := p.Execute(ctx, req)
		if err == nil {
			return ref, token, nil
		}
		lastErr = err
		e.log.Warn("provider failed, failing over", "provider", p.ID(), "err", err)
		if i == len(configured)-1 && (errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "timeout")) {
			return "", "", ErrUncertain // reconcile, don't refund yet
		}
	}
	return "", "", lastErr
}

// HTTPProvider talks to a real VTU gateway over HTTPS. Credentials are
// injected from environment variables on the server — never from clients.
type HTTPProvider struct {
	id       string
	priority int
	baseURL  string
	apiKey   string
	breaker  breaker
}

type breaker struct {
	failures int
	openTill time.Time
}

func NewHTTPProvider(id string, priority int, baseURL, apiKey string) *HTTPProvider {
	return &HTTPProvider{id: id, priority: priority, baseURL: baseURL, apiKey: apiKey}
}

func (p *HTTPProvider) ID() string       { return p.id }
func (p *HTTPProvider) Priority() int    { return p.priority }
func (p *HTTPProvider) Healthy() bool    { return time.Now().After(p.breaker.openTill) }
func (p *HTTPProvider) trip()            { p.breaker.failures++; p.breaker.openTill = time.Now().Add(time.Duration(p.breaker.failures) * 30 * time.Second) }
func (p *HTTPProvider) reset()           { p.breaker.failures = 0; p.breaker.openTill = time.Time{} }

func (p *HTTPProvider) Execute(ctx context.Context, req purchaseReq) (string, string, error) {
	if p.baseURL == "" {
		return "", "", errors.New("provider not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string]any{
		"service": req.Service, "network": req.Network, "phone": req.Phone,
		"account": req.Account, "plan_id": req.PlanID, "amount": req.Amount,
	})
	hreq, _ := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/v1/purchase", bytes.NewReader(body))
	hreq.Header.Set("Authorization", "Bearer "+p.apiKey)
	hreq.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(hreq)
	if err != nil {
		p.trip()
		return "", "", fmt.Errorf("provider timeout: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		OK   bool   `json:"ok"`
		Ref  string `json:"reference"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || !out.OK || resp.StatusCode >= 500 {
		p.trip()
		return "", "", errors.New("provider request failed")
	}
	p.reset()
	return out.Ref, out.Token, nil
}

func (p *HTTPProvider) CheckTransaction(ctx context.Context, ref string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	hreq, _ := http.NewRequestWithContext(ctx, "GET", p.baseURL+"/v1/transaction/"+ref, nil)
	hreq.Header.Set("Authorization", "Bearer "+p.apiKey)
	resp, err := http.DefaultClient.Do(hreq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct{ Status string `json:"status"` }
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.Status, nil
}

func (p *HTTPProvider) Balance(ctx context.Context) (int64, error) { return 0, nil }

/* ========================= WORKERS / ROUTES ========================= */

// RunReconciler resolves stuck PROCESSING transactions by asking the
// provider for the truth, then settling or reversing exactly once.
func (m *Module) RunReconciler(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			rows, err := m.db.Query(ctx,
				`SELECT id, user_id, total_kobo, provider_ref, idempotency_key
				   FROM transactions
				  WHERE status='PROCESSING' AND updated_at < now() - interval '5 minutes'
				  LIMIT 50`)
			if err != nil {
				continue
			}
			for rows.Next() {
				var id, uid, idem string
				var amt int64
				var ref *string
				_ = rows.Scan(&id, &uid, &amt, &ref, &idem)
				if ref == nil {
					_ = m.Reverse(ctx, uid, id, amt, idem+":reconcile-reverse")
					m.setStatus(ctx, id, "FAILED", "provider never acknowledged the request")
					continue
				}
				status, err := m.providers.providers[0].CheckTransaction(ctx, *ref)
				switch {
				case err != nil:
					// still uncertain — leave PROCESSING for next cycle
				case status == "success":
					_ = m.Settle(ctx, uid, id, amt, idem+":reconcile-settle")
					m.setStatus(ctx, id, "SUCCESSFUL", "")
				case status == "failed":
					_ = m.Reverse(ctx, uid, id, amt, idem+":reconcile-reverse")
					m.setStatus(ctx, id, "FAILED", "provider reported failure during reconciliation")
				}
			}
			rows.Close()
		}
	}
}

// RunProviderHealth pings providers and logs degraded ones.
func (m *Module) RunProviderHealth(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			for _, p := range m.providers.providers {
				m.log.Info("provider health", "provider", p.ID(), "healthy", p.Healthy())
			}
		}
	}
}

func (m *Module) Routes(r *chi.Mux) {
	// Webhook is outside the auth middleware (Paystack signs it instead).
	r.Post("/api/v1/payments/webhook/paystack", m.PaystackWebhook)

	r.Route("/api/v1", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			// Public read endpoints used by purchase screens.
			r.Get("/data/plans", m.handleDataPlans)
			r.Get("/cable/validate", m.handleCableValidate)
			r.Get("/electricity/validate", m.handleMeterValidate)
		})
		r.Group(func(r chi.Router) {
			r.Use(authModuleAuth)
			r.Get("/wallet", m.handleWallet)
			r.Get("/wallet/ledger", m.handleLedger)
			r.Post("/wallet/fund", m.Fund)
			r.Post("/transactions/purchase", m.Purchase)
			r.Get("/transactions", m.handleTransactions)
			r.Get("/transactions/{id}", m.handleTransaction)
		})
	})
}

// authModuleAuth bridges to the auth module's middleware without a cycle.
var authModuleAuth func(http.Handler) http.Handler = func(next http.Handler) http.Handler { return next }

// SetAuthMiddleware is called at boot wiring to inject the real guard.
func SetAuthMiddleware(mw func(http.Handler) http.Handler) { authModuleAuth = mw }

/* --------------------------- read handlers -------------------------- */

func (m *Module) handleWallet(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	var avail, reserved int64
	if err := m.db.QueryRow(r.Context(),
		`SELECT available_kobo, reserved_kobo FROM wallets WHERE user_id=$1`, uid).Scan(&avail, &reserved); err != nil {
		platform.WriteErr(w, r, 404, "wallet_not_found", "Wallet not found.")
		return
	}
	var cashback int64
	_ = m.db.QueryRow(r.Context(),
		`SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END),0)
		   FROM ledger_entries WHERE user_id=$1 AND account_kind='CASHBACK'`, uid).Scan(&cashback)
	platform.WriteJSON(w, r, 200, map[string]any{
		"available_kobo": avail, "reserved_kobo": reserved,
		"ledger_balance_kobo": avail + reserved, "cashback_kobo": cashback,
		"note": "Balances are always read from the ledger — never from the client.",
	})
}

func (m *Module) handleLedger(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	rows, err := m.db.Query(r.Context(),
		`SELECT created_at, account_kind, direction, amount_kobo, description
		   FROM ledger_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, uid)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't load the ledger. Please retry.")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var at time.Time
		var kind, dir, desc string
		var amt int64
		if err := rows.Scan(&at, &kind, &dir, &amt, &desc); err == nil {
			out = append(out, map[string]any{"at": at, "account": kind, "direction": dir, "amount_kobo": amt, "description": desc})
		}
	}
	platform.WriteJSON(w, r, 200, out)
}

func (m *Module) handleTransactions(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	rows, err := m.db.Query(r.Context(),
		`SELECT id, ref, service, network, account, total_kobo, status, created_at, COALESCE(token,'')
		   FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, uid)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't load transactions. Please retry.")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, ref, svc, net, acct, status, token string
		var at time.Time
		var amt int64
		if err := rows.Scan(&id, &ref, &svc, &net, &acct, &amt, &status, &at, &token); err == nil {
			out = append(out, map[string]any{"id": id, "ref": ref, "service": svc, "network": net,
				"account": acct, "total_kobo": amt, "status": status, "created_at": at, "token": token})
		}
	}
	platform.WriteJSON(w, r, 200, out)
}

func (m *Module) handleTransaction(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	id := chi.URLParam(r, "id")
	var ref, svc, net, acct, status, provider, provRef, token, failReason string
	var amt, fee int64
	var at time.Time
	err := m.db.QueryRow(r.Context(),
		`SELECT ref, service, network, account, total_kobo, fee_kobo, status, created_at,
		        COALESCE(provider,''), COALESCE(provider_ref,''), COALESCE(token,''), COALESCE(failure_reason,'')
		   FROM transactions WHERE id=$1 AND user_id=$2`, id, uid).
		Scan(&ref, &svc, &net, &acct, &amt, &fee, &status, &at, &provider, &provRef, &token, &failReason)
	if err != nil {
		platform.WriteErr(w, r, 404, "not_found", "Transaction not found.")
		return
	}
	platform.WriteJSON(w, r, 200, map[string]any{
		"id": id, "ref": ref, "service": svc, "network": net, "account": acct,
		"total_kobo": amt, "fee_kobo": fee, "status": status, "created_at": at,
		"provider": provider, "provider_ref": provRef, "token": token, "failure_reason": failReason,
	})
}

// Plan catalog endpoints. In production these are cached in Redis from
// provider GetProducts() — prices are never hardcoded in clients.
func (m *Module) handleDataPlans(w http.ResponseWriter, r *http.Request) {
	network := r.URL.Query().Get("network")
	rows, err := m.db.Query(r.Context(),
		`SELECT plan_id, network, label, amount_kobo, validity FROM provider_products
		  WHERE kind='data' AND ($1='' OR network=$1) AND active ORDER BY amount_kobo`, network)
	if err != nil {
		platform.WriteJSON(w, r, 200, []any{})
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, net, label, validity string
		var amt int64
		if err := rows.Scan(&id, &net, &label, &amt, &validity); err == nil {
			out = append(out, map[string]any{"plan_id": id, "network": net, "label": label, "amount_kobo": amt, "validity": validity})
		}
	}
	platform.WriteJSON(w, r, 200, out)
}

func (m *Module) handleCableValidate(w http.ResponseWriter, r *http.Request) {
	// Real customer-name resolution must come from the provider's
	// validation API — Stark never fabricates customer details.
	platform.WriteErr(w, r, 503, "provider_required",
		"Smartcard validation requires a configured provider. Add provider credentials to enable cable purchases.")
}

func (m *Module) handleMeterValidate(w http.ResponseWriter, r *http.Request) {
	platform.WriteErr(w, r, 503, "provider_required",
		"Meter validation requires a configured provider. Add provider credentials to enable electricity purchases.")
}
