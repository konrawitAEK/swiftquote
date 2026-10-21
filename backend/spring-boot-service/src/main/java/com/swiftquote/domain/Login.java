package com.swiftquote.domain;

import java.util.UUID;

/** A user and the tenant membership they log into. */
public record Login(UUID userId, String email, String passwordHash, String fullName, UUID organizationId,
		String role) {
}
