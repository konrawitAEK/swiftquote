package com.swiftquote.domain;

import java.util.UUID;

/** A lightweight {id, name} reference used in responses. */
public record Ref(UUID id, String name) {

	/** Null unless both parts are present, like the Go repositories' ref(). */
	public static Ref of(UUID id, String name) {
		return (id != null && name != null) ? new Ref(id, name) : null;
	}

}
