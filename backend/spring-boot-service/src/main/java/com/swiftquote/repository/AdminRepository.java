package com.swiftquote.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

import com.swiftquote.domain.Ref;

/** Users and teams (backend/go-service/internal/storage/postgres/admin.go). */
@Repository
public class AdminRepository {

	/** A unique email or team name already exists. */
	public static final class DuplicateException extends RuntimeException {

		DuplicateException(Throwable cause) {
			super(cause);
		}

	}

	public record User(UUID id, String email, String name, String role, boolean active, Ref team, Ref client) {
	}

	public record Team(UUID id, String name, Ref wo, List<Ref> members) {
	}

	/** The writable part of a user; password is optional on update, active required on update. */
	public record UserInput(String email, String name, String password, String role, Boolean active, UUID teamId,
			UUID clientId) {
	}

	private static final String USER_SELECT = """
			SELECT u.id, u.email, u.full_name, m.role, m.active, t.id, t.name, c.id, c.name
			FROM organization_members m
			JOIN users u ON u.id = m.user_id
			LEFT JOIN teams t ON t.id = m.team_id
			LEFT JOIN clients c ON c.id = m.client_id""";

	private final JdbcClient jdbc;

	private final TransactionTemplate tx;

	public AdminRepository(JdbcClient jdbc, TransactionTemplate tx) {
		this.jdbc = jdbc;
		this.tx = tx;
	}

	private static User scanUser(ResultSet rs) throws SQLException {
		return new User(Rows.uuid(rs, 1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getBoolean(5),
				Ref.of(Rows.uuid(rs, 6), rs.getString(7)), Ref.of(Rows.uuid(rs, 8), rs.getString(9)));
	}

	public List<User> listUsers(UUID orgId) {
		return this.jdbc.sql(USER_SELECT + " WHERE m.organization_id = :org ORDER BY u.full_name, u.id")
			.param("org", orgId)
			.query((rs, n) -> scanUser(rs))
			.list();
	}

	public Optional<User> getUser(UUID orgId, UUID id) {
		return this.jdbc.sql(USER_SELECT + " WHERE m.organization_id = :org AND u.id = :id")
			.param("org", orgId)
			.param("id", id)
			.query((rs, n) -> scanUser(rs))
			.optional();
	}

	public UUID createUser(UUID orgId, UserInput in, String passwordHash) {
		UUID id = UUID.randomUUID();
		this.tx.executeWithoutResult((status) -> {
			try {
				this.jdbc.sql("INSERT INTO users (id, email, password_hash, full_name) VALUES (:id, :email, :hash, :name)")
					.param("id", id)
					.param("email", in.email())
					.param("hash", passwordHash)
					.param("name", in.name())
					.update();
			}
			catch (DuplicateKeyException ex) {
				throw new DuplicateException(ex);
			}
			this.jdbc.sql("""
					INSERT INTO organization_members (organization_id, user_id, role, team_id, client_id, active)
					VALUES (:org, :id, :role, :team, :client, TRUE)""")
				.param("org", orgId)
				.param("id", id)
				.param("role", in.role())
				.param("team", in.teamId())
				.param("client", in.clientId())
				.update();
		});
		return id;
	}

	/** Replaces name and membership; a non-null passwordHash resets the password. */
	public void updateUser(UUID orgId, UUID id, UserInput in, String passwordHash) {
		this.tx.executeWithoutResult((status) -> {
			this.jdbc.sql("UPDATE users SET full_name = :name, password_hash = COALESCE(CAST(:hash AS varchar), password_hash) WHERE id = :id")
				.param("id", id)
				.param("name", in.name())
				.param("hash", passwordHash)
				.update();
			this.jdbc.sql("""
					UPDATE organization_members SET role = :role, team_id = :team, client_id = :client, active = :active
					WHERE organization_id = :org AND user_id = :id""")
				.param("org", orgId)
				.param("id", id)
				.param("role", in.role())
				.param("team", in.teamId())
				.param("client", in.clientId())
				.param("active", in.active())
				.update();
		});
	}

	public boolean teamExists(UUID orgId, UUID teamId) {
		return exists("SELECT EXISTS (SELECT 1 FROM teams WHERE id = :a AND organization_id = :org)", teamId, orgId);
	}

	public boolean leadsTeam(UUID orgId, UUID userId) {
		return exists("SELECT EXISTS (SELECT 1 FROM teams WHERE wo_user_id = :a AND organization_id = :org)", userId,
				orgId);
	}

	public boolean isActiveWo(UUID orgId, UUID userId) {
		return exists("""
				SELECT EXISTS (SELECT 1 FROM organization_members
					WHERE user_id = :a AND organization_id = :org AND role = 'wo' AND active)""", userId, orgId);
	}

	private boolean exists(String sql, UUID a, UUID orgId) {
		return this.jdbc.sql(sql).param("a", a).param("org", orgId).query(Boolean.class).single();
	}

	public List<Team> listTeams(UUID orgId) {
		return teams(orgId, null);
	}

	public Optional<Team> getTeam(UUID orgId, UUID id) {
		return teams(orgId, id).stream().findFirst();
	}

	/** Teams (all, or one) with their WO and active RMs. */
	private List<Team> teams(UUID orgId, UUID only) {
		JdbcClient.StatementSpec spec = this.jdbc.sql("""
				SELECT t.id, t.name, w.id, w.full_name
				FROM teams t
				LEFT JOIN users w ON w.id = t.wo_user_id
				WHERE t.organization_id = :org""" + ((only != null) ? " AND t.id = :only" : "") + """

				ORDER BY t.name, t.id""").param("org", orgId);
		if (only != null) {
			spec = spec.param("only", only);
		}
		Map<UUID, Team> teams = new LinkedHashMap<>();
		spec.query((rs, n) -> new Team(Rows.uuid(rs, 1), rs.getString(2), Ref.of(Rows.uuid(rs, 3), rs.getString(4)),
				new ArrayList<>()))
			.list()
			.forEach((t) -> teams.put(t.id(), t));
		if (teams.isEmpty()) {
			return List.of();
		}
		this.jdbc.sql("""
				SELECT m.team_id, u.id, u.full_name
				FROM organization_members m
				JOIN users u ON u.id = m.user_id
				WHERE m.organization_id = :org AND m.role = 'rm' AND m.active AND m.team_id IS NOT NULL
				ORDER BY u.full_name, u.id""").param("org", orgId).query((rs) -> {
			Team t = teams.get(Rows.uuid(rs, 1));
			if (t != null) {
				t.members().add(new Ref(Rows.uuid(rs, 2), rs.getString(3)));
			}
		});
		return List.copyOf(teams.values());
	}

	public UUID createTeam(UUID orgId, String name, UUID woUserId) {
		UUID id = UUID.randomUUID();
		try {
			this.jdbc.sql("INSERT INTO teams (id, organization_id, name, wo_user_id) VALUES (:id, :org, :name, :wo)")
				.param("id", id)
				.param("org", orgId)
				.param("name", name)
				.param("wo", woUserId)
				.update();
		}
		catch (DuplicateKeyException ex) {
			throw new DuplicateException(ex);
		}
		return id;
	}

	public void updateTeam(UUID orgId, UUID id, String name, UUID woUserId) {
		try {
			this.jdbc.sql("UPDATE teams SET name = :name, wo_user_id = :wo WHERE id = :id AND organization_id = :org")
				.param("org", orgId)
				.param("id", id)
				.param("name", name)
				.param("wo", woUserId)
				.update();
		}
		catch (DuplicateKeyException ex) {
			throw new DuplicateException(ex);
		}
	}

}
