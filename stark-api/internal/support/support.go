// Package support — Stark Help Center ticket intake.
//
// Flutter flow (production):
//
//	Flutter → POST /api/v1/support/tickets → PostgreSQL (support_tickets)
//	  → ticket ref STK-TKT-000184 returned → Flutter embeds it in the
//	    WhatsApp message → WhatsApp opens → USER taps Send.
//
// Persisting the ticket BEFORE WhatsApp opens means Stark keeps a
// support record even after the chat ends. The WhatsApp number itself
// is public and lives only in the mobile app — no secrets here.
package support

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"stark-api/internal/auth"
	"stark-api/internal/platform"
)

type Module struct {
	db  *pgxpool.Pool
	log *slog.Logger
}

func New(db *pgxpool.Pool, log *slog.Logger) *Module {
	return &Module{db: db, log: log.With("module", "support")}
}

var categories = map[string]bool{
	"General": true, "Airtime": true, "Data": true, "Cable TV": true,
	"Electricity": true, "Wallet": true, "Dispute": true, "Security": true,
}

type createReq struct {
	Subject        string `json:"subject"`
	Category       string `json:"category"`
	Description    string `json:"description"`
	TransactionRef string `json:"transaction_ref"` // optional — attached context
}

// CreateTicket validates, mints a sequential ticket ref and persists.
// It never opens WhatsApp — that is the mobile app's job, and the user
// must always press Send themselves.
func (m *Module) CreateTicket(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())

	var req createReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		platform.WriteErr(w, r, 400, "invalid_body", "Check the ticket details and try again.")
		return
	}
	req.Subject = strings.TrimSpace(req.Subject)
	req.Category = strings.TrimSpace(req.Category)
	req.Description = strings.TrimSpace(req.Description)

	if req.Subject == "" {
		platform.WriteErr(w, r, 422, "invalid_subject", "Please enter a subject.")
		return
	}
	if !categories[req.Category] {
		platform.WriteErr(w, r, 422, "invalid_category", "Please select a category.")
		return
	}
	if req.Description == "" {
		platform.WriteErr(w, r, 422, "invalid_description", "Please describe the issue.")
		return
	}
	if len(req.Subject) > 140 || len(req.Description) > 4000 {
		platform.WriteErr(w, r, 422, "too_long", "Please keep the subject under 140 characters and the description under 4,000.")
		return
	}

	// Sequential human reference: STK-TKT-000184. Unique-constraint on
	// support_tickets.ref makes duplicates impossible.
	var ref string
	if err := m.db.QueryRow(r.Context(),
		`SELECT 'STK-TKT-' || lpad(nextval('support_ticket_seq')::text, 6, '0')`).Scan(&ref); err != nil {
		platform.WriteErr(w, r, 500, "internal", "We couldn't allocate a ticket reference. Please retry.")
		return
	}

	meta := map[string]any{}
	if req.TransactionRef != "" {
		meta["transaction_ref"] = req.TransactionRef
	}
	metaJSON, _ := json.Marshal(meta)

	if _, err := m.db.Exec(r.Context(),
		`INSERT INTO support_tickets (id, user_id, ref, subject, body, status, metadata)
		 VALUES ($1,$2,$3,$4,$5,'OPEN',$6)`,
		uuid.NewString(), uid, ref, req.Subject, req.Description, string(metaJSON)); err != nil {
		m.log.Error("ticket insert failed", "err", err)
		platform.WriteErr(w, r, 500, "internal", "We couldn't save the ticket. Please retry.")
		return
	}

	m.log.Info("support ticket created", "user", uid, "ref", ref, "category", req.Category)
	platform.WriteJSON(w, r, 201, map[string]any{
		"ticket_ref": ref,
		"status":     "OPEN",
		"message":    "Ticket recorded. Review the prepared WhatsApp message and tap Send.",
		"created_at": time.Now().Format(time.RFC3339),
	})
}

// ListTickets returns the caller's ticket history (paginated).
func (m *Module) ListTickets(w http.ResponseWriter, r *http.Request) {
	uid := auth.UserID(r.Context())
	rows, err := m.db.Query(r.Context(),
		`SELECT ref, subject, status, created_at FROM support_tickets
		 WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, uid)
	if err != nil {
		platform.WriteErr(w, r, 500, "internal", "Ticket history is unavailable right now.")
		return
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var ref, subject, status string
		var ts time.Time
		if err := rows.Scan(&ref, &subject, &status, &ts); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"ticket_ref": ref, "subject": subject, "status": status,
			"created_at": ts.Format(time.RFC3339),
		})
	}
	platform.WriteJSON(w, r, 200, map[string]any{"data": out})
}

// authGuard is injected at boot wiring (see cmd/server/main.go) — the
// same pattern finance uses, so support never imports the auth module
// directly and stays testable with a stub guard.
var authGuard func(http.Handler) http.Handler

// SetAuthMiddleware is called at boot wiring to inject the real guard.
func SetAuthMiddleware(mw func(http.Handler) http.Handler) { authGuard = mw }

// Routes mounts the support endpoints behind JWT auth.
func (m *Module) Routes(mux chi.Router) {
	mux.Route("/api/v1/support", func(r chi.Router) {
		r.Use(authGuard)
		r.Post("/tickets", m.CreateTicket)
		r.Get("/tickets", m.ListTickets)
	})
	_ = fmt.Sprintf // keep fmt import stable across refactors
}
