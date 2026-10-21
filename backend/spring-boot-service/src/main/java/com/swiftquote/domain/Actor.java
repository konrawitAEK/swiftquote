package com.swiftquote.domain;

import java.util.UUID;

/**
 * The authenticated caller, loaded from the database on every request so role changes and deactivation apply
 * immediately. teamId is set for RMs, clientId for customers.
 */
public record Actor(UUID userId, String name, UUID tenantId, String role, UUID teamId, UUID clientId) {
}
