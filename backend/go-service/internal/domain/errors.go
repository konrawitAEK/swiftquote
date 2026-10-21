package domain

import "errors"

// Sentinel errors shared by use cases and repositories; the HTTP layer maps them to ErrorResponse codes.
var (
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("conflict")
	ErrUnauthorized = errors.New("unauthorized")
)

// ValidationError carries field-level problems for a 400 VALIDATION_ERROR response.
type ValidationError struct {
	Details []string
}

func (e *ValidationError) Error() string {
	return "validation failed"
}

func (e *ValidationError) Add(detail string) {
	e.Details = append(e.Details, detail)
}

// OrNil returns e as an error only when it holds details.
func (e *ValidationError) OrNil() error {
	if len(e.Details) == 0 {
		return nil
	}
	return e
}
