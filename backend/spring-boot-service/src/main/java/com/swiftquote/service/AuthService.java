package com.swiftquote.service;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Service;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.GoText;
import com.swiftquote.repository.AuthRepository;

/**
 * Login, token issuance/verification and loading the calling actor (backend/go-service/internal/auth/service.go).
 * Token claims are part of the cross-backend contract: HS256, sub = user id, tid = tenant id, role, iat, exp. The role
 * claim is informational; the actor's current role and active flag are read from the database on every request.
 */
@Service
public class AuthService {

	private static final Duration TOKEN_TTL = Duration.ofHours(24);

	private final AuthRepository repository;

	private final PasswordEncoder passwordEncoder;

	private final JwtEncoder jwtEncoder;

	private final JwtDecoder jwtDecoder;

	private final Clock clock;

	public AuthService(AuthRepository repository, PasswordEncoder passwordEncoder, JwtEncoder jwtEncoder,
			JwtDecoder jwtDecoder, Clock clock) {
		this.repository = repository;
		this.passwordEncoder = passwordEncoder;
		this.jwtEncoder = jwtEncoder;
		this.jwtDecoder = jwtDecoder;
		this.clock = clock;
	}

	public record LoginResult(String accessToken, AuthRepository.Login login) {
	}

	/** Unknown email, inactive account and wrong password all fail the same way. */
	public LoginResult login(String email, String password) {
		AuthRepository.Login login = this.repository.findLogin(GoText.trim(email))
			.filter((l) -> matches(password, l.passwordHash()))
			.orElseThrow(() -> ApiException.unauthorized("invalid email or password"));

		Instant now = this.clock.instant();
		JwtClaimsSet claims = JwtClaimsSet.builder()
			.claim("tid", login.organizationId().toString())
			.claim("role", login.role())
			.subject(login.userId().toString())
			.issuedAt(now)
			.expiresAt(now.plus(TOKEN_TTL))
			.build();
		JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
		String token = this.jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
		return new LoginResult(token, login);
	}

	private boolean matches(String password, String hash) {
		// bcrypt only looks at the first 72 bytes; Go's bcrypt rejects longer passwords, so they never match.
		if (password.getBytes(StandardCharsets.UTF_8).length > 72) {
			return false;
		}
		try {
			return this.passwordEncoder.matches(password, hash);
		}
		catch (RuntimeException ex) {
			return false;
		}
	}

	/** Verifies a bearer token and loads the actor it belongs to. */
	public Actor authenticate(String token) {
		Jwt jwt;
		try {
			jwt = this.jwtDecoder.decode(token);
		}
		catch (JwtException | IllegalArgumentException ex) {
			throw ApiException.unauthorized("invalid or expired token");
		}
		UUID userId = GoText.parseUuid(jwt.getSubject());
		UUID tenantId = GoText.parseUuid(claim(jwt, "tid"));
		if (userId == null || tenantId == null) {
			throw ApiException.unauthorized("invalid or expired token");
		}
		return this.repository.loadActor(tenantId, userId)
			.orElseThrow(() -> ApiException.unauthorized("account is inactive"));
	}

	private static String claim(Jwt jwt, String name) {
		Object v = jwt.getClaims().get(name);
		return (v instanceof String s) ? s : null;
	}

	/** Shared with user administration so all hashes use the same cost. */
	public String hashPassword(String password) {
		return this.passwordEncoder.encode(password);
	}

}
