// Package http wires Fiber routes. API routes live under /api/v1 and must match contracts/openapi.yaml.
package http

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/client"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
)

type Deps struct {
	Auth        *auth.Service
	Clients     *client.Service
	Quotes      *quote.Service
	CORSOrigins string
	// Storage names the active backing store for /healthz; Ping checks it.
	Storage string
	Ping    func(ctx context.Context) error
}

func NewRouter(d Deps) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true, ErrorHandler: errorHandler})
	app.Use(recover.New(), logger.New(), cors.New(cors.Config{
		AllowOrigins: d.CORSOrigins,
		AllowHeaders: "Authorization, Content-Type",
	}))

	// Operational endpoint, intentionally outside /api/v1 and the contract.
	app.Get("/healthz", func(c *fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.UserContext(), 2*time.Second)
		defer cancel()
		if err := d.Ping(ctx); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "degraded", "storage": d.Storage})
		}
		return c.JSON(fiber.Map{"status": "ok", "storage": d.Storage})
	})

	h := &handlers{auth: d.Auth, clients: d.Clients, quotes: d.Quotes}
	api := app.Group("/api/v1")
	api.Post("/auth/login", h.login)
	api.Get("/clients", h.requireAuth, h.listClients)
	api.Get("/quotes", h.requireAuth, h.listQuotes)
	api.Post("/quotes", h.requireAuth, h.createQuote)
	api.Get("/quotes/:id", h.requireAuth, h.getQuote)
	api.Get("/public/quotes/:accessToken", h.getPublicQuote)
	api.Post("/public/quotes/:accessToken/accept", h.acceptPublicQuote)
	return app
}
