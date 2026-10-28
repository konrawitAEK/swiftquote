package com.swiftquote.service;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.GoText;
import com.swiftquote.domain.Product;
import com.swiftquote.domain.Roles;
import com.swiftquote.repository.CatalogRepository;
import com.swiftquote.repository.ProductRepository;
import com.swiftquote.repository.ProductRepository.ProductInput;

/**
 * Catalog products; rules and messages mirror backend/go-service/internal/catalog (products). Check order: 403 role,
 * 404 target, 400 required/shape, 400 references, 409 conflicts.
 */
@Service
public class ProductService {

	private final ProductRepository repo;

	private final CatalogRepository categories;

	public ProductService(ProductRepository repo, CatalogRepository categories) {
		this.repo = repo;
		this.categories = categories;
	}

	/** A create/update payload as decoded; null means the field was absent (or JSON null). */
	public record Input(String name, UUID categoryId, BigDecimal unitPrice, BigDecimal unitCost, BigDecimal stock,
			Boolean active) {
	}

	/** Every role except customers sees the catalog, retired products included. */
	public List<Product> list(Actor a) {
		return switch (a.role()) {
			case Roles.ADMIN, Roles.WOC, Roles.WO, Roles.RM -> this.repo.list(a.tenantId());
			default -> throw ApiException.roleForbidden();
		};
	}

	public Product create(Actor a, Input in) {
		guard(a);
		ProductInput valid = validate(a.tenantId(), in, false);
		UUID id;
		try {
			id = this.repo.create(a.tenantId(), valid);
		}
		catch (ProductRepository.DuplicateException ex) {
			throw duplicate(valid.name());
		}
		return this.repo.get(a.tenantId(), id).orElseThrow();
	}

	public Product update(Actor a, UUID id, Input in) {
		guard(a);
		if (this.repo.get(a.tenantId(), id).isEmpty()) {
			throw notFound();
		}
		ProductInput valid = validate(a.tenantId(), in, true);
		try {
			this.repo.update(a.tenantId(), id, valid);
		}
		catch (ProductRepository.DuplicateException ex) {
			throw duplicate(valid.name());
		}
		return this.repo.get(a.tenantId(), id).orElseThrow();
	}

	/** Removes a product no quote line uses; used ones are retired (active false) instead. */
	public void delete(Actor a, UUID id) {
		guard(a);
		if (this.repo.get(a.tenantId(), id).isEmpty()) {
			throw notFound();
		}
		if (this.repo.isUsed(id)) {
			throw inUse();
		}
		try {
			this.repo.delete(a.tenantId(), id);
		}
		catch (ProductRepository.InUseException ex) {
			throw inUse();
		}
	}

	private ProductInput validate(UUID orgId, Input in, boolean requireActive) {
		ApiException.Problems problems = new ApiException.Problems();
		String name = GoText.trim((in.name() != null) ? in.name() : "");
		if (name.isEmpty()) {
			problems.add("name is required");
		}
		if (in.categoryId() == null) {
			problems.add("categoryId is required");
		}
		if (in.unitPrice() == null) {
			problems.add("unitPrice is required");
		}
		if (in.unitCost() == null) {
			problems.add("unitCost is required");
		}
		if (in.unitPrice() != null && in.unitPrice().signum() < 0) {
			problems.add("unitPrice must not be negative");
		}
		if (in.unitCost() != null && in.unitCost().signum() < 0) {
			problems.add("unitCost must not be negative");
		}
		if (in.stock() != null && in.stock().signum() < 0) {
			problems.add("stock must not be negative");
		}
		if (requireActive && in.active() == null) {
			problems.add("active is required");
		}
		problems.throwIfAny();
		if (!this.categories.activeIds(orgId).contains(in.categoryId())) {
			throw ApiException.invalid("categoryId is not an active category");
		}
		return new ProductInput(name, in.categoryId(), in.unitPrice(), in.unitCost(), in.stock(),
				!requireActive || in.active());
	}

	private static void guard(Actor a) {
		if (!Roles.ADMIN.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
	}

	private static ApiException notFound() {
		return ApiException.notFound("product not found");
	}

	private static ApiException inUse() {
		return ApiException.conflict("product is used on quotes; retire it instead");
	}

	private static ApiException duplicate(String name) {
		return ApiException.conflict("product %s already exists".formatted(GoText.quote(name)));
	}

}
