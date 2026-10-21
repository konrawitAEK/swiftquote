package com.swiftquote.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * Domain failures mapped to the contract's ErrorResponse by the web layer. Messages are "kind: detail", exactly like
 * backend/go-service/internal/domain/errors.go, so every backend answers identically.
 */
public sealed class ApiException extends RuntimeException {

	/** The single 403 message used by every backend. */
	public static final String ROLE_FORBIDDEN = "forbidden: your role cannot perform this action";

	private ApiException(String message) {
		super(message);
	}

	public static NotFound notFound(String msg) {
		return new NotFound("not found: " + msg);
	}

	public static Conflict conflict(String msg) {
		return new Conflict("conflict: " + msg);
	}

	public static Unauthorized unauthorized(String msg) {
		return new Unauthorized("unauthorized: " + msg);
	}

	public static Forbidden roleForbidden() {
		return new Forbidden(ROLE_FORBIDDEN);
	}

	public static Validation invalid(String detail) {
		return new Validation(List.of(detail));
	}

	public static final class NotFound extends ApiException {

		NotFound(String message) {
			super(message);
		}

	}

	public static final class Conflict extends ApiException {

		Conflict(String message) {
			super(message);
		}

	}

	public static final class Unauthorized extends ApiException {

		Unauthorized(String message) {
			super(message);
		}

	}

	public static final class Forbidden extends ApiException {

		Forbidden(String message) {
			super(message);
		}

	}

	public static final class Validation extends ApiException {

		private final List<String> details;

		public Validation(List<String> details) {
			super("request validation failed");
			this.details = List.copyOf(details);
		}

		public List<String> details() {
			return this.details;
		}

	}

	/** Collects field problems; {@link #throwIfAny()} raises them as one 400. */
	public static final class Problems {

		private final List<String> details = new ArrayList<>();

		public void add(String detail) {
			this.details.add(detail);
		}

		public boolean isEmpty() {
			return this.details.isEmpty();
		}

		public void throwIfAny() {
			if (!this.details.isEmpty()) {
				throw new Validation(this.details);
			}
		}

	}

}
