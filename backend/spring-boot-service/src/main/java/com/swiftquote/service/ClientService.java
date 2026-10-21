package com.swiftquote.service;

import java.util.List;

import org.springframework.stereotype.Service;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.Client;
import com.swiftquote.domain.Roles;
import com.swiftquote.repository.AuthRepository;

/** The tenant's client directory (backend/go-service/internal/client/service.go). */
@Service
public class ClientService {

	private final AuthRepository repo;

	public ClientService(AuthRepository repo) {
		this.repo = repo;
	}

	/** For RMs picking a client and admins linking customers to one. */
	public List<Client> list(Actor a) {
		if (!Roles.RM.equals(a.role()) && !Roles.ADMIN.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		return this.repo.listClients(a.tenantId());
	}

}
