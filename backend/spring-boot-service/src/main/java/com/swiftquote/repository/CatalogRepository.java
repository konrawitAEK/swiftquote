package com.swiftquote.repository;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.swiftquote.domain.Category;

/** Product categories (backend/go-service/internal/storage/postgres/catalog.go). */
@Repository
public class CatalogRepository {

	/** A category name already exists in the tenant. */
	public static final class DuplicateException extends RuntimeException {

		DuplicateException(Throwable cause) {
			super(cause);
		}

	}

	private final JdbcClient jdbc;

	public CatalogRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public List<Category> list(UUID orgId) {
		return this.jdbc.sql("SELECT id, name, active FROM product_categories WHERE organization_id = :org ORDER BY name, id")
			.param("org", orgId)
			.query((rs, n) -> new Category(Rows.uuid(rs, 1), rs.getString(2), rs.getBoolean(3)))
			.list();
	}

	public Optional<Category> get(UUID orgId, UUID id) {
		return this.jdbc.sql("SELECT id, name, active FROM product_categories WHERE organization_id = :org AND id = :id")
			.param("org", orgId)
			.param("id", id)
			.query((rs, n) -> new Category(Rows.uuid(rs, 1), rs.getString(2), rs.getBoolean(3)))
			.optional();
	}

	public UUID create(UUID orgId, String name) {
		UUID id = UUID.randomUUID();
		try {
			this.jdbc.sql("INSERT INTO product_categories (id, organization_id, name) VALUES (:id, :org, :name)")
				.param("id", id)
				.param("org", orgId)
				.param("name", name)
				.update();
		}
		catch (DuplicateKeyException ex) {
			throw new DuplicateException(ex);
		}
		return id;
	}

	public void update(UUID orgId, UUID id, String name, boolean active) {
		try {
			this.jdbc.sql("UPDATE product_categories SET name = :name, active = :active WHERE organization_id = :org AND id = :id")
				.param("org", orgId)
				.param("id", id)
				.param("name", name)
				.param("active", active)
				.update();
		}
		catch (DuplicateKeyException ex) {
			throw new DuplicateException(ex);
		}
	}

	public Set<UUID> activeIds(UUID orgId) {
		return new HashSet<>(this.jdbc.sql("SELECT id FROM product_categories WHERE organization_id = :org AND active")
			.param("org", orgId)
			.query((rs, n) -> Rows.uuid(rs, 1))
			.list());
	}

}
