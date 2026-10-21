package com.swiftquote.domain;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

import com.fasterxml.jackson.annotation.JsonValue;

public enum QuoteStatus {

	DRAFT, SENT, VIEWED, ACCEPTED, REJECTED, EXPIRED;

	/** States from which a client may still sign. */
	public static final List<QuoteStatus> ACCEPTABLE = List.of(DRAFT, SENT, VIEWED);

	/** Wire and database value, as in contracts/openapi.yaml. */
	@JsonValue
	public String value() {
		return name().toLowerCase(Locale.ROOT);
	}

	public static Optional<QuoteStatus> parse(String value) {
		return Arrays.stream(values()).filter((s) -> s.value().equals(value)).findFirst();
	}

}
