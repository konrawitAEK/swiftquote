package com.swiftquote.web.rest;

import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Operational endpoint, intentionally outside /api/v1 and the contract; same shape as the Go service. */
@RestController
class HealthController {

	private final JdbcClient jdbc;

	HealthController(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	@GetMapping("/healthz")
	ResponseEntity<Map<String, String>> health() {
		try {
			this.jdbc.sql("SELECT 1").query(Integer.class).single();
			return ResponseEntity.ok(Map.of("status", "ok", "storage", "postgres"));
		}
		catch (RuntimeException ex) {
			return ResponseEntity.status(503).body(Map.of("status", "degraded", "storage", "postgres"));
		}
	}

}
