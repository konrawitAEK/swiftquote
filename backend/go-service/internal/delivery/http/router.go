// Package http wires Fiber routes. API routes live under /api/v1 and must match contracts/openapi.yaml.
package http

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

// Pinger is satisfied by *pgxpool.Pool.
type Pinger interface {
	Ping(ctx context.Context) error
}

func NewRouter(db Pinger) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(recover.New(), logger.New())

	// Operational endpoint, intentionally outside /api/v1 and the contract.
	app.Get("/healthz", func(c *fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.UserContext(), 2*time.Second)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "degraded", "db": "down"})
		}
		return c.JSON(fiber.Map{"status": "ok", "db": "up"})
	})

	app.Group("/api/v1")
	return app
}
