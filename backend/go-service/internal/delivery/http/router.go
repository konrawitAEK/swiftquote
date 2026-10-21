// Package http wires Fiber routes. API routes live under /api/v1 and must match contracts/openapi.yaml.
package http

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/admin"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/auth"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/client"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/dashboard"
	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/quote"
)

type Deps struct {
	Auth        *auth.Service
	Clients     *client.Service
	Quotes      *quote.Service
	Admin       *admin.Service
	Dashboard   *dashboard.Service
	CORSOrigins string
	// Ping checks the database for /healthz.
	Ping func(ctx context.Context) error
}

func NewRouter(d Deps) *fiber.App {
	app := fiber.New(fiber.Config{DisableStartupMessage: true, ErrorHandler: errorHandler})
	app.Use(recover.New(), logger.New(), cors.New(cors.Config{
		AllowOrigins: d.CORSOrigins,
		AllowHeaders: "Authorization, Content-Type",
		AllowMethods: "GET,POST,PUT,OPTIONS",
	}))

	// Operational endpoint, intentionally outside /api/v1 and the contract.
	app.Get("/healthz", func(c *fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.UserContext(), 2*time.Second)
		defer cancel()
		if err := d.Ping(ctx); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"status": "degraded", "storage": "postgres"})
		}
		return c.JSON(fiber.Map{"status": "ok", "storage": "postgres"})
	})

	h := &handlers{auth: d.Auth, clients: d.Clients, quotes: d.Quotes, admin: d.Admin, dashboard: d.Dashboard}
	api := app.Group("/api/v1")
	api.Post("/auth/login", h.login)

	api.Get("/clients", h.requireAuth, h.listClients)

	api.Get("/quotes", h.requireAuth, h.listQuotes)
	api.Post("/quotes", h.requireAuth, h.createQuote)
	api.Get("/quotes/:id", h.requireAuth, h.getQuote)
	api.Put("/quotes/:id", h.requireAuth, h.updateQuote)
	api.Post("/quotes/:id/submit", h.requireAuth, h.quoteAction(submitQuote))
	api.Post("/quotes/:id/approve", h.requireAuth, h.quoteAction(approveQuote))
	api.Post("/quotes/:id/return", h.requireAuth, h.quoteAction(returnQuote))
	api.Post("/quotes/:id/send", h.requireAuth, h.quoteAction(sendQuote))
	api.Post("/quotes/:id/accept", h.requireAuth, h.acceptQuote)
	api.Post("/quotes/:id/reject", h.requireAuth, h.quoteAction(rejectQuote))

	api.Get("/dashboard/summary", h.requireAuth, h.dashboardSummary)

	api.Get("/admin/users", h.requireAuth, h.listUsers)
	api.Post("/admin/users", h.requireAuth, h.createUser)
	api.Put("/admin/users/:id", h.requireAuth, h.updateUser)
	api.Get("/admin/teams", h.requireAuth, h.listTeams)
	api.Post("/admin/teams", h.requireAuth, h.createTeam)
	api.Put("/admin/teams/:id", h.requireAuth, h.updateTeam)

	api.Get("/public/quotes/:accessToken", h.getPublicQuote)
	api.Post("/public/quotes/:accessToken/accept", h.acceptPublicQuote)
	api.Post("/public/quotes/:accessToken/reject", h.rejectPublicQuote)
	return app
}
