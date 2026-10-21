package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/config"
	httpdelivery "github.com/konrawitAEK/swiftquote/backend/go-service/internal/delivery/http"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/storage/memory"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if cfg.Storage == "postgres" {
		log.Fatal("STORAGE=postgres: Postgres repositories are not implemented yet; use STORAGE=memory")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store := memory.NewStore()
	store.Seed()
	log.Printf("memory storage seeded; login with %s / %s", memory.DemoEmail, memory.DemoPassword)

	app := httpdelivery.NewRouter(httpdelivery.Deps{
		Auth:        auth.NewService(store, cfg.JWTSecret),
		Quotes:      quote.NewService(store),
		CORSOrigins: cfg.CORSOrigins,
		Storage:     cfg.Storage,
		Ping:        func(context.Context) error { return nil },
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
