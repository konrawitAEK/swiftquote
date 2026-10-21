package com.swiftquote.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.swiftquote.domain.Client;

@Repository
public class ClientRepository {

	private final JdbcClient jdbc;

	public ClientRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public List<Client> list(UUID orgId) {
		return this.jdbc.sql("""
				SELECT id, organization_id, name, email
				FROM clients
				WHERE organization_id = :org
				ORDER BY name, id""")
			.param("org", orgId)
			.query((rs, n) -> new Client(rs.getObject("id", UUID.class), rs.getObject("organization_id", UUID.class),
					rs.getString("name"), rs.getString("email")))
			.list();
	}

	public boolean belongsTo(UUID orgId, UUID clientId) {
		return this.jdbc.sql("SELECT EXISTS (SELECT 1 FROM clients WHERE id = :client AND organization_id = :org)")
			.param("client", clientId)
			.param("org", orgId)
			.query(Boolean.class)
			.single();
	}

}
