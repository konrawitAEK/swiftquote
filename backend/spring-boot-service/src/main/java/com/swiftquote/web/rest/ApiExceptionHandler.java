package com.swiftquote.web.rest;

import java.util.List;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import com.swiftquote.domain.ApiException;
import com.swiftquote.web.rest.Dtos.ErrorResponse;

/** Maps failures to the contract's ErrorResponse; codes must match the Go service. */
@RestControllerAdvice
class ApiExceptionHandler {

	static final String VALIDATION = "VALIDATION_ERROR";

	static final String UNAUTHORIZED = "UNAUTHORIZED";

	static final String NOT_FOUND = "NOT_FOUND";

	static final String CONFLICT = "CONFLICT";

	static final String INTERNAL = "INTERNAL_ERROR";

	private static final Log logger = LogFactory.getLog(ApiExceptionHandler.class);

	@ExceptionHandler
	ResponseEntity<ErrorResponse> handle(ApiException ex) {
		return switch (ex) {
			case ApiException.Validation v -> error(HttpStatus.BAD_REQUEST, VALIDATION, v.getMessage(), v.details());
			case ApiException.Unauthorized u -> error(HttpStatus.UNAUTHORIZED, UNAUTHORIZED, u.getMessage(), null);
			case ApiException.NotFound n -> error(HttpStatus.NOT_FOUND, NOT_FOUND, n.getMessage(), null);
			case ApiException.Conflict c -> error(HttpStatus.CONFLICT, CONFLICT, c.getMessage(), null);
			default -> internal(ex);
		};
	}

	@ExceptionHandler
	ResponseEntity<ErrorResponse> malformedBody(HttpMessageNotReadableException ex) {
		String cause = (ex.getMostSpecificCause() != null) ? ex.getMostSpecificCause().getMessage() : ex.getMessage();
		return error(HttpStatus.BAD_REQUEST, VALIDATION, "request validation failed",
				List.of("malformed JSON body: " + firstLine(cause)));
	}

	@ExceptionHandler
	ResponseEntity<ErrorResponse> noRoute(NoResourceFoundException ex) {
		return error(HttpStatus.NOT_FOUND, NOT_FOUND, "route not found", null);
	}

	@ExceptionHandler
	ResponseEntity<ErrorResponse> methodNotAllowed(HttpRequestMethodNotSupportedException ex) {
		return error(HttpStatus.METHOD_NOT_ALLOWED, VALIDATION, "Method Not Allowed", null);
	}

	@ExceptionHandler
	ResponseEntity<ErrorResponse> unexpected(Exception ex) {
		return internal(ex);
	}

	private ResponseEntity<ErrorResponse> internal(Exception ex) {
		logger.error("internal error", ex);
		return error(HttpStatus.INTERNAL_SERVER_ERROR, INTERNAL, "internal server error", null);
	}

	static ResponseEntity<ErrorResponse> error(HttpStatus status, String code, String message, List<String> details) {
		return ResponseEntity.status(status).body(new ErrorResponse(code, message, details));
	}

	private static String firstLine(String s) {
		if (s == null) {
			return "";
		}
		int nl = s.indexOf('\n');
		return (nl >= 0) ? s.substring(0, nl) : s;
	}

}
