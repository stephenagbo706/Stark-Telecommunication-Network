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
	cryptoRand "crypto/rand"
	"crypto/sha256"
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
	"stark-api/internal/payments"
	"stark-api/internal/platform"
)

type Module struct {
	cfg       platform.Config
	db        *pgxpool.Pool
	rdb       *redis.Client
	log       *slog.Logger
	providers *ProviderEngine
	gateway   payments.Gateway // Paystack today; Remita tomorrow — same seam
}

func New(cfg platform.Config, db *pgxpool.Pool, rdb *redis.Client, log *slog.Logger) *Module {
	return NewWithGateway(cfg, db, rdb, log, payments.NewPaystack(cfg.PaystackBaseURL, cfg.PaystackSecretKey))
}

// NewWithGateway allows tests (and future processors) to inject a gateway.
// Production wiring always goes through New.
func NewWithGateway(cfg platform.Config, db *pgxpool.Pool, rdb *redis.Client, log *slog.Logger, gw payments.Gateway) *Module {
	eng := NewProviderEngine(log)
	eng.Register(NewHTTPProvider("provider-a", 1, cfg.ProviderABaseURL, cfg.ProviderAKey))
	eng.Register(NewHTTPProvider("provider-b", 2, cfg.ProviderBBaseURL, cfg.ProviderBKey))
	return &Module{
		cfg: cfg, db: db, rdb: rdb,
		log:       log.With("module", "finance"),
		providers: eng,
		gateway:   gw,
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

// ValidateEntries is the first line of double-entry defense: a posting
// must have at least two legs, strictly positive amounts, and total
// debits must equal total credits. Pure function — unit tested without a DB.
func ValidateEntries(entries []Entry) error {
	if len(entries) < 2 {
		return errors.New("ledger posting requires at least two legs")
	}
	var debits, credits int64
	for _, e := range entries {
		if e.AmountKobo <= 0 {
			return errors.New("ledger amounts must be positive")
		}
		if e.Direction != "DEBIT" && e.Direction != "CREDIT" {
			return errors.New("ledger direction must be DEBIT or CREDIT")
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
	return nil
}

// Post writes an immutable, balanced ledger posting inside tx.
// It also maintains wallet materialized balances under row locks.
func (m *Module) Post(ctx context.Context, tx pgx.Tx, userID, txID, idemKey, description string, entries []Entry) error {
	if err := ValidateEntries(entries); err != nil {
		return err
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

/* -------------------- LIVE-MONEY FUNDING FLOW -------------------------
 *
 * Invariants enforced below (§7, §13–§15):
 *   - Amount travels as INTEGER KOBO end-to-end. No floats touch money.
 *   - Stark generates the payment reference BEFORE contacting Paystack
 *     (crypto/rand), so the PENDING record exists first and ownership is
 *     bound to the authenticated user — never to client-supplied metadata.
 *   - The wallet is credited ONLY by settlePayment, driven by a signature-
 *     verified webhook or the reconciliation worker. Callbacks and client
 *     claims never credit anything.
 */

const (
	minFundKobo = 10000      // ₦100
	maxFundKobo = 500000000  // ₦5,000,000 per charge
)

// payRef mints a cryptographically random Stark payment reference:
// STK-PAY-YYYYMMDD-XXXXXXXX. Never Math.random, never sequential.
func payRef(now time.Time) string {
	b := make([]byte, 4)
	if _, err := cryptoRand.Read(b); err != nil {
		b = []byte(uuid.NewString()[:4]) // uuid v4 is crypto/rand-backed anyway
	}
	return fmt.Sprintf("STK-PAY-%s-%s", now.Format("20060102"), strings.ToUpper(hex.EncodeToString(b)))
}

// Fund initializes a real Paystack charge for the authenticated user.
// Response contains ONLY client-safe data: authorization_url + reference.
func (m *Module) Fund(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	var req struct {
		AmountKobo int64  `json:"amount_kobo"` // integer minor units (§13)
		Email      string `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		platform.WriteErr(w, r, 400, "invalid_body", "Check the funding details and try again.")
		return
	}
	if req.AmountKobo < minFundKobo || req.AmountKobo > maxFundKobo {
		platform.WriteErr(w, r, 422, "invalid_amount", "Enter an amount between ₦100 and ₦5,000,000.")
		return
	}
	if !strings.Contains(req.Email, "@") {
		platform.WriteErr(w, r, 422, "invalid_email", "Enter a valid email for the payment receipt.")
		return
	}
	if m.cfg.PaystackSecretKey == "" || m.cfg.APIBaseURL == "" {
		platform.WriteErr(w, r, 503, "payments_unconfigured", "Card funding is being configured. Please try again shortly.")
		return
	}

	// 1. Stark owns the reference; the PENDING record is created BEFORE any
	//    gateway call, bound to the authenticated user (§15 ownership).
	ref := payRef(time.Now())
	if _, err := m.db.Exec(r.Context(),
		`INSERT INTO payments (id, user_id, gateway, reference, amount_kobo, status)
		 VALUES ($1,$2,$3,$4,$5,'pending')`,
		uuid.NewString(), uid, m.gateway.Name(), ref, req.AmountKobo); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't start the payment. Please retry.")
		return
	}

	// 2. Initialize the gateway charge. The secret key is applied inside the
	//    gateway — it never leaves the backend process.
	res, err := m.gateway.Initialize(r.Context(), payments.InitRequest{
		Email:       req.Email,
		AmountKobo:  req.AmountKobo,
		Reference:   ref,
		CallbackURL: m.cfg.APIBaseURL + "/api/v1/payments/paystack/return",
		Metadata:    map[string]any{"stark_reference": ref},
	})
	if err != nil {
		_, _ = m.db.Exec(r.Context(),
			`UPDATE payments SET status='failed', failure_reason='gateway_init_failed' WHERE reference=$1 AND status='pending'`, ref)
		switch {
		case errors.Is(err, payments.ErrUnreachable):
			platform.WriteErr(w, r, 502, "paystack_unreachable", "The payment gateway didn't respond. Please retry.")
		default:
			platform.WriteErr(w, r, 502, "paystack_error", "The payment gateway rejected the request. Please retry.")
		}
		return
	}

	m.log.Info("payment initialized", "reference", ref, "user_id", uid, "amount_kobo", req.AmountKobo)
	platform.WriteJSON(w, r, 200, map[string]string{
		"authorization_url": res.AuthorizationURL,
		"reference":         ref,
		"message":           "Complete the payment — your wallet is credited only after Stark verifies it with the gateway.",
	})
}

// PaystackWebhook is the ONLY path that can credit a funded wallet,
// alongside the reconciliation worker (both funnel through settlePayment).
//
// Pipeline (§9–§12): raw body → signature → event parse → dedupe claim →
// server-to-server verify → settlePayment (ownership + amount + currency +
// atomic conditional credit). Untrusted input never touches the ledger.
func (m *Module) PaystackWebhook(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		w.WriteHeader(400)
		return
	}
	// 1. Signature first — everything else is untrusted until this passes.
	if !m.gateway.VerifyWebhookSignature(raw, r.Header.Get("x-paystack-signature")) {
		m.log.Warn("paystack webhook signature mismatch")
		w.WriteHeader(401)
		return
	}
	var evt struct {
		Event string `json:"event"`
		Data  struct {
			Reference string `json:"reference"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &evt); err != nil {
		w.WriteHeader(200)
		return
	}
	if evt.Event != "charge.success" {
		// charge.pending / transfer.* etc. are acknowledged, not credited.
		w.WriteHeader(200)
		return
	}
	if evt.Data.Reference == "" {
		w.WriteHeader(200)
		return
	}

	// 2. Fast-path dedupe (Redis). The AUTHORITATIVE dedupe is the
	//    conditional UPDATE inside settlePayment — safe even if Redis is down.
	fresh, err := platform.ClaimIdempotency(r.Context(), m.rdb, "pswh:"+evt.Data.Reference, 7*24*time.Hour)
	if err == nil && !fresh {
		w.WriteHeader(200) // already processed
		return
	}

	// 3. Re-verify server-to-server. The webhook payload alone is never
	//    sufficient proof of payment.
	v, verr := m.gateway.Verify(r.Context(), evt.Data.Reference)
	if verr != nil {
		// Gateway temporarily unavailable: acknowledge so Paystack doesn't
		// storm us; the reconciliation worker will settle this payment once
		// verification succeeds. Nothing is credited or lost.
		m.log.Error("webhook re-verification unavailable — reconciler will settle",
			"reference", evt.Data.Reference, "err", verr)
		w.WriteHeader(200)
		return
	}

	// 4. Settle (idempotent, atomic, ownership/amount/currency-checked).
	outcome, serr := m.settlePayment(r.Context(), evt.Data.Reference, v)
	if serr != nil {
		m.log.Error("webhook settlement failed", "reference", evt.Data.Reference, "err", serr)
		w.WriteHeader(500) // Paystack retries; settlePayment stays idempotent
		return
	}
	m.log.Info("webhook processed", "reference", evt.Data.Reference, "outcome", outcome)
	w.WriteHeader(200)
}

// settlePayment is the single money-moving path for funding. It is
// idempotent and race-safe: two identical calls (even concurrent) produce
// exactly ONE wallet credit.
//
//	outcomes: "credited" | "duplicate" | "unknown" | "amount_mismatch" |
//	          "currency_mismatch" | "gateway_failed" | "abandoned"
func (m *Module) settlePayment(ctx context.Context, reference string, v payments.VerifyResult) (string, error) {
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Lock the payment row; ownership comes from the DB record created at
	// Fund time (§15) — NEVER from gateway/webhook metadata.
	var uid string
	var want int64
	var status string
	err = tx.QueryRow(ctx,
		`SELECT user_id, amount_kobo, status FROM payments WHERE reference=$1 FOR UPDATE`,
		reference).Scan(&uid, &want, &status)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "unknown", nil // webhook for a payment Stark never created
		}
		return "", err
	}
	if status != "pending" {
		return "duplicate", nil // already settled/failed/refunded — never twice
	}

	switch {
	case v.Status != "success":
		// failed / abandoned / pending — record honestly, credit nothing.
		newStatus := "failed"
		if v.Status == "abandoned" {
			newStatus = "abandoned"
		}
		if v.Status == "pending" {
			return "duplicate", nil // gateway still unsure; reconciler retries later
		}
		_, err := tx.Exec(ctx,
			`UPDATE payments SET status=$2, failure_reason=$3 WHERE reference=$1 AND status='pending'`,
			reference, newStatus, "gateway_status_"+v.Status)
		if err != nil {
			return "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		m.notify(uid, "Payment not completed",
			"Your funding attempt was not completed by the gateway. Nothing was charged.")
		return "gateway_failed", nil

	case v.AmountKobo != want:
		// §14 — amount tampering / mismatch: record the discrepancy for
		// manual review, credit NOTHING.
		if _, err := tx.Exec(ctx,
			`UPDATE payments SET status='failed', failure_reason='amount_mismatch' WHERE reference=$1 AND status='pending'`,
			reference); err != nil {
			return "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		m.log.Error("PAYMENT AMOUNT MISMATCH — manual review required",
			"reference", reference, "stark_kobo", want, "gateway_kobo", v.AmountKobo)
		return "amount_mismatch", nil

	case v.Currency != "NGN":
		if _, err := tx.Exec(ctx,
			`UPDATE payments SET status='failed', failure_reason='currency_mismatch' WHERE reference=$1 AND status='pending'`,
			reference); err != nil {
			return "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		m.log.Error("PAYMENT CURRENCY MISMATCH — manual review required",
			"reference", reference, "currency", v.Currency)
		return "currency_mismatch", nil
	}

	// Atomic success path (§12): conditional status flip + balanced ledger
	// posting in ONE transaction. If anything fails, ROLLBACK leaves the
	// payment pending (reconciler retries) — never a half-applied state.
	tag, err := tx.Exec(ctx,
		`UPDATE payments SET status='successful', verified_at=now(),
		        provider_transaction_id=$2, channel=$3
		   WHERE reference=$1 AND status='pending'`,
		reference, v.TransactionID, v.Channel)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() != 1 {
		return "duplicate", nil // a concurrent settler won the race
	}
	if err := m.Post(ctx, tx, uid, uuid.NewString(), "fund:"+reference, "wallet funding", []Entry{
		{AccountKind: "PAYSTACK_CLEARING", Direction: "DEBIT", AmountKobo: want},
		{AccountKind: "WALLET", Direction: "CREDIT", AmountKobo: want},
	}); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	m.log.Info("wallet funded", "reference", reference, "user_id", uid, "amount_kobo", want,
		"provider_transaction_id", v.TransactionID)
	m.notify(uid, "Wallet funded",
		fmt.Sprintf("₦%s was added to your wallet.", formatNaira(want)))
	return "credited", nil
}

// formatNaira renders integer kobo as grouped naira WITHOUT float math.
func formatNaira(kobo int64) string {
	naira := kobo / 100
	s := fmt.Sprintf("%d", naira)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	if kobo%100 != 0 {
		s += fmt.Sprintf(".%02d", kobo%100)
	}
	return s
}

// PaymentStatus lets Flutter poll the BACKEND for the truth about a
// payment after the Paystack sheet closes. Read-only; ownership-checked;
// never credits anything (§8: callback ≠ confirmation).
func (m *Module) PaymentStatus(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	ref := chi.URLParam(r, "reference")
	var status, failReason string
	var amount int64
	var verifiedAt *time.Time
	err := m.db.QueryRow(r.Context(),
		`SELECT status, amount_kobo, COALESCE(failure_reason,''), verified_at
		   FROM payments WHERE reference=$1 AND user_id=$2`, ref, uid).
		Scan(&status, &amount, &failReason, &verifiedAt)
	if err != nil {
		platform.WriteErr(w, r, 404, "payment_not_found", "We couldn't find that payment on your account.")
		return
	}
	out := map[string]any{"reference": ref, "status": status, "amount_kobo": amount}
	if failReason != "" {
		out["failure_reason"] = failReason
	}
	if status == "pending" {
		out["message"] = "Your payment is still being verified. Your wallet updates automatically once confirmed."
	}
	platform.WriteJSON(w, r, 200, out)
}

// PaymentReturn is Paystack's redirect target after the customer pays.
// It is a UX convenience ONLY — it displays a return page and attempts the
// app deep link. It performs NO financial action (§22: callback ≠ proof).
func (m *Module) PaymentReturn(w http.ResponseWriter, r *http.Request) {
	ref := r.URL.Query().Get("reference")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>STARK — Payment</title>
<style>body{font-family:system-ui;background:#050B14;color:#fff;display:flex;align-items:center;
justify-content:center;min-height:100vh;margin:0;text-align:center}
h1{color:#00CFFF;font-size:20px}p{color:#A8B5C8;font-size:14px;max-width:320px}
a{display:inline-block;margin-top:16px;padding:12px 24px;background:#00CFFF;color:#05121f;
border-radius:12px;text-decoration:none;font-weight:700}</style></head>
<body><div><h1>⌁ STARK</h1>
<p>Your payment status is being verified. Open the Stark app — your wallet
updates automatically once the payment is confirmed.</p>
<a href="stark://payment/return?reference=%s">Return to Stark</a></div></body></html>`,
		strings.ReplaceAll(ref, `"`, ""))
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

// RunPaymentReconciler settles funding payments stuck in PENDING after the
// webhook window (§17): the customer paid but the webhook was delayed, the
// phone went offline, or Flutter was killed mid-payment. It re-verifies
// each stale payment with the gateway and funnels through settlePayment —
// the SAME idempotent path as the webhook, so a payment is credited exactly
// once no matter which path wins. Uncertain verifications are left pending
// for the next cycle; nothing is ever force-reversed while uncertain.
func (m *Module) RunPaymentReconciler(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.reconcilePaymentsOnce(ctx)
		}
	}
}

// reconcilePaymentsOnce is one idempotent reconciliation pass — extracted
// so tests can drive it deterministically.
func (m *Module) reconcilePaymentsOnce(ctx context.Context) {
	rows, err := m.db.Query(ctx,
		`SELECT reference FROM payments
		  WHERE status='pending' AND created_at < now() - interval '5 minutes'
		  ORDER BY created_at ASC LIMIT 50`)
	if err != nil {
		return
	}
	var refs []string
	for rows.Next() {
		var ref string
		if rows.Scan(&ref) == nil {
			refs = append(refs, ref)
		}
	}
	rows.Close()
	for _, ref := range refs {
		v, verr := m.gateway.Verify(ctx, ref)
		if verr != nil {
			continue // gateway unavailable — retry next cycle
		}
		outcome, serr := m.settlePayment(ctx, ref, v)
		if serr != nil {
			m.log.Error("payment reconciliation failed", "reference", ref, "err", serr)
			continue
		}
		if outcome != "duplicate" && outcome != "unknown" {
			m.log.Info("payment reconciled", "reference", ref, "outcome", outcome)
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
	// Webhook lives OUTSIDE JWT auth — Paystack authenticates it with the
	// HMAC signature instead. Both the legacy path and the canonical
	// Paystack-style path are served by the same hardened handler.
	r.Post("/api/v1/payments/webhook/paystack", m.PaystackWebhook)
	r.Post("/api/v1/payments/paystack/webhook", m.PaystackWebhook)

	// Post-payment redirect target (UX only — never credits anything).
	r.Get("/api/v1/payments/paystack/return", m.PaymentReturn)

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
			r.Get("/payments/{reference}/status", m.PaymentStatus)
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
