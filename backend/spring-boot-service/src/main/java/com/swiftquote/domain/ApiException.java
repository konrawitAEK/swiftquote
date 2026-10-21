package com.swiftquote.domain;

import java.util.List;

/**
 * Domain failures mapped to the contract's ErrorResponse codes by the web layer. Codes and messages mirror the Go
 * service so both backends answer identically.
 */
public sealed class ApiException extends RuntimeException {

	private ApiException(String message) {
		super(message);
	}

	public static final class NotFound extends ApiException {

		public NotFound(String message) {
			super(message);
		}

	}

	public static final class Conflict extends ApiException {

		public Conflict(String message) {
			super(message);
		}

	}

	public static final class Unauthorized extends ApiException {

		public Unauthorized(String message) {
			super(message);
		}

	}

	public static final class Validation extends ApiException {

		private final List<String> details;

		public Validation(List<String> details) {
			super("request validation failed");
			this.details = List.copyOf(details);
		}

		public Validation(String detail) {
			this(List.of(detail));
		}

		public List<String> details() {
			return this.details;
		}

	}

}
