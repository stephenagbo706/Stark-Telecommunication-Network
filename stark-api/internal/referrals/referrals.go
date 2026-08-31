// Package referrals — Stark referral engine.
//
// A referrer earns the configured reward (default ₦500) ONLY when a
// referred friend completes a qualifying SUCCESSFUL transaction (§2).
// Registration, verification and funding alone never pay.
//
// Pipeline (§40):  REGISTERED → VERIFIED → FUNDED → qualifying purchase
// SUCCESSFUL → fraud gate → ACTIVE/REWARDED → reward ledger entry →
// notification.  All money moves through the double-entry ledger (§17);
// statistics are always computed from PostgreSQL, never the client (§21).
//
// Activation runs as a background worker so it does not depend on the
// mobile app being open (§38) and avoids a finance↔referrals import
// cycle. Duplicate rewards are impossible: referral_rewards has a UNIQUE
// constraint on referral_id and every posting carries an idempotency key
// (§18).
package referrals

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"stark-api/internal/auth"
	"stark-api/internal/finance"
	"stark-api/internal/platform"
)

type Module struct {
	db  *pgxpool.Pool
	fin *finance.Module
	log *slog.Logger
}

func New(db *pgxpool.Pool, fin *finance.Module, log *slog.Logger) *Module {
	return &Module{db: db, fin: fin, log: log.With("module", "referrals")}
}

/* ------------------------------ routes ------------------------------ */

func (m *Module) Routes(mux chi.Router) {
	mux.Route("/api/v1/referrals", func(r chi.Router) {
		r.Use(authModuleAuth)
		r.Get("/me", m.handleMe)
		r.Get("/history", m.handleHistory)
		r.Post("/withdraw", m.handleWithdraw)
	})
}

// authModuleAuth is injected at boot (see SetAuthMiddleware) so this
// package never imports the auth middleware directly.
var authModuleAuth func(http.Handler) http.Handler = func(next http.Handler) http.Handler { return next }

func SetAuthMiddleware(mw func(http.Handler) http.Handler) { authModuleAuth = mw }

/* ------------------------------ config ------------------------------ */

type config struct {
	RewardKobo      int64
	Qualifying      []string
	MinQualifyKobo  int64
	CampaignEnabled bool
}

func (m *Module) loadConfig(ctx context.Context) config {
	c := config{RewardKobo: 50000, Qualifying: []string{"airtime", "data", "cable", "electricity"}, MinQualifyKobo: 10000, CampaignEnabled: true}
	_ = m.db.QueryRow(ctx,
		`SELECT reward_kobo, qualifying_services, min_qualifying_kobo, campaign_enabled FROM referral_config WHERE id=1`).
		Scan(&c.RewardKobo, &c.Qualifying, &c.MinQualifyKobo, &c.CampaignEnabled)
	return c
}

func qualifies(service string, minKobo, amountKobo int64, qualifying []string) bool {
	if amountKobo < minKobo {
		return false
	}
	for _, s := range qualifying {
		if s == service {
			return true
		}
	}
	return false
}

/* --------------------------- GET /me (§19) -------------------------- */

func (m *Module) handleMe(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())

	var code string
	if err := m.db.QueryRow(r.Context(), `SELECT referral_code FROM profiles WHERE user_id=$1`, uid).Scan(&code); err != nil {
		platform.WriteErr(w, r, 404, "no_profile", "Your referral profile is still being prepared.")
		return
	}

	var invited, active int
	_ = m.db.QueryRow(r.Context(),
		`SELECT COUNT(*), COUNT(*) FILTER (WHERE status IN ('ACTIVE','REWARDED'))
		   FROM referrals WHERE referrer_user_id=$1`, uid).Scan(&invited, &active)

	// Earned/pending come from the reward records; available is derived
	// from the immutable REFERRAL ledger account (§27).
	var earned, pending int64
	_ = m.db.QueryRow(r.Context(),
		`SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE status IN ('APPROVED','PAID')),0),
		        COALESCE(SUM(amount_kobo) FILTER (WHERE status='PENDING'),0)
		   FROM referral_rewards WHERE user_id=$1`, uid).Scan(&earned, &pending)

	var available int64
	_ = m.db.QueryRow(r.Context(),
		`SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END),0)
		   FROM ledger_entries WHERE user_id=$1 AND account_kind='REFERRAL'`, uid).Scan(&available)

	platform.WriteJSON(w, r, 200, map[string]any{
		"referral_code":  code,
		"referral_link":  "https://stark.app/r/" + code,
		"invited":        invited,
		"active":         active,
		"earned_kobo":    earned,
		"pending_kobo":   pending,
		"available_kobo": available,
		"note":           "Statistics are computed server-side from the referral ledger.",
	})
}

/* ------------------------ GET /history (§20) ------------------------ */

func (m *Module) handleHistory(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	rows, err := m.db.Query(r.Context(),
		`SELECT r.id, p.full_name, r.status, r.created_at, r.activated_at,
		        COALESCE(rr.amount_kobo,0), COALESCE(rr.status,''), r.risk
		   FROM referrals r
		   JOIN profiles p ON p.user_id = r.referred_user_id
		   LEFT JOIN referral_rewards rr ON rr.referral_id = r.id
		  WHERE r.referrer_user_id=$1
		  ORDER BY r.created_at DESC LIMIT 100`, uid)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't load your referral history.")
		return
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var id, name, status, risk, rwStatus string
		var created time.Time
		var activated *time.Time
		var amount int64
		if err := rows.Scan(&id, &name, &status, &created, &activated, &amount, &rwStatus, &risk); err != nil {
			continue
		}
		item := map[string]any{
			"id": id, "referred_name": name, "status": status, "risk": risk,
			"created_at": created, "reward_kobo": amount, "reward_status": rwStatus,
		}
		if activated != nil {
			item["activated_at"] = *activated
		}
		out = append(out, item)
	}
	platform.WriteJSON(w, r, 200, map[string]any{"referrals": out})
}

/* --------------------- POST /withdraw (§28) ------------------------- */
// Moves available referral earnings (the REFERRAL ledger balance) into
// the user's main wallet via a balanced, idempotent posting.

func (m *Module) handleWithdraw(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())

	var available int64
	if err := m.db.QueryRow(r.Context(),
		`SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_kobo ELSE -amount_kobo END),0)
		   FROM ledger_entries WHERE user_id=$1 AND account_kind='REFERRAL'`, uid).Scan(&available); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't read your referral balance. Please retry.")
		return
	}
	if available < 50000 {
		platform.WriteErr(w, r, 422, "below_minimum", "The minimum referral transfer is ₦500.")
		return
	}

	tx, err := m.db.Begin(r.Context())
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't start the transfer. Please retry.")
		return
	}
	defer tx.Rollback(r.Context())

	idem := "referral-withdraw:" + uid + ":" + uuid.NewString()[:8]
	err = m.fin.Post(r.Context(), tx, uid, "", idem, "referral earnings → wallet", []finance.Entry{
		{AccountKind: "REFERRAL", Direction: "DEBIT", AmountKobo: available},
		{AccountKind: "WALLET", Direction: "CREDIT", AmountKobo: available},
	})
	if err != nil {
		platform.WriteErr(w, r, 500, "ledger", "The transfer couldn't be recorded. Nothing was moved.")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE referral_rewards SET status='PAID', paid_at=now() WHERE user_id=$1 AND status='APPROVED'`, uid); err != nil {
		m.log.Warn("mark rewards paid", "err", err)
	}
	if err := tx.Commit(r.Context()); err != nil {
		platform.WriteErr(w, r, 500, "internal", "The transfer couldn't complete. Please retry.")
		return
	}

	m.log.Info("referral earnings withdrawn", "user_id", uid, "kobo", available)
	platform.WriteJSON(w, r, 200, map[string]any{
		"transferred_kobo": available,
		"message":          "Your referral earnings were moved to your Stark wallet.",
	})
}

/* ------------------- activation worker (§15, §38) ------------------- */

// RunActivator advances referrals whose referred friend has progressed.
// It is idempotent: each transition is guarded by the current status and
// reward creation is UNIQUE per referral, so concurrent runs are safe.
func (m *Module) RunActivator(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.sweep(ctx)
		}
	}
}

func (m *Module) sweep(ctx context.Context) {
	cfg := m.loadConfig(ctx)
	if !cfg.CampaignEnabled {
		return
	}

	rows, err := m.db.Query(ctx,
		`SELECT r.id, r.referred_user_id, r.referrer_user_id, r.status
		   FROM referrals r
		  WHERE r.status IN ('REGISTERED','VERIFIED','FUNDED')`)
	if err != nil {
		return
	}
	type row struct{ id, referred, referrer, status string }
	var pending []row
	for rows.Next() {
		var x row
		if rows.Scan(&x.id, &x.referred, &x.referrer, &x.status) == nil {
			pending = append(pending, x)
		}
	}
	rows.Close()

	for _, x := range pending {
		m.advance(ctx, x.id, x.referred, x.referrer, x.status, cfg)
	}
}

func (m *Module) advance(ctx context.Context, refID, referred, referrer, status string, cfg config) {
	// Verified? (phone or email confirmed)
	if status == "REGISTERED" {
		var verified bool
		_ = m.db.QueryRow(ctx,
			`SELECT phone_verified_at IS NOT NULL OR email_verified_at IS NOT NULL FROM users WHERE id=$1`, referred).
			Scan(&verified)
		if verified {
			m.setStatus(ctx, refID, "VERIFIED")
			m.event(ctx, refID, "VERIFIED")
			status = "VERIFIED"
		} else {
			return
		}
	}

	// Funded? (wallet ever credited)
	if status == "VERIFIED" {
		var funded bool
		_ = m.db.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM ledger_entries WHERE user_id=$1 AND account_kind='WALLET' AND direction='CREDIT')`, referred).
			Scan(&funded)
		if funded {
			m.setStatus(ctx, refID, "FUNDED")
			m.event(ctx, refID, "FUNDED")
			status = "FUNDED"
		} else {
			return
		}
	}

	// Qualifying transaction? (§13–14) Only a SUCCESSFUL purchase of an
	// eligible service at/above the minimum counts.
	if status == "FUNDED" {
		var txID, service string
		var amount int64
		err := m.db.QueryRow(ctx,
			`SELECT id, service, amount_kobo FROM transactions
			  WHERE user_id=$1 AND status='SUCCESSFUL'
			  ORDER BY completed_at ASC LIMIT 1`, referred).Scan(&txID, &service, &amount)
		if err != nil {
			return // no qualifying purchase yet
		}
		if !qualifies(service, cfg.MinQualifyKobo, amount, cfg.Qualifying) {
			return // purchase doesn't meet the qualifying rule
		}
		m.event(ctx, refID, "QUALIFYING_TRANSACTION")
		m.activateAndReward(ctx, refID, referrer, txID, cfg)
	}
}

// activateAndReward gates on fraud, flips the referral to its terminal
// state and — for LOW risk — writes the immutable reward ledger entry.
func (m *Module) activateAndReward(ctx context.Context, refID, referrer, qualifyingTxID string, cfg config) {
	risk := m.fraudScore(ctx, refID, referrer)

	switch risk {
	case "HIGH":
		m.setStatus(ctx, refID, "REJECTED")
		m.event(ctx, refID, "REWARD_REJECTED")
		m.log.Warn("referral rejected by fraud gate", "referral", refID)
		return
	case "MEDIUM":
		m.setStatus(ctx, refID, "PENDING_REVIEW")
		m.createReward(ctx, refID, referrer, cfg.RewardKobo, "PENDING")
		return
	}

	// LOW — activate and pay through the ledger.
	tx, err := m.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)

	// UNIQUE(referral_id) + status guard make this idempotent (§18).
	tag, err := tx.Exec(ctx,
		`UPDATE referrals SET status='REWARDED', risk='LOW', activated_at=now(), updated_at=now()
		  WHERE id=$1 AND status='FUNDED'`, refID)
	if err != nil || tag.RowsAffected() == 0 {
		return // already processed or state changed
	}

	rewardID := uuid.NewString()
	ledgerRef := "REF-" + uuid.NewString()[:8]
	if _, err := tx.Exec(ctx,
		`INSERT INTO referral_rewards (id, referral_id, user_id, amount_kobo, status, ledger_reference, approved_at)
		 VALUES ($1,$2,$3,$4,'APPROVED',$5,now())
		 ON CONFLICT (referral_id) DO NOTHING`,
		rewardID, refID, referrer, cfg.RewardKobo, ledgerRef); err != nil {
		return
	}

	// §17 — immutable balanced posting: the reward pool funds the user's
	// referral account. Balances stay ledger-derived, never edited.
	idem := "referral-reward:" + refID
	if err := m.fin.Post(ctx, tx, referrer, "", idem, "referral reward "+ledgerRef, []finance.Entry{
		{AccountKind: "REFERRAL_POOL", Direction: "DEBIT", AmountKobo: cfg.RewardKobo},
		{AccountKind: "REFERRAL", Direction: "CREDIT", AmountKobo: cfg.RewardKobo},
	}); err != nil {
		m.log.Error("referral reward ledger post failed", "referral", refID, "err", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		return
	}

	m.event(ctx, refID, "ACTIVATED")
	m.event(ctx, refID, "REWARD_APPROVED")
	m.log.Info("referral activated + rewarded", "referral", refID, "referrer", referrer, "kobo", cfg.RewardKobo)
	// Notification fan-out happens via the notifications worker (§22).
	_ = qualifyingTxID
}

// createReward records a PENDING reward (MEDIUM risk) without a ledger
// posting — the posting only occurs once an admin approves it.
func (m *Module) createReward(ctx context.Context, refID, referrer string, amount int64, status string) {
	_, _ = m.db.Exec(ctx,
		`INSERT INTO referral_rewards (id, referral_id, user_id, amount_kobo, status)
		 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (referral_id) DO NOTHING`,
		uuid.NewString(), refID, referrer, amount, status)
	m.event(ctx, refID, "REWARD_CREATED")
}

func (m *Module) setStatus(ctx context.Context, refID, status string) {
	_, _ = m.db.Exec(ctx, `UPDATE referrals SET status=$2, updated_at=now() WHERE id=$1`, refID, status)
}

func (m *Module) event(ctx context.Context, refID, eventType string) {
	_, _ = m.db.Exec(ctx,
		`INSERT INTO referral_events (id, referral_id, event_type) VALUES ($1,$2,$3)`,
		uuid.NewString(), refID, eventType)
}

/* ------------------------- fraud gate (§24) ------------------------- */

// fraudScore returns LOW / MEDIUM / HIGH. HIGH blocks outright, MEDIUM
// holds the reward for manual review, LOW pays automatically.
func (m *Module) fraudScore(ctx context.Context, refID, referrer string) string {
	// Rapid referrals: many signups under this referrer in 24h.
	var rapid int
	_ = m.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM referrals WHERE referrer_user_id=$1 AND created_at > now() - INTERVAL '24 hours'`, referrer).
		Scan(&rapid)
	if rapid > 25 {
		return "HIGH"
	}
	if rapid > 10 {
		return "MEDIUM"
	}

	// Shared device / phone clustering between referrer and referred.
	var sharedPhone bool
	_ = m.db.QueryRow(ctx,
		`SELECT EXISTS(
		   SELECT 1 FROM profiles a JOIN profiles b ON a.phone = b.phone
		    WHERE a.user_id=$1 AND b.user_id=(SELECT referred_user_id FROM referrals WHERE id=$2))`,
		referrer, refID).Scan(&sharedPhone)
	if sharedPhone {
		return "HIGH"
	}
	return "LOW"
}

/* --------------------------- JSON helper ---------------------------- */

var _ = json.Marshal // keep encoding/json referenced for future payloads
