package com.swiftquote.domain;

import java.util.UUID;

/** Classifies quote lines; retired categories stay on existing quotes. */
public record Category(UUID id, String name, boolean active) {
}
