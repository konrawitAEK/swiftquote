package com.swiftquote.web.rest;

import java.util.List;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import com.swiftquote.domain.ApiException;
import com.swiftquote.web.rest.Dtos.ErrorResponse;

/** Maps failures to the contract's ErrorResponse exactly like backend/go-service/internal/delivery/http/errors.go. */
@RestControllerAdvice
class ApiExceptionHandler {

	private static final Log logger = LogFactory.getLog(ApiExceptionHandler.class);

	@ExceptionHandler
	ResponseEntity<ErrorResponse> handle(ApiException ex) {
		return switch (ex) {
			case ApiException.Validation v ->
				error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", v.getMessage(), v.details());
			case ApiException.Unauthorized u -> error(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", u.getMessage(), null);
			case ApiException.Forbidden f -> error(HttpStatus.FORBIDDEN, "FORBIDDEN", f.getMessage(), null);
			case ApiException.NotFound n -> error(HttpStatus.NOT_FOUND, "NOT_FOUND", n.getMessage(), null);
			case ApiException.Conflict c -> error(HttpStatus.CONFLICT, "CONFLICT", c.getMessage(), null);
			default -> internal(ex);
		};
	}

	@ExceptionHandler({ NoResourceFoundException.class, NoHandlerFoundException.class })
	ResponseEntity<ErrorResponse> noRoute(Exception ex) {
		return error(HttpStatus.NOT_FOUND, "NOT_FOUND", "route not found", null);
	}

	/** Fiber answers a known path with the wrong method with 405 and its status text. */
	@ExceptionHandler
	ResponseEntity<ErrorResponse> methodNotAllowed(HttpRequestMethodNotSupportedException ex) {
		return error(HttpStatus.METHOD_NOT_ALLOWED, "VALIDATION_ERROR", "Method Not Allowed", null);
	}

	@ExceptionHandler
	ResponseEntity<ErrorResponse> unexpected(Exception ex) {
		return internal(ex);
	}

	private ResponseEntity<ErrorResponse> internal(Exception ex) {
		logger.error("internal error", ex);
		return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "internal server error", null);
	}

	private static ResponseEntity<ErrorResponse> error(HttpStatus status, String code, String message,
			List<String> details) {
		return ResponseEntity.status(status).body(new ErrorResponse(code, message, details));
	}

}
