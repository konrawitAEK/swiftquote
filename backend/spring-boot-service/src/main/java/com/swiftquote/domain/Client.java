package com.swiftquote.domain;

import java.util.UUID;

public record Client(UUID id, UUID organizationId, String name, String email) {
}
