// Package diagnostics — Stark Turbo backend support (§17).
//
// A single, deliberately cheap endpoint that clients measure round-trip
// latency against:
//
//	GET /api/v1/diagnostics/ping
//
// It performs NO database work, NO Redis work and NO external calls, so
// the measured latency reflects the network path — not server load. It is
// public (pre-auth) so reachability can be tested before login, and it is
// rate-limited like any other public route.
//
// Region honesty (§24): the `region` field is whatever the deployment is
// configured as via STARK_REGION. It is never derived from the client and
// never invented — a single "core" deployment reports "core", not "Lagos".
package diagnostics

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"stark-api/internal/platform"
)

type Module struct {
	cfg platform.Config
	log *slog.Logger
}

func New(cfg platform.Config, log *slog.Logger) *Module {
	return &Module{cfg: cfg, log: log.With("module", "diagnostics")}
}

// Ping answers instantly with server identity metadata.
// Response: { "ok": true, "data": { "status": "ok", "server_time": …, "region": … } }
func (m *Module) Ping(w http.ResponseWriter, r *http.Request) {
	platform.WriteJSON(w, r, http.StatusOK, map[string]any{
		"status":      "ok",
		"server_time": time.Now().UTC().Format(time.RFC3339Nano),
		"region":      m.cfg.Region,
		"env":         m.cfg.Env,
	})
}

func (m *Module) Routes(mux chi.Router) {
	mux.Route("/api/v1/diagnostics", func(r chi.Router) {
		// Public but rate-limited — safe to call frequently, never free to abuse.
		r.Get("/ping", m.Ping)
	})
}
