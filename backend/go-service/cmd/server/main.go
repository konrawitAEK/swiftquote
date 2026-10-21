package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/client"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/config"
	httpdelivery "github.com/konrawitAEK/swiftquote/backend/go-service/internal/delivery/http"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/storage/memory"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/storage/postgres"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	var store interface {
		auth.Repository
		client.Repository
		quote.Repository
	}
	ping := func(context.Context) error { return nil }
	switch cfg.Storage {
	case "postgres":
		// The pool connects lazily, so the server starts even while Postgres is still booting;
		// /healthz reports DB readiness.
		pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("db pool: %v", err)
		}
		defer pool.Close()
		store, ping = postgres.New(pool), pool.Ping
	default:
		mem := memory.NewStore()
		mem.Seed()
		store = mem
		log.Printf("memory storage seeded; login with %s / %s", memory.DemoEmail, memory.DemoPassword)
	}

	app := httpdelivery.NewRouter(httpdelivery.Deps{
		Auth:        auth.NewService(store, cfg.JWTSecret),
		Clients:     client.NewService(store),
		Quotes:      quote.NewService(store),
		CORSOrigins: cfg.CORSOrigins,
		Storage:     cfg.Storage,
		Ping:        ping,
	})

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := app.ShutdownWithContext(shutdownCtx); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()

	log.Printf("swiftquote go-service listening on :%s (storage=%s)", cfg.Port, cfg.Storage)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("listen: %v", err)
	}
}
