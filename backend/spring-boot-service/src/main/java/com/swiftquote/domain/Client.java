package com.swiftquote.domain;

import java.util.UUID;

/** A tenant's customer company; email is "" when unknown. */
public record Client(UUID id, UUID organizationId, String name, String email) {
}
