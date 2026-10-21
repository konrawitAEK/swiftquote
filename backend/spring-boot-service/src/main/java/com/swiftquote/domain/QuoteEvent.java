package com.swiftquote.domain;

import java.time.Instant;

/** One audit-trail entry. actor is null when a customer acted through the share link. */
public record QuoteEvent(String action, Ref actor, String comment, Instant at) {
}
