// Package config loads service settings from environment variables (see docker-compose.yml).
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
)

type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
	// Storage selects the repository implementation: "memory" (default) or "postgres".
	Storage     string
	CORSOrigins string
}

func Load() (Config, error) {
	cfg := Config{
		Port:        getenv("PORT", "8080"),
		JWTSecret:   os.Getenv("JWT_SECRET"),
		Storage:     getenv("STORAGE", "memory"),
		CORSOrigins: getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://localhost:3002"),
	}
	if cfg.JWTSecret == "" {
		return Config{}, errors.New("JWT_SECRET is required")
	}
	if cfg.Storage != "memory" && cfg.Storage != "postgres" {
		return Config{}, fmt.Errorf("STORAGE must be memory or postgres, got %q", cfg.Storage)
	}

	dsn := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(getenv("DB_USER", "postgres"), getenv("DB_PASSWORD", "password")),
		Host:     fmt.Sprintf("%s:%s", getenv("DB_HOST", "localhost"), getenv("DB_PORT", "5432")),
		Path:     getenv("DB_NAME", "swiftquote"),
		RawQuery: "sslmode=" + getenv("DB_SSLMODE", "disable"),
	}
	cfg.DatabaseURL = dsn.String()
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
