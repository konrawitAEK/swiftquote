package com.swiftquote.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.Login;
import com.swiftquote.repository.AuthRepository;

/**
 * Login and token issuance. Token claims are part of the cross-backend contract (BearerAuth in
 * contracts/openapi.yaml): HS256, sub = user id, tid = tenant id, role, iat, exp.
 */
@Service
public class AuthService {

	private static final Duration TOKEN_TTL = Duration.ofHours(24);

	private final AuthRepository repository;

	private final PasswordEncoder passwordEncoder;

	private final JwtEncoder jwtEncoder;

	private final Clock clock;

	public AuthService(AuthRepository repository, PasswordEncoder passwordEncoder, JwtEncoder jwtEncoder,
			Clock clock) {
		this.repository = repository;
		this.passwordEncoder = passwordEncoder;
		this.jwtEncoder = jwtEncoder;
		this.clock = clock;
	}

	public record LoginResult(String accessToken, Login login) {
	}

	/** Unknown email and wrong password fail the same way. */
	public LoginResult login(String email, String password) {
		Login login = this.repository.findLogin((email != null) ? email.strip() : "")
			.filter((l) -> password != null && this.passwordEncoder.matches(password, l.passwordHash()))
			.orElseThrow(() -> new ApiException.Unauthorized("unauthorized: invalid email or password"));

		Instant now = this.clock.instant();
		JwtClaimsSet claims = JwtClaimsSet.builder()
			.subject(login.userId().toString())
			.claim("tid", login.organizationId().toString())
			.claim("role", login.role())
			.issuedAt(now)
			.expiresAt(now.plus(TOKEN_TTL))
			.build();
		JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
		String token = this.jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
		return new LoginResult(token, login);
	}

}
