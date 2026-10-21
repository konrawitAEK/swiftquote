package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/admin"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/catalog"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/client"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/config"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/dashboard"
	httpdelivery "github.com/konrawitAEK/swiftquote/backend/go-service/internal/delivery/http"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/storage/postgres"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// The pool connects lazily, so the server starts even while Postgres is still booting;
	// /healthz reports DB readiness.
	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db pool: %v", err)
	}
	defer pool.Close()
	store := postgres.New(pool)

	app := httpdelivery.NewRouter(httpdelivery.Deps{
		Auth:        auth.NewService(store, cfg.JWTSecret),
		Catalog:     catalog.NewService(store),
		Clients:     client.NewService(store),
		Quotes:      quote.NewService(store),
		Admin:       admin.NewService(store),
		Dashboard:   dashboard.NewService(store),
		CORSOrigins: cfg.CORSOrigins,
		Ping:        pool.Ping,
	})

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := app.ShutdownWithContext(shutdownCtx); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()

	log.Printf("swiftquote go-service listening on :%s", cfg.Port)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("listen: %v", err)
	}
}
