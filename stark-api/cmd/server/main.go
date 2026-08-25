// STARK Telecommunication API — service entrypoint.
// Boots config, PostgreSQL, Redis, HTTP modules and background workers.
package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"stark-api/internal/auth"
	"stark-api/internal/finance"
	"stark-api/internal/platform"
	"stark-api/internal/support"
)

func main() {
	workerOnly := flag.Bool("worker", false, "run background workers only (no HTTP listener)")
	flag.Parse()

	cfg := platform.LoadConfig()
	log := platform.NewLogger(cfg)

	db, err := platform.NewDB(context.Background(), cfg)
	if err != nil {
		log.Error("postgres connect failed", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	rdb, err := platform.NewCache(cfg)
	if err != nil {
		log.Error("redis connect failed", "err", err)
		os.Exit(1)
	}
	defer rdb.Close()

	log.Info("stark-api booting",
		"env", cfg.Env, "port", cfg.Port,
		"postgres", "connected", "redis", "connected")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Domain modules. auth owns identity/profile/photo; finance owns
	// wallet, ledger, transactions, payments (Paystack) and VTU providers.
	authMod := auth.New(cfg, db, rdb, log)
	finMod := finance.New(cfg, db, rdb, log)
	supportMod := support.New(db, log)
	finance.SetAuthMiddleware(authMod.Auth)
	support.SetAuthMiddleware(authMod.Auth)

	// Background workers: reconciliation, provider health, renewals.
	go finMod.RunReconciler(ctx, 60*time.Second)
	go finMod.RunProviderHealth(ctx, 45*time.Second)

	if *workerOnly {
		log.Info("worker mode: HTTP listener disabled")
		<-ctx.Done()
		return
	}

	mux := platform.NewMux(cfg, log, rdb)
	authMod.Routes(mux)
	finMod.Routes(mux)
	supportMod.Routes(mux)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info("stark-api listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("http server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Info("stark-api stopped cleanly")
}
