package com.swiftquote.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.Client;

/** Login, actor loading and the client directory (backend/go-service/internal/storage/postgres/store.go). */
@Repository
public class AuthRepository {

	public record Login(UUID userId, String email, String passwordHash, String fullName, UUID organizationId,
			String role) {
	}

	private final JdbcClient jdbc;

	public AuthRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	/** An active user by email (case-insensitive); a user in several tenants logs into their earliest membership. */
	public Optional<Login> findLogin(String email) {
		return this.jdbc.sql("""
				SELECT u.id, u.email, u.password_hash, u.full_name, m.organization_id, m.role
				FROM users u
				JOIN organization_members m ON m.user_id = u.id
				WHERE lower(u.email) = lower(:email) AND m.active
				ORDER BY m.created_at
				LIMIT 1""")
			.param("email", email)
			.query((rs, n) -> new Login(Rows.uuid(rs, 1), rs.getString(2), rs.getString(3), rs.getString(4),
					Rows.uuid(rs, 5), rs.getString(6)))
			.optional();
	}

	/** The active member userId of tenantId. */
	public Optional<Actor> loadActor(UUID tenantId, UUID userId) {
		return this.jdbc.sql("""
				SELECT u.full_name, m.role, m.team_id, m.client_id
				FROM organization_members m
				JOIN users u ON u.id = m.user_id
				WHERE m.organization_id = :org AND m.user_id = :user AND m.active""")
			.param("org", tenantId)
			.param("user", userId)
			.query((rs, n) -> new Actor(userId, rs.getString(1), tenantId, rs.getString(2), Rows.uuid(rs, 3),
					Rows.uuid(rs, 4)))
			.optional();
	}

	public List<Client> listClients(UUID orgId) {
		return this.jdbc.sql("""
				SELECT id, organization_id, name, COALESCE(email, '')
				FROM clients
				WHERE organization_id = :org
				ORDER BY name, id""")
			.param("org", orgId)
			.query((rs, n) -> new Client(Rows.uuid(rs, 1), Rows.uuid(rs, 2), rs.getString(3), rs.getString(4)))
			.list();
	}

	public boolean clientExists(UUID orgId, UUID clientId) {
		return this.jdbc.sql("SELECT EXISTS (SELECT 1 FROM clients WHERE id = :client AND organization_id = :org)")
			.param("client", clientId)
			.param("org", orgId)
			.query(Boolean.class)
			.single();
	}

}
