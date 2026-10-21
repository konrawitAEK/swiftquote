package com.swiftquote.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.swiftquote.domain.Login;

@Repository
public class AuthRepository {

	private final JdbcClient jdbc;

	public AuthRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** Looks a user up by email (case-insensitive); a user in several tenants logs into their earliest membership. */
	public Optional<Login> findLogin(String email) {
		return this.jdbc.sql("""
				SELECT u.id, u.email, u.password_hash, u.full_name, m.organization_id, m.role
				FROM users u
				JOIN organization_members m ON m.user_id = u.id
				WHERE lower(u.email) = lower(:email)
				ORDER BY m.created_at
				LIMIT 1""")
			.param("email", email)
			.query((rs, n) -> new Login(rs.getObject("id", UUID.class), rs.getString("email"),
					rs.getString("password_hash"), rs.getString("full_name"),
					rs.getObject("organization_id", UUID.class), rs.getString("role")))
			.optional();
	}

}
