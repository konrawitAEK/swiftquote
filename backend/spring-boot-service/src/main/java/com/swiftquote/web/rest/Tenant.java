package com.swiftquote.web.rest;

import java.util.UUID;

import org.springframework.security.oauth2.jwt.Jwt;

import com.swiftquote.domain.ApiException;

/** The caller's tenant, read from the verified token's {@code tid} claim. */
final class Tenant {

	private Tenant() {
	}

	static UUID of(Jwt jwt) {
		try {
			return UUID.fromString(jwt.getClaimAsString("tid"));
		}
		catch (RuntimeException ex) {
			throw new ApiException.Unauthorized("unauthorized: invalid or expired token");
		}
	}

}
