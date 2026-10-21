package domain

import "errors"

// Sentinel errors shared by use cases and repositories; the HTTP layer maps them to ErrorResponse codes.
var (
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("conflict")
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
)

// ErrRoleForbidden is the single 403 message used by every backend.
var ErrRoleForbidden = errorf(ErrForbidden, "your role cannot perform this action")

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

// Invalid is a ValidationError with a single detail.
func Invalid(detail string) error {
	return &ValidationError{Details: []string{detail}}
}

type wrapped struct {
	sentinel error
	msg      string
}

func (w *wrapped) Error() string { return w.sentinel.Error() + ": " + w.msg }
func (w *wrapped) Unwrap() error { return w.sentinel }

func errorf(sentinel error, msg string) error { return &wrapped{sentinel: sentinel, msg: msg} }

// NotFound, Conflict and Unauthorized build "<kind>: <msg>" errors matching the other backends' messages.
func NotFound(msg string) error     { return errorf(ErrNotFound, msg) }
func Conflict(msg string) error     { return errorf(ErrConflict, msg) }
func Unauthorized(msg string) error { return errorf(ErrUnauthorized, msg) }
