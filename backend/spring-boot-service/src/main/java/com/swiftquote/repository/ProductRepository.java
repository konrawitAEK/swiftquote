package com.swiftquote.repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.swiftquote.domain.Product;
import com.swiftquote.domain.Ref;

/** Catalog products (backend/go-service/internal/storage/postgres/products.go). */
@Repository
public class ProductRepository {

	/** A product name already exists in the tenant. */
	public static final class DuplicateException extends RuntimeException {

		DuplicateException(Throwable cause) {
			super(cause);
		}

	}

	/** A delete hit a foreign key: a quote line started using the product after the service checked. */
	public static final class InUseException extends RuntimeException {

		InUseException(Throwable cause) {
			super(cause);
		}

	}

	/** The fields an admin sets; stock null means not tracked. */
	public record ProductInput(String name, UUID categoryId, BigDecimal unitPrice, BigDecimal unitCost,
			BigDecimal stock, boolean active) {
	}

	private static final String SELECT = """
			SELECT p.id, p.name, c.id, c.name, p.unit_price, p.unit_cost, p.stock, p.active
			FROM products p
			JOIN product_categories c ON c.id = p.category_id""";

	private final JdbcClient jdbc;

	public ProductRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public List<Product> list(UUID orgId) {
		return this.jdbc.sql(SELECT + " WHERE p.organization_id = :org ORDER BY p.name, p.id")
			.param("org", orgId)
			.query((rs, n) -> scan(rs))
			.list();
	}

	public Optional<Product> get(UUID orgId, UUID id) {
		return this.jdbc.sql(SELECT + " WHERE p.organization_id = :org AND p.id = :id")
			.param("org", orgId)
			.param("id", id)
			.query((rs, n) -> scan(rs))
			.optional();
	}

	/** The tenant's products among ids, by id. */
	public Map<UUID, Product> byIds(UUID orgId, Collection<UUID> ids) {
		if (ids.isEmpty()) {
			return Map.of();
		}
		return this.jdbc.sql(SELECT + " WHERE p.organization_id = :org AND p.id IN (:ids)")
			.param("org", orgId)
			.param("ids", ids)
			.query((rs, n) -> scan(rs))
			.list()
			.stream()
			.collect(Collectors.toMap(Product::id, Function.identity()));
	}

	public UUID create(UUID orgId, ProductInput in) {
		UUID id = UUID.randomUUID();
		try {
			this.jdbc.sql("""
					INSERT INTO products (id, organization_id, category_id, name, unit_price, unit_cost, stock, active)
					VALUES (:id, :org, :category, :name, :price, :cost, :stock, :active)""")
				.param("id", id)
				.param("org", orgId)
				.param("category", in.categoryId())
				.param("name", in.name())
				.param("price", in.unitPrice())
				.param("cost", in.unitCost())
				.param("stock", in.stock())
				.param("active", in.active())
				.update();
		}
		catch (DuplicateKeyException ex) {
			throw new DuplicateException(ex);
		}
		return id;
	}

	public void update(UUID orgId, UUID id, ProductInput in) {
		try {
			this.jdbc.sql("""
					UPDATE products SET category_id = :category, name = :name, unit_price = :price, unit_cost = :cost,
						stock = :stock, active = :active
					WHERE organization_id = :org AND id = :id""")
				.param("id", id)
				.param("org", orgId)
				.param("category", in.categoryId())
				.param("name", in.name())
				.param("price", in.unitPrice())
				.param("cost", in.unitCost())
				.param("stock", in.stock())
				.param("active", in.active())
				.update();
		}
		catch (DuplicateKeyException ex) {
			throw new DuplicateException(ex);
		}
	}

	/** Whether any quote line uses the product. */
	public boolean isUsed(UUID id) {
		return this.jdbc.sql("SELECT EXISTS (SELECT 1 FROM quote_items WHERE product_id = :id)")
			.param("id", id)
			.query(Boolean.class)
			.single();
	}

	public void delete(UUID orgId, UUID id) {
		try {
			this.jdbc.sql("DELETE FROM products WHERE organization_id = :org AND id = :id")
				.param("org", orgId)
				.param("id", id)
				.update();
		}
		catch (DataAccessException ex) {
			throw Rows.isForeignKeyViolation(ex) ? new InUseException(ex) : ex;
		}
	}

	private static Product scan(ResultSet rs) throws SQLException {
		return new Product(Rows.uuid(rs, 1), rs.getString(2), Ref.of(Rows.uuid(rs, 3), rs.getString(4)),
				rs.getBigDecimal(5), rs.getBigDecimal(6), rs.getBigDecimal(7), rs.getBoolean(8));
	}

}
