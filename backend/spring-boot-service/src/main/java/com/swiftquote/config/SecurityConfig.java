package com.swiftquote.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Stateless bearer-token security. Tokens are HS256 with the shared JWT_SECRET, so a token issued by the Go service
 * is accepted here and vice versa.
 */
@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

	@Bean
	SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
		AuthenticationEntryPoint unauthorized = SecurityConfig::writeUnauthorized;
		http.csrf((csrf) -> csrf.disable())
			.cors(Customizer.withDefaults())
			.sessionManagement((s) -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			// Only tenant routes need a token; unknown routes fall through to a 404 like the Go service.
			.authorizeHttpRequests((auth) -> auth.requestMatchers("/api/v1/clients", "/api/v1/quotes", "/api/v1/quotes/**")
				.authenticated()
				.anyRequest()
				.permitAll())
			.oauth2ResourceServer((rs) -> rs.jwt(Customizer.withDefaults()).authenticationEntryPoint(unauthorized))
			.exceptionHandling((e) -> e.authenticationEntryPoint(unauthorized));
		return http.build();
	}

	/** Same 401 body as the Go service; messages distinguish a missing token from a bad one. */
	private static void writeUnauthorized(HttpServletRequest request, HttpServletResponse response,
			AuthenticationException ex) throws IOException {
		String header = request.getHeader("Authorization");
		boolean hasBearer = header != null && header.startsWith("Bearer ") && header.length() > 7;
		String message = hasBearer ? "unauthorized: invalid or expired token" : "unauthorized: missing bearer token";
		response.setStatus(HttpStatus.UNAUTHORIZED.value());
		response.setContentType(MediaType.APPLICATION_JSON_VALUE);
		response.setCharacterEncoding(StandardCharsets.UTF_8.name());
		response.getWriter().write("{\"code\":\"UNAUTHORIZED\",\"message\":\"" + message + "\"}");
	}

	@Bean
	SecretKey jwtKey(@Value("${swiftquote.jwt-secret}") String secret) {
		byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
		if (bytes.length < 32) {
			throw new IllegalStateException("JWT_SECRET is required and must be at least 32 bytes");
		}
		return new SecretKeySpec(bytes, "HmacSHA256");
	}

	@Bean
	JwtEncoder jwtEncoder(SecretKey jwtKey) {
		return NimbusJwtEncoder.withSecretKey(jwtKey).algorithm(MacAlgorithm.HS256).build();
	}

	@Bean
	JwtDecoder jwtDecoder(SecretKey jwtKey) {
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(jwtKey).macAlgorithm(MacAlgorithm.HS256).build();
		// Like the Go service, tokens without an expiry are rejected.
		decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefault(),
				new JwtClaimValidator<Instant>("exp", Objects::nonNull)));
		return decoder;
	}

	@Bean
	PasswordEncoder passwordEncoder() {
		return new BCryptPasswordEncoder();
	}

	@Bean
	CorsConfigurationSource corsConfigurationSource(@Value("${swiftquote.cors-origins}") String origins) {
		CorsConfiguration cors = new CorsConfiguration();
		cors.setAllowedOrigins(Arrays.stream(origins.split(",")).map(String::strip).filter((o) -> !o.isEmpty()).toList());
		cors.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
		cors.setAllowedHeaders(List.of("Authorization", "Content-Type"));
		UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
		source.registerCorsConfiguration("/**", cors);
		return source;
	}

	@Bean
	Clock clock() {
		return Clock.systemUTC();
	}

}
