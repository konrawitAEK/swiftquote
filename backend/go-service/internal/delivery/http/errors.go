package http

import (
	"errors"
	"log"

	"github.com/gofiber/fiber/v2"

	"github.com/konrawitAEK/swiftquote/backend/go-service/internal/domain"
)

// Error codes are part of the contract (ErrorResponse.code) and must match spring-boot-service.
const (
	codeValidation   = "VALIDATION_ERROR"
	codeUnauthorized = "UNAUTHORIZED"
	codeNotFound     = "NOT_FOUND"
	codeConflict     = "CONFLICT"
	codeInternal     = "INTERNAL_ERROR"
)

// errorHandler is Fiber's central error mapper: handlers just return domain errors.
func errorHandler(c *fiber.Ctx, err error) error {
	status, body := toErrorResponse(err)
	return c.Status(status).JSON(body)
}

func toErrorResponse(err error) (int, errorResponse) {
	var verr *domain.ValidationError
	var ferr *fiber.Error
	switch {
	case errors.As(err, &verr):
		return fiber.StatusBadRequest, errorResponse{Code: codeValidation, Message: "request validation failed", Details: verr.Details}
	case errors.Is(err, domain.ErrUnauthorized):
		return fiber.StatusUnauthorized, errorResponse{Code: codeUnauthorized, Message: err.Error()}
	case errors.Is(err, domain.ErrNotFound):
		return fiber.StatusNotFound, errorResponse{Code: codeNotFound, Message: err.Error()}
	case errors.Is(err, domain.ErrConflict):
		return fiber.StatusConflict, errorResponse{Code: codeConflict, Message: err.Error()}
	case errors.As(err, &ferr) && ferr.Code == fiber.StatusNotFound:
		return fiber.StatusNotFound, errorResponse{Code: codeNotFound, Message: "route not found"}
	case errors.As(err, &ferr) && ferr.Code < fiber.StatusInternalServerError:
		return ferr.Code, errorResponse{Code: codeValidation, Message: ferr.Message}
	default:
		log.Printf("internal error: %v", err)
		return fiber.StatusInternalServerError, errorResponse{Code: codeInternal, Message: "internal server error"}
	}
}
