package com.swiftquote.service;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.Category;
import com.swiftquote.domain.GoText;
import com.swiftquote.domain.Roles;
import com.swiftquote.repository.CatalogRepository;

/** Product categories; rules and messages mirror backend/go-service/internal/catalog/service.go. */
@Service
public class CatalogService {

	private final CatalogRepository repo;

	public CatalogService(CatalogRepository repo) {
		this.repo = repo;
	}

	/** For RMs picking a category, WOC reading the dashboard and admins managing the list. */
	public List<Category> list(Actor a) {
		return switch (a.role()) {
			case Roles.RM, Roles.WOC, Roles.ADMIN -> this.repo.list(a.tenantId());
			default -> throw ApiException.roleForbidden();
		};
	}

	public Category create(Actor a, String name) {
		if (!Roles.ADMIN.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		String trimmed = GoText.trim(name);
		if (trimmed.isEmpty()) {
			throw ApiException.invalid("name is required");
		}
		UUID id;
		try {
			id = this.repo.create(a.tenantId(), trimmed);
		}
		catch (CatalogRepository.DuplicateException ex) {
			throw duplicate(trimmed);
		}
		return this.repo.get(a.tenantId(), id).orElseThrow();
	}

	public Category update(Actor a, UUID id, String name, Boolean active) {
		if (!Roles.ADMIN.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		if (this.repo.get(a.tenantId(), id).isEmpty()) {
			throw ApiException.notFound("category not found");
		}
		String trimmed = GoText.trim(name);
		ApiException.Problems problems = new ApiException.Problems();
		if (trimmed.isEmpty()) {
			problems.add("name is required");
		}
		if (active == null) {
			problems.add("active is required");
		}
		problems.throwIfAny();
		try {
			this.repo.update(a.tenantId(), id, trimmed, active);
		}
		catch (CatalogRepository.DuplicateException ex) {
			throw duplicate(trimmed);
		}
		return this.repo.get(a.tenantId(), id).orElseThrow();
	}

	/** Removes a category no quote line uses; used ones are retired (active false) instead. */
	public void delete(Actor a, UUID id) {
		if (!Roles.ADMIN.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		if (this.repo.get(a.tenantId(), id).isEmpty()) {
			throw ApiException.notFound("category not found");
		}
		if (this.repo.isUsed(id)) {
			throw inUse();
		}
		try {
			this.repo.delete(a.tenantId(), id);
		}
		catch (CatalogRepository.InUseException ex) {
			throw inUse();
		}
	}

	private static ApiException inUse() {
		return ApiException.conflict("category is used on quotes; retire it instead");
	}

	private static ApiException duplicate(String name) {
		return ApiException.conflict("category %s already exists".formatted(GoText.quote(name)));
	}

}
