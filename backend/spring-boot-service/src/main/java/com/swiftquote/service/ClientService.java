package com.swiftquote.service;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.swiftquote.domain.Client;
import com.swiftquote.repository.ClientRepository;

@Service
public class ClientService {

	private final ClientRepository clients;

	public ClientService(ClientRepository clients) {
		this.clients = clients;
	}

	/** The tenant's clients ordered by name. */
	public List<Client> list(UUID orgId) {
		return this.clients.list(orgId);
	}

}
