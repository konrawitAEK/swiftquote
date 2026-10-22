package com.swiftquote.service;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.GoText;
import com.swiftquote.domain.Roles;
import com.swiftquote.repository.AdminRepository;
import com.swiftquote.repository.AdminRepository.Team;
import com.swiftquote.repository.AdminRepository.User;
import com.swiftquote.repository.AdminRepository.UserInput;
import com.swiftquote.repository.AuthRepository;

/**
 * Users and team structure, admins only; rules and messages mirror backend/go-service/internal/admin/service.go.
 * Check order: 403 role, 404 target, 400 input, 409 conflicts.
 */
@Service
public class AdminService {

	private static final int MIN_PASSWORD_LENGTH = 8;

	private final AdminRepository repo;

	private final AuthRepository clients;

	private final AuthService auth;

	public AdminService(AdminRepository repo, AuthRepository clients, AuthService auth) {
		this.repo = repo;
		this.clients = clients;
		this.auth = auth;
	}

	private static void guard(Actor a) {
		if (!Roles.ADMIN.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
	}

	public List<User> listUsers(Actor a) {
		guard(a);
		return this.repo.listUsers(a.tenantId());
	}

	public User createUser(Actor a, UserInput raw) {
		guard(a);
		// Go lowercases with strings.ToLower, which is locale-independent.
		UserInput in = new UserInput(GoText.trim(raw.email()).toLowerCase(Locale.ROOT), GoText.trim(raw.name()),
				raw.password(), raw.role(), true, raw.teamId(), raw.clientId());
		ApiException.Problems problems = new ApiException.Problems();
		if (in.email().isEmpty()) {
			problems.add("email is required");
		}
		else if (!in.email().contains("@")) {
			problems.add("email is not valid");
		}
		if (in.password() == null || byteLength(in.password()) < MIN_PASSWORD_LENGTH) {
			problems.add("password must be at least %d characters".formatted(MIN_PASSWORD_LENGTH));
		}
		checkUser(a, in, problems);
		String hash = this.auth.hashPassword(in.password());
		UUID id;
		try {
			id = this.repo.createUser(a.tenantId(), in, hash);
		}
		catch (AdminRepository.DuplicateException ex) {
			throw ApiException.conflict("email %s already exists".formatted(GoText.quote(in.email())));
		}
		return this.repo.getUser(a.tenantId(), id).orElseThrow();
	}

	public User updateUser(Actor a, UUID id, UserInput raw) {
		guard(a);
		User current = this.repo.getUser(a.tenantId(), id)
			.orElseThrow(() -> ApiException.notFound("user not found"));
		UserInput in = new UserInput(current.email(), GoText.trim(raw.name()), raw.password(), raw.role(),
				raw.active(), raw.teamId(), raw.clientId());
		ApiException.Problems problems = new ApiException.Problems();
		if (in.active() == null) {
			problems.add("active is required");
		}
		boolean active = in.active() != null && in.active();
		if (in.password() != null && byteLength(in.password()) < MIN_PASSWORD_LENGTH) {
			problems.add("password must be at least %d characters".formatted(MIN_PASSWORD_LENGTH));
		}
		if (id.equals(a.userId()) && (!Roles.ADMIN.equals(in.role()) || !active)) {
			problems.add("you cannot change your own role or deactivate yourself");
		}
		checkUser(a, in, problems);
		if (Roles.WO.equals(current.role()) && (!Roles.WO.equals(in.role()) || !active)
				&& this.repo.leadsTeam(a.tenantId(), id)) {
			throw ApiException.conflict("user leads a team; assign another WO first");
		}
		String hash = (in.password() != null) ? this.auth.hashPassword(in.password()) : null;
		this.repo.updateUser(a.tenantId(), id, in, hash);
		return this.repo.getUser(a.tenantId(), id).orElseThrow();
	}

	/** Permanently removes an account nothing refers to; accounts with quote history are deactivated instead. */
	public void deleteUser(Actor a, UUID id) {
		guard(a);
		if (this.repo.getUser(a.tenantId(), id).isEmpty()) {
			throw ApiException.notFound("user not found");
		}
		if (id.equals(a.userId())) {
			throw ApiException.invalid("you cannot delete yourself");
		}
		if (this.repo.leadsTeam(a.tenantId(), id)) {
			throw ApiException.conflict("user leads a team; assign another WO first");
		}
		if (this.repo.hasQuoteHistory(id)) {
			throw userHasHistory();
		}
		try {
			this.repo.deleteUser(a.tenantId(), id);
		}
		catch (AdminRepository.InUseException ex) {
			throw userHasHistory();
		}
	}

	private static ApiException userHasHistory() {
		return ApiException.conflict("user has quote history; deactivate instead");
	}

	/** Validates name, role and placement (team for RMs, client for customers), adding to problems. */
	private void checkUser(Actor a, UserInput in, ApiException.Problems problems) {
		if (in.name().isEmpty()) {
			problems.add("name is required");
		}
		if (!Roles.valid(in.role())) {
			problems.add("role %s is not a valid Role".formatted(GoText.quote(in.role())));
		}
		if (in.teamId() != null && !Roles.RM.equals(in.role())) {
			problems.add("teamId is only allowed for rm");
		}
		if (Roles.CUSTOMER.equals(in.role()) && in.clientId() == null) {
			problems.add("clientId is required for customer");
		}
		if (in.clientId() != null && !Roles.CUSTOMER.equals(in.role())) {
			problems.add("clientId is only allowed for customer");
		}
		problems.throwIfAny();
		if (in.teamId() != null && !this.repo.teamExists(a.tenantId(), in.teamId())) {
			throw ApiException.invalid("teamId does not exist");
		}
		if (in.clientId() != null && !this.clients.clientExists(a.tenantId(), in.clientId())) {
			throw ApiException.invalid("clientId does not exist");
		}
	}

	private static int byteLength(String s) {
		return s.getBytes(StandardCharsets.UTF_8).length;
	}

	public List<Team> listTeams(Actor a) {
		guard(a);
		return this.repo.listTeams(a.tenantId());
	}

	public Team createTeam(Actor a, String name, UUID woUserId) {
		guard(a);
		String trimmed = checkTeam(a, name, woUserId);
		UUID id;
		try {
			id = this.repo.createTeam(a.tenantId(), trimmed, woUserId);
		}
		catch (AdminRepository.DuplicateException ex) {
			throw ApiException.conflict("team %s already exists".formatted(GoText.quote(trimmed)));
		}
		return this.repo.getTeam(a.tenantId(), id).orElseThrow();
	}

	public Team updateTeam(Actor a, UUID id, String name, UUID woUserId) {
		guard(a);
		if (this.repo.getTeam(a.tenantId(), id).isEmpty()) {
			throw ApiException.notFound("team not found");
		}
		String trimmed = checkTeam(a, name, woUserId);
		try {
			this.repo.updateTeam(a.tenantId(), id, trimmed, woUserId);
		}
		catch (AdminRepository.DuplicateException ex) {
			throw ApiException.conflict("team %s already exists".formatted(GoText.quote(trimmed)));
		}
		return this.repo.getTeam(a.tenantId(), id).orElseThrow();
	}

	/** Removes an empty team; its members must be moved to another team first. */
	public void deleteTeam(Actor a, UUID id) {
		guard(a);
		if (this.repo.getTeam(a.tenantId(), id).isEmpty()) {
			throw ApiException.notFound("team not found");
		}
		if (this.repo.teamHasMembers(id)) {
			throw teamHasMembers();
		}
		try {
			this.repo.deleteTeam(a.tenantId(), id);
		}
		catch (AdminRepository.InUseException ex) {
			throw teamHasMembers();
		}
	}

	private static ApiException teamHasMembers() {
		return ApiException.conflict("team has members; move them to another team first");
	}

	private String checkTeam(Actor a, String name, UUID woUserId) {
		String trimmed = GoText.trim(name);
		ApiException.Problems problems = new ApiException.Problems();
		if (trimmed.isEmpty()) {
			problems.add("name is required");
		}
		if (woUserId == null) {
			problems.add("woUserId is required");
		}
		problems.throwIfAny();
		if (!this.repo.isActiveWo(a.tenantId(), woUserId)) {
			throw ApiException.invalid("woUserId must be an active WO");
		}
		return trimmed;
	}

}
