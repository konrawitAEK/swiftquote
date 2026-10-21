package com.swiftquote.web.rest;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

import com.swiftquote.TestcontainersConfiguration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end over real HTTP and Postgres. Mirrors backend/go-service/internal/delivery/http/router_test.go case for
 * case so all backends are held to the same behaviour; each test restores the seed with db/test/reset_to_seed.sql.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "swiftquote.jwt-secret=test-secret-at-least-32-bytes-long")
@Import(TestcontainersConfiguration.class)
class ApiIntegrationTest {

	static final String ACME_CLIENT = "00000000-0000-4000-8000-000000000003";

	static final String GLOBEX_CLIENT = "00000000-0000-4000-8000-000000000004";

	static final String TEAM_ALPHA = "00000000-0000-4000-8000-000000000020";

	static final String WO_USER = "00000000-0000-4000-8000-000000000011";

	static final String RM1_USER = "00000000-0000-4000-8000-000000000012";

	static final String ADMIN_USER = "00000000-0000-4000-8000-000000000002";

	static final String CAT_SOFTWARE = "00000000-0000-4000-8000-000000000030";

	static final String CAT_SERVICES = "00000000-0000-4000-8000-000000000031";

	static final String UNKNOWN_ID = "00000000-0000-4000-8000-0000000000ff";

	static final String RM1 = "rm1@swiftquote.dev";

	static final String WO = "wo@swiftquote.dev";

	static final String WOC = "woc@swiftquote.dev";

	static final String ADMIN = "demo@swiftquote.dev";

	static final String ACME_BUYER = "buyer@acme.example";

	// Floats as BigDecimal so money keeps its exact text ("203.30", not 203.3).
	static final JsonMapper json = JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

	static final HttpClient http = HttpClient.newHttpClient();

	@LocalServerPort
	int port;

	@Autowired
	DataSource dataSource;

	@Autowired
	JdbcClient jdbc;

	final Map<String, String> tokens = new HashMap<>();

	record Res(int status, String raw, Object body) {

		@SuppressWarnings("unchecked")
		Map<String, Object> map() {
			return (Map<String, Object>) this.body;
		}

		@SuppressWarnings("unchecked")
		List<Map<String, Object>> list() {
			return (List<Map<String, Object>>) this.body;
		}

	}

	@BeforeEach
	void resetToSeed() throws IOException, SQLException {
		String script = Files.readString(Path.of("../../db/test/reset_to_seed.sql"));
		try (Connection c = this.dataSource.getConnection(); Statement st = c.createStatement()) {
			st.execute(script);
		}
	}

	Res raw(String method, String path, String token, String body) {
		try {
			HttpRequest.Builder req = HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path))
				.header("Content-Type", "application/json")
				.method(method, (body != null) ? HttpRequest.BodyPublishers.ofString(body)
						: HttpRequest.BodyPublishers.noBody());
			if (token != null) {
				req.header("Authorization", "Bearer " + token);
			}
			HttpResponse<String> res = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
			Object parsed = res.body().isEmpty() ? null : json.readValue(res.body(), Object.class);
			return new Res(res.statusCode(), res.body(), parsed);
		}
		catch (IOException | InterruptedException ex) {
			throw new IllegalStateException(ex);
		}
	}

	Res call(String method, String path, String token, Object body) {
		return raw(method, path, token, (body != null) ? json.writeValueAsString(body) : null);
	}

	/** Logs in once per email (password "password") and returns the token. */
	String as(String email) {
		return this.tokens.computeIfAbsent(email, (e) -> {
			Res res = call("POST", "/api/v1/auth/login", null, Map.of("email", e, "password", "password"));
			assertThat(res.status()).as("login %s: %s", e, res.raw()).isEqualTo(200);
			return (String) res.map().get("accessToken");
		});
	}

	/** Asserts a status and, for errors, the ErrorResponse code; returns the response. */
	Res expect(int status, String code, String method, String path, String token, Object body) {
		Res res = call(method, path, token, body);
		assertThat(res.status()).as("%s %s: %s", method, path, res.raw()).isEqualTo(status);
		if (code != null) {
			assertThat(res.map()).as("%s %s", method, path).containsEntry("code", code);
		}
		return res;
	}

	static String inAMonth() {
		return LocalDate.now(ZoneOffset.UTC).plusMonths(1).toString();
	}

	static Map<String, Object> obj(Object... kv) {
		Map<String, Object> m = new LinkedHashMap<>();
		for (int i = 0; i < kv.length; i += 2) {
			m.put((String) kv[i], kv[i + 1]);
		}
		return m;
	}

	static Map<String, Object> quoteBody(String number) {
		return obj("clientId", ACME_CLIENT, "quoteNumber", number, "expiryDate", inAMonth(), "items",
				List.of(obj("title", "Consulting", "categoryId", CAT_SERVICES, "quantity", 2, "unitPrice", 100,
						"discountPercent", 10),
						obj("title", "Setup fee", "categoryId", CAT_SOFTWARE, "quantity", 1, "unitPrice", 1.5)));
	}

	String create(String rm, String number) {
		return (String) expect(201, null, "POST", "/api/v1/quotes", as(rm), quoteBody(number)).map().get("id");
	}

	/** A new quote by rm1 approved by wo and sent; returns {id, accessToken}. */
	String[] sent(String number) {
		String id = create(RM1, number);
		expect(200, null, "POST", "/api/v1/quotes/" + id + "/submit", as(RM1), null);
		expect(200, null, "POST", "/api/v1/quotes/" + id + "/approve", as(WO), null);
		Map<String, Object> q = expect(200, null, "POST", "/api/v1/quotes/" + id + "/send", as(RM1), null).map();
		return new String[] { id, (String) q.get("accessToken") };
	}

	@SuppressWarnings("unchecked")
	static List<String> actions(Map<String, Object> q) {
		return ((List<Map<String, Object>>) q.get("history")).stream().map((e) -> (String) e.get("action")).toList();
	}

	@SuppressWarnings("unchecked")
	static Map<String, Object> at(Object list, int i) {
		return ((List<Map<String, Object>>) list).get(i);
	}

	@SuppressWarnings("unchecked")
	static Map<String, Object> m(Object v) {
		return (Map<String, Object>) v;
	}

	static String text(Object number) {
		return (number instanceof BigDecimal d) ? d.toPlainString() : String.valueOf(number);
	}

	static String measure(Object v) {
		return m(v).get("count") + "/" + text(m(v).get("amount"));
	}

	@Test
	void workflowFromDraftToAccepted() {
		String rm = as(RM1);
		String wo = as(WO);

		Map<String, Object> q = expect(201, null, "POST", "/api/v1/quotes", rm, quoteBody("Q-001")).map();
		String id = (String) q.get("id");
		String link = (String) q.get("accessToken");
		assertThat(q).containsEntry("status", "draft").containsEntry("clientName", "Acme Corporation");
		assertThat(m(q.get("createdBy"))).containsEntry("name", "Nok Rattana");
		assertThat(text(q.get("grandTotal"))).isEqualTo("194.21");
		assertThat(actions(q)).containsExactly("created");

		// Drafts are not reachable through the share link.
		expect(404, "NOT_FOUND", "GET", "/api/v1/public/quotes/" + link, null, null);

		expect(200, null, "POST", "/api/v1/quotes/" + id + "/submit", rm, null);
		Res edit = expect(409, "CONFLICT", "PUT", "/api/v1/quotes/" + id, rm, quoteBody("Q-001"));
		assertThat(edit.map()).containsEntry("message", "conflict: cannot edit a quote that is pending_approval");
		expect(404, "NOT_FOUND", "POST", "/api/v1/quotes/" + id + "/approve", as("wo2@swiftquote.dev"), null);
		Res blank = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/quotes/" + id + "/return", wo,
				obj("comment", "  "));
		assertThat(blank.map()).containsEntry("details", List.of("comment is required"));
		q = expect(200, null, "POST", "/api/v1/quotes/" + id + "/return", wo, obj("comment", "Discount too high"))
			.map();
		assertThat(q).containsEntry("status", "draft");
		Map<String, Object> last = at(q.get("history"), 2);
		assertThat(last).containsEntry("comment", "Discount too high");
		assertThat(m(last.get("actor"))).containsEntry("name", "Somchai Wong");

		Map<String, Object> body = quoteBody("Q-001");
		body.put("items", List.of(obj("title", "Consulting", "categoryId", CAT_SERVICES, "quantity", 2, "unitPrice",
				100, "discountPercent", 5)));
		q = expect(200, null, "PUT", "/api/v1/quotes/" + id, rm, body).map();
		assertThat(text(q.get("grandTotal"))).isEqualTo("203.30");

		Res early = expect(409, "CONFLICT", "POST", "/api/v1/quotes/" + id + "/send", rm, null);
		assertThat(early.map()).containsEntry("message", "conflict: cannot send a quote that is draft");
		expect(200, null, "POST", "/api/v1/quotes/" + id + "/submit", rm, obj("comment", "Reduced discount"));
		expect(200, null, "POST", "/api/v1/quotes/" + id + "/approve", wo, null);
		q = expect(200, null, "POST", "/api/v1/quotes/" + id + "/send", rm, null).map();
		assertThat(actions(q)).containsExactly("created", "submitted", "returned", "updated", "submitted", "approved",
				"sent");

		// The customer of another client cannot see it; Acme's customer can, and opening it marks it viewed.
		expect(404, "NOT_FOUND", "GET", "/api/v1/quotes/" + id, as("buyer@globex.example"), null);
		String customer = as(ACME_BUYER);
		assertThat(expect(200, null, "GET", "/api/v1/quotes", customer, null).list()).hasSize(1);
		q = expect(200, null, "GET", "/api/v1/quotes/" + id, customer, null).map();
		assertThat(q).containsEntry("status", "viewed");
		assertThat(actions(q)).containsExactly("sent", "viewed");

		Map<String, Object> sign = obj("signerName", "Alice Acme", "signatureDataUrl", "data:image/png;base64,AAAA");
		expect(403, "FORBIDDEN", "POST", "/api/v1/quotes/" + id + "/accept", rm, sign);
		q = expect(200, null, "POST", "/api/v1/quotes/" + id + "/accept", customer, sign).map();
		assertThat(q).containsEntry("status", "accepted").containsEntry("signedBy", "Alice Acme");
		Res again = expect(409, "CONFLICT", "POST", "/api/v1/quotes/" + id + "/accept", customer, sign);
		assertThat(again.map()).containsEntry("message", "conflict: cannot accept a quote that is accepted");

		q = expect(200, null, "GET", "/api/v1/quotes/" + id, rm, null).map();
		assertThat(actions(q)).containsExactly("created", "submitted", "returned", "updated", "submitted", "approved",
				"sent", "viewed", "accepted");
	}

	@Test
	void visibilityByRole() {
		create(RM1, "Q-RM1");
		create("rm3@swiftquote.dev", "Q-RM3");

		Map<String, List<String>> want = new LinkedHashMap<>();
		want.put(RM1, List.of("Q-RM1"));
		want.put("rm2@swiftquote.dev", List.of());
		want.put("rm3@swiftquote.dev", List.of("Q-RM3"));
		want.put(WO, List.of("Q-RM1"));
		want.put("wo2@swiftquote.dev", List.of("Q-RM3"));
		want.put(WOC, List.of("Q-RM3", "Q-RM1"));
		want.put(ACME_BUYER, List.of());
		want.put("buyer@globex.example", List.of());
		want.forEach((email, numbers) -> {
			List<Map<String, Object>> list = expect(200, null, "GET", "/api/v1/quotes", as(email), null).list();
			assertThat(list.stream().map((q) -> (String) q.get("quoteNumber")).toList()).as(email)
				.containsExactlyElementsOf(numbers);
		});
		expect(403, "FORBIDDEN", "GET", "/api/v1/quotes", as(ADMIN), null);
	}

	@Test
	void rolePermissions() {
		String id = create(RM1, "Q-PERM");
		record Case(String name, String method, String path, String email, Object body) {
		}
		List<Case> cases = List.of(new Case("wo cannot create", "POST", "/api/v1/quotes", WO, quoteBody("X")),
				new Case("woc cannot create", "POST", "/api/v1/quotes", WOC, quoteBody("X")),
				new Case("admin cannot create", "POST", "/api/v1/quotes", ADMIN, quoteBody("X")),
				new Case("customer cannot create", "POST", "/api/v1/quotes", ACME_BUYER, quoteBody("X")),
				new Case("admin cannot read quotes", "GET", "/api/v1/quotes/" + id, ADMIN, null),
				new Case("woc cannot approve", "POST", "/api/v1/quotes/" + id + "/approve", WOC, null),
				new Case("rm cannot approve", "POST", "/api/v1/quotes/" + id + "/approve", RM1, null),
				new Case("wo cannot submit", "POST", "/api/v1/quotes/" + id + "/submit", WO, null),
				new Case("wo cannot list clients", "GET", "/api/v1/clients", WO, null),
				new Case("rm cannot see dashboard", "GET", "/api/v1/dashboard/summary", RM1, null),
				new Case("admin cannot see dashboard", "GET", "/api/v1/dashboard/summary", ADMIN, null),
				new Case("woc cannot manage users", "GET", "/api/v1/admin/users", WOC, null),
				new Case("rm cannot manage teams", "POST", "/api/v1/admin/teams", RM1,
						obj("name", "X", "woUserId", WO_USER)),
				// The role check comes before visibility and validation.
				new Case("role before not found", "POST", "/api/v1/quotes/" + UNKNOWN_ID + "/approve", RM1, null),
				new Case("role before validation", "POST", "/api/v1/quotes", WO, obj()));
		for (Case tc : cases) {
			Res res = call(tc.method(), tc.path(), as(tc.email()), tc.body());
			assertThat(res.status()).as(tc.name()).isEqualTo(403);
			assertThat(res.map()).as(tc.name())
				.containsEntry("code", "FORBIDDEN")
				.containsEntry("message", "forbidden: your role cannot perform this action")
				.doesNotContainKey("details");
		}
	}

	@Test
	void submitRequiresTeamWithWo() {
		Map<String, Object> u = expect(201, null, "POST", "/api/v1/admin/users", as(ADMIN),
				obj("email", "Solo@SwiftQuote.dev", "name", "Solo RM", "password", "password", "role", "rm"))
			.map();
		assertThat(u).containsEntry("email", "solo@swiftquote.dev").containsEntry("team", null);
		String id = create("solo@swiftquote.dev", "Q-SOLO");
		Res res = expect(409, "CONFLICT", "POST", "/api/v1/quotes/" + id + "/submit", as("solo@swiftquote.dev"), null);
		assertThat(res.map()).containsEntry("message", "conflict: you must be in a team led by a WO to submit");
	}

	@Test
	void publicLink() {
		String link = sent("Q-LINK")[1];

		Map<String, Object> v = expect(200, null, "GET", "/api/v1/public/quotes/" + link, null, null).map();
		assertThat(v).containsEntry("status", "viewed")
			.containsEntry("vendorName", "Demo Co., Ltd.")
			.containsEntry("vendorLogo", null)
			.containsEntry("signedBy", null)
			.containsEntry("signedAt", null);
		Map<String, Object> q = expect(200, null, "POST", "/api/v1/public/quotes/" + link + "/reject", null,
				obj("comment", "Too expensive"))
			.map();
		assertThat(q).containsEntry("status", "rejected");
		assertThat(actions(q)).containsExactly("sent", "viewed", "rejected");
		List<?> history = (List<?>) q.get("history");
		Map<String, Object> last = m(history.get(history.size() - 1));
		assertThat(last).containsEntry("comment", "Too expensive").containsEntry("actor", null);
		Res conflict = expect(409, "CONFLICT", "POST", "/api/v1/public/quotes/" + link + "/accept", null,
				obj("signerName", "A", "signatureDataUrl", "data:x"));
		assertThat(conflict.map()).containsEntry("message", "conflict: cannot accept a quote that is rejected");
		Res bad = expect(404, "NOT_FOUND", "GET", "/api/v1/public/quotes/not-a-uuid", null, null);
		assertThat(bad.map()).containsEntry("message", "not found: quote expired or not found");
		Res missing = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/public/quotes/" + link + "/accept", null,
				obj("signerName", " "));
		assertThat(missing.map()).containsEntry("details",
				List.of("signerName is required", "signatureDataUrl is required"));
	}

	@Test
	void publicAccept() {
		String link = sent("Q-SIGN")[1];
		Map<String, Object> q = expect(200, null, "POST", "/api/v1/public/quotes/" + link + "/accept", null,
				obj("signerName", " Jane Buyer ", "signatureDataUrl", "data:image/png;base64,AAAA"))
			.map();
		assertThat(q).containsEntry("status", "accepted").containsEntry("signedBy", "Jane Buyer");
		assertThat((String) q.get("signedAt")).matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d*[1-9])?Z");
		assertThat(actions(q)).containsExactly("sent", "accepted");
		Map<String, Object> v = expect(200, null, "GET", "/api/v1/public/quotes/" + link, null, null).map();
		assertThat(v).containsEntry("status", "accepted").containsEntry("signedBy", "Jane Buyer");
	}

	@Test
	void sendRejectsExpiredQuote() {
		String id = create(RM1, "Q-OLD");
		this.jdbc.sql("UPDATE quotes SET status = 'approved', expiry_date = current_date - 1 WHERE id = CAST(:id AS uuid)")
			.param("id", id)
			.update();
		Res res = expect(409, "CONFLICT", "POST", "/api/v1/quotes/" + id + "/send", as(RM1), null);
		assertThat(res.map()).containsEntry("message", "conflict: quote has expired");
	}

	@Test
	void expiredQuotesCannotBeAnsweredOrOpenedByLink() {
		String[] q = sent("Q-EXP");
		this.jdbc.sql("UPDATE quotes SET expiry_date = current_date - 1 WHERE id = CAST(:id AS uuid)").param("id", q[0]).update();
		expect(404, "NOT_FOUND", "GET", "/api/v1/public/quotes/" + q[1], null, null);
		Res res = expect(409, "CONFLICT", "POST", "/api/v1/quotes/" + q[0] + "/reject", as(ACME_BUYER), null);
		assertThat(res.map()).containsEntry("message", "conflict: quote has expired");
	}

	@Test
	void adminManagesUsersAndTeams() {
		String adm = as(ADMIN);

		assertThat(expect(200, null, "GET", "/api/v1/admin/users", adm, null).list()).hasSize(9);

		Map<String, Object> u = expect(201, null, "POST", "/api/v1/admin/users", adm, obj("email",
				"new.rm@swiftquote.dev", "name", "New RM", "password", "password1", "role", "rm", "teamId", TEAM_ALPHA))
			.map();
		assertThat(m(u.get("team"))).containsEntry("name", "Team Alpha");
		assertThat(u).containsEntry("active", true).containsEntry("client", null);
		Res dup = expect(409, "CONFLICT", "POST", "/api/v1/admin/users", adm,
				obj("email", "NEW.RM@swiftquote.dev", "name", "Dup", "password", "password1", "role", "rm"));
		assertThat(dup.map()).containsEntry("message", "conflict: email \"new.rm@swiftquote.dev\" already exists");

		Map<String, Map<String, Object>> invalid = new LinkedHashMap<>();
		invalid.put("password must be at least 8 characters",
				obj("email", "a@b.c", "name", "A", "password", "short", "role", "rm"));
		invalid.put("role \"boss\" is not a valid Role",
				obj("email", "a@b.c", "name", "A", "password", "password", "role", "boss"));
		invalid.put("clientId is required for customer",
				obj("email", "a@b.c", "name", "A", "password", "password", "role", "customer"));
		invalid.put("teamId is only allowed for rm",
				obj("email", "a@b.c", "name", "A", "password", "password", "role", "wo", "teamId", TEAM_ALPHA));
		invalid.put("clientId is only allowed for customer",
				obj("email", "a@b.c", "name", "A", "password", "password", "role", "rm", "clientId", GLOBEX_CLIENT));
		invalid.put("email is not valid", obj("email", "nope", "name", "A", "password", "password", "role", "rm"));
		invalid.forEach((detail, body) -> {
			Res res = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/users", adm, body);
			assertThat(res.map()).containsEntry("message", "request validation failed")
				.containsEntry("details", List.of(detail));
		});
		Res empty = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/users", adm, obj());
		assertThat(empty.map()).containsEntry("details", List.of("email is required",
				"password must be at least 8 characters", "name is required", "role \"\" is not a valid Role"));

		Res self = expect(400, "VALIDATION_ERROR", "PUT", "/api/v1/admin/users/" + ADMIN_USER, adm,
				obj("name", "Demo Admin", "role", "admin", "active", false));
		assertThat(self.map()).containsEntry("details",
				List.of("you cannot change your own role or deactivate yourself"));
		Res leads = expect(409, "CONFLICT", "PUT", "/api/v1/admin/users/" + WO_USER, adm,
				obj("name", "Somchai Wong", "role", "rm", "active", true));
		assertThat(leads.map()).containsEntry("message", "conflict: user leads a team; assign another WO first");
		Res unknown = expect(404, "NOT_FOUND", "PUT", "/api/v1/admin/users/" + UNKNOWN_ID, adm,
				obj("name", "X", "role", "rm", "active", true));
		assertThat(unknown.map()).containsEntry("message", "not found: user not found");

		// Deactivating someone ends their existing session and blocks login.
		String rmToken = as(RM1);
		u = expect(200, null, "PUT", "/api/v1/admin/users/" + RM1_USER, adm,
				obj("name", "Nok Rattana", "role", "rm", "active", false, "teamId", TEAM_ALPHA))
			.map();
		assertThat(u).containsEntry("active", false);
		Res inactive = expect(401, "UNAUTHORIZED", "GET", "/api/v1/quotes", rmToken, null);
		assertThat(inactive.map()).containsEntry("message", "unauthorized: account is inactive");
		Res login = expect(401, "UNAUTHORIZED", "POST", "/api/v1/auth/login", null,
				obj("email", RM1, "password", "password"));
		assertThat(login.map()).containsEntry("message", "unauthorized: invalid email or password");

		Res notWo = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/teams", adm,
				obj("name", "Gamma", "woUserId", RM1_USER));
		assertThat(notWo.map()).containsEntry("details", List.of("woUserId must be an active WO"));
		Map<String, Object> team = expect(201, null, "POST", "/api/v1/admin/teams", adm,
				obj("name", "Gamma", "woUserId", "00000000-0000-4000-8000-000000000014"))
			.map();
		assertThat(m(team.get("wo"))).containsEntry("name", "Anan Boon");
		assertThat(team).containsEntry("members", List.of());
		Res dupTeam = expect(409, "CONFLICT", "POST", "/api/v1/admin/teams", adm,
				obj("name", "Team Alpha", "woUserId", WO_USER));
		assertThat(dupTeam.map()).containsEntry("message", "conflict: team \"Team Alpha\" already exists");
		team = expect(200, null, "PUT", "/api/v1/admin/teams/" + team.get("id"), adm,
				obj("name", "Gamma Team", "woUserId", WO_USER))
			.map();
		assertThat(team).containsEntry("name", "Gamma Team");
		expect(404, "NOT_FOUND", "PUT", "/api/v1/admin/teams/nope", adm, obj("name", "X", "woUserId", WO_USER));

		List<Map<String, Object>> teams = expect(200, null, "GET", "/api/v1/admin/teams", adm, null).list();
		assertThat(teams).hasSize(3);
		// New RM + Ploy; Nok is inactive.
		assertThat((List<?>) teams.get(1).get("members")).hasSize(2);
	}

	@Test
	void dashboard() {
		String customer = as(ACME_BUYER);
		Map<String, Object> sign = obj("signerName", "Alice", "signatureDataUrl", "data:x");

		// Each quote is Consulting (Services) 192.60 + Setup fee (Software) 1.61 = 194.21 incl. VAT.
		String a = sent("Q-A")[0];
		expect(200, null, "POST", "/api/v1/quotes/" + a + "/accept", customer, sign);
		String b = sent("Q-B")[0];
		expect(200, null, "POST", "/api/v1/quotes/" + b + "/reject", customer, null);
		sent("Q-C"); // pending: with the customer
		String d = create(RM1, "Q-D");
		expect(200, null, "POST", "/api/v1/quotes/" + d + "/submit", as(RM1), null); // in approval
		create("rm3@swiftquote.dev", "Q-E"); // draft, Team Beta

		String woc = as(WOC);
		Res res = expect(200, null, "GET", "/api/v1/dashboard/summary", woc, null);
		Map<String, Object> s = res.map();
		assertThat(s).containsEntry("from", null).containsEntry("to", null);
		assertThat(measure(s.get("won"))).isEqualTo("1/194.21");
		assertThat(measure(s.get("pending"))).isEqualTo("1/194.21");
		assertThat(measure(s.get("inApproval"))).isEqualTo("1/194.21");
		assertThat(s.get("sentCount")).isEqualTo(3);
		assertThat(res.raw()).contains("\"conversionRate\":0.3333");
		List<?> byStatus = (List<?>) s.get("byStatus");
		assertThat(byStatus).hasSize(8);
		assertThat(at(byStatus, 0)).containsEntry("status", "draft").containsEntry("count", 1);
		assertThat(text(at(byStatus, 7).get("amount"))).isEqualTo("0.00");

		// Won is grouped by signing month (this month), pending by expiry month (next month).
		List<?> months = (List<?>) s.get("byMonth");
		assertThat(months).hasSize(2);
		assertThat(measure(at(months, 0).get("won"))).isEqualTo("1/194.21");
		assertThat(measure(at(months, 1).get("pending"))).isEqualTo("1/194.21");
		assertThat(measure(at(months, 1).get("won"))).isEqualTo("0/0.00");

		List<?> rms = (List<?>) s.get("byRm");
		assertThat(rms).hasSize(2);
		Map<String, Object> top = at(rms, 0);
		assertThat(m(top.get("user"))).containsEntry("name", "Nok Rattana");
		assertThat(top).containsEntry("team", "Team Alpha").containsEntry("quoteCount", 4).containsEntry("sentCount", 3);
		assertThat(measure(top.get("pending"))).isEqualTo("1/194.21");
		assertThat(at(s.get("byTeam"), 0)).containsEntry("name", "Team Alpha");

		List<?> cats = (List<?>) s.get("byCategory");
		assertThat(cats).hasSize(2);
		assertThat(m(at(cats, 0).get("category"))).containsEntry("name", "Services");
		assertThat(measure(at(cats, 0).get("won"))).isEqualTo("1/192.60");
		assertThat(measure(at(cats, 1).get("pending"))).isEqualTo("1/1.61");

		String future = LocalDate.now(ZoneOffset.UTC).plusYears(1).toString();
		res = expect(200, null, "GET", "/api/v1/dashboard/summary?from=" + future, woc, null);
		assertThat(res.map()).containsEntry("sentCount", 0).containsEntry("from", future);
		assertThat(res.raw()).contains("\"conversionRate\":0.0000");
		Res order = expect(400, "VALIDATION_ERROR", "GET", "/api/v1/dashboard/summary?from=2026-12-01&to=2026-01-01",
				woc, null);
		assertThat(order.map()).containsEntry("details", List.of("from must not be after to"));
		Res bad = expect(400, "VALIDATION_ERROR", "GET", "/api/v1/dashboard/summary?from=yesterday", woc, null);
		assertThat(bad.map()).containsEntry("details", List.of("from must be a date (YYYY-MM-DD)"));
	}

	@Test
	void categories() {
		String adm = as(ADMIN);
		String rm = as(RM1);

		Map<String, Object> c = expect(201, null, "POST", "/api/v1/admin/categories", adm, obj("name", " Training "))
			.map();
		assertThat(c).containsEntry("name", "Training").containsEntry("active", true);
		Res dup = expect(409, "CONFLICT", "POST", "/api/v1/admin/categories", adm, obj("name", "Software"));
		assertThat(dup.map()).containsEntry("message", "conflict: category \"Software\" already exists");
		expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/categories", adm, obj("name", ""));
		expect(403, "FORBIDDEN", "POST", "/api/v1/admin/categories", rm, obj("name", "X"));
		Res noActive = expect(400, "VALIDATION_ERROR", "PUT", "/api/v1/admin/categories/" + CAT_SOFTWARE, adm,
				obj("name", "Software"));
		assertThat(noActive.map()).containsEntry("details", List.of("active is required"));
		Res unknown = expect(404, "NOT_FOUND", "PUT", "/api/v1/admin/categories/" + UNKNOWN_ID, adm,
				obj("name", "X", "active", true));
		assertThat(unknown.map()).containsEntry("message", "not found: category not found");

		// Retiring a category keeps it listed but stops RMs from using it.
		c = expect(200, null, "PUT", "/api/v1/admin/categories/" + CAT_SOFTWARE, adm,
				obj("name", "Software", "active", false))
			.map();
		assertThat(c).containsEntry("active", false);
		assertThat(expect(200, null, "GET", "/api/v1/categories", rm, null).list()).hasSize(4);
		expect(403, "FORBIDDEN", "GET", "/api/v1/categories", as(WO), null);

		Res res = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/quotes", rm, quoteBody("Q-CAT"));
		assertThat(res.map()).containsEntry("details", List.of("items[1].categoryId is not an active category"));
		Map<String, Object> body = quoteBody("Q-CAT");
		body.put("items", List.of(obj("title", "x", "quantity", 1, "unitPrice", 1)));
		res = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/quotes", rm, body);
		assertThat(res.map()).containsEntry("details", List.of("items[0].categoryId is required"));

		body.put("items", List.of(obj("title", "Workshop", "categoryId", c.get("id"), "quantity", 1, "unitPrice", 10)));
		expect(400, "VALIDATION_ERROR", "POST", "/api/v1/quotes", rm, body);
		body.put("items",
				List.of(obj("title", "Workshop", "categoryId", CAT_SERVICES, "quantity", 1, "unitPrice", 10)));
		Map<String, Object> q = expect(201, null, "POST", "/api/v1/quotes", rm, body).map();
		assertThat(m(at(q.get("items"), 0).get("category"))).containsEntry("name", "Services");
	}

	@Test
	void errorResponses() {
		String rm = as(RM1);
		create(RM1, "Q-DUP");
		Map<String, Object> otherClient = quoteBody("Q-X");
		otherClient.put("clientId", UNKNOWN_ID);
		record Case(String name, String method, String path, String token, Object body, int status, String code,
				String message) {
		}
		List<Case> cases = List.of(
				new Case("wrong password", "POST", "/api/v1/auth/login", null,
						obj("email", RM1, "password", "nope"), 401, "UNAUTHORIZED",
						"unauthorized: invalid email or password"),
				new Case("no token", "GET", "/api/v1/quotes", null, null, 401, "UNAUTHORIZED",
						"unauthorized: missing bearer token"),
				new Case("bad token", "GET", "/api/v1/quotes", "garbage", null, 401, "UNAUTHORIZED",
						"unauthorized: invalid or expired token"),
				new Case("unknown route", "GET", "/api/v1/nope", null, null, 404, "NOT_FOUND", "route not found"),
				new Case("unknown POST route", "POST", "/api/v1/nope", null, obj(), 404, "NOT_FOUND",
						"route not found"),
				new Case("wrong method", "DELETE", "/api/v1/quotes", null, null, 405, "VALIDATION_ERROR",
						"Method Not Allowed"),
				new Case("invalid status filter", "GET", "/api/v1/quotes?status=bogus", rm, null, 400,
						"VALIDATION_ERROR", "request validation failed"),
				new Case("duplicate number", "POST", "/api/v1/quotes", rm, quoteBody("Q-DUP"), 409, "CONFLICT",
						"conflict: quoteNumber \"Q-DUP\" already exists"),
				new Case("missing fields", "POST", "/api/v1/quotes", rm,
						obj("quoteNumber", " ", "items", List.of(obj("title", ""))), 400, "VALIDATION_ERROR",
						"request validation failed"),
				new Case("other tenant client", "POST", "/api/v1/quotes", rm, otherClient, 400, "VALIDATION_ERROR",
						"request validation failed"),
				new Case("unknown quote", "GET", "/api/v1/quotes/" + UNKNOWN_ID, rm, null, 404, "NOT_FOUND",
						"not found: quote not found"),
				new Case("malformed quote id", "GET", "/api/v1/quotes/nope", rm, null, 404, "NOT_FOUND",
						"not found: quote not found"));
		for (Case tc : cases) {
			Res res = call(tc.method(), tc.path(), tc.token(), tc.body());
			assertThat(res.status()).as(tc.name() + ": " + res.raw()).isEqualTo(tc.status());
			assertThat(res.map()).as(tc.name())
				.containsEntry("code", tc.code())
				.containsEntry("message", tc.message());
		}

		assertThat(call("GET", "/api/v1/quotes?status=bogus", rm, null).map()).containsEntry("details",
				List.of("status \"bogus\" is not a valid QuoteStatus"));
		assertThat(call("POST", "/api/v1/quotes", rm, obj("quoteNumber", " ", "items", List.of(obj("title", ""))))
			.map()).containsEntry("details", List.of("clientId is required", "expiryDate is required",
					"items[0].categoryId is required", "items[0].quantity is required",
					"items[0].unitPrice is required"));
		assertThat(call("POST", "/api/v1/quotes", rm, otherClient).map()).containsEntry("details",
				List.of("clientId does not exist"));

		// The second pass reports every value problem at once; pricing reports its first invalid line.
		Map<String, Object> values = quoteBody(" ");
		values.put("expiryDate", "2000-01-01");
		values.put("items", List.of(obj("title", " ", "categoryId", CAT_SERVICES, "quantity", 0.5, "unitPrice", -1,
				"discountPercent", 101)));
		assertThat(call("POST", "/api/v1/quotes", rm, values).map()).containsEntry("details",
				List.of("quoteNumber is required", "expiryDate must not be in the past", "items[0].title is required",
						"items[0]: quantity must be at least 1"));
		Map<String, Object> noItems = quoteBody("Q-NONE");
		noItems.put("items", List.of());
		assertThat(call("POST", "/api/v1/quotes", rm, noItems).map()).containsEntry("details",
				List.of("quote must have at least one item"));

		// Malformed JSON is a 400 after the session check and before the role check.
		Res malformed = raw("POST", "/api/v1/quotes", rm, "{not json");
		assertThat(malformed.status()).isEqualTo(400);
		assertThat(malformed.map()).containsEntry("code", "VALIDATION_ERROR")
			.containsEntry("message", "request validation failed");
		assertThat((List<?>) malformed.map().get("details")).singleElement()
			.asString()
			.startsWith("malformed JSON body: ");
		assertThat(raw("POST", "/api/v1/quotes", as(WO), "{not json").status()).isEqualTo(400);
		assertThat(raw("POST", "/api/v1/quotes", null, "{not json").status()).isEqualTo(401);
		assertThat(raw("POST", "/api/v1/quotes", rm, "{\"clientId\": 5}").status()).isEqualTo(400);
		assertThat(raw("POST", "/api/v1/quotes", rm, "{\"expiryDate\": \"01/01/2099\"}").status()).isEqualTo(400);
		assertThat(raw("POST", "/api/v1/auth/login", null, "").map()).containsEntry("details",
				List.of("malformed JSON body: unexpected end of JSON input"));
	}

	@Test
	void responseShapes() {
		Map<String, Object> login = expect(200, null, "POST", "/api/v1/auth/login", null,
				obj("email", " RM1@SwiftQuote.dev ", "password", "password"))
			.map();
		assertThat(login).containsEntry("tenantId", "00000000-0000-4000-8000-000000000001")
			.containsEntry("user", obj("id", RM1_USER, "name", "Nok Rattana", "role", "rm"));

		String rm = (String) login.get("accessToken");
		Res created = expect(201, null, "POST", "/api/v1/quotes", rm, quoteBody("Q-SHAPE"));
		// Money has exactly two decimals; nullable fields are present as null.
		assertThat(created.raw()).contains("\"subtotal\":201.50", "\"discountAmount\":20.00", "\"taxAmount\":12.71",
				"\"grandTotal\":194.21", "\"quantity\":2.00", "\"taxPercent\":7.00", "\"lineTotal\":180.00",
				"\"signedBy\":null", "\"signedAt\":null", "\"description\":null", "\"comment\":null");
		Map<String, Object> q = created.map();
		assertThat(q.keySet()).containsExactly("id", "quoteNumber", "status", "clientId", "clientName", "createdBy",
				"expiryDate", "subtotal", "discountAmount", "taxAmount", "grandTotal", "accessToken", "signedBy",
				"signedAt", "items", "history");
		Map<String, Object> event = at(q.get("history"), 0);
		assertThat(event.keySet()).containsExactly("action", "actor", "comment", "at");
		assertThat(m(event.get("actor"))).containsEntry("id", RM1_USER);

		List<Map<String, Object>> list = expect(200, null, "GET", "/api/v1/quotes", rm, null).list();
		assertThat(list).singleElement()
			.satisfies((row) -> assertThat(row.keySet()).containsExactly("id", "quoteNumber", "clientName", "status",
					"grandTotal", "expiryDate", "createdBy"));

		List<Map<String, Object>> clients = expect(200, null, "GET", "/api/v1/clients", rm, null).list();
		assertThat(clients).extracting((cl) -> cl.get("name")).containsExactly("Acme Corporation", "Globex Ltd.");
		assertThat(clients.get(0)).containsEntry("email", "buyer@acme.example");

		List<Map<String, Object>> categories = expect(200, null, "GET", "/api/v1/categories", rm, null).list();
		assertThat(categories).extracting((cat) -> cat.get("name")).containsExactly("Hardware", "Services", "Software");

		// Tokens carry sub, tid, role, iat and exp, and a trailing slash or case change reaches the same route.
		assertThat(expect(200, null, "GET", "/api/v1/QUOTES/", rm, null).list()).hasSize(1);
	}

	@Test
	void customerSeesOnlyCustomerEvents() {
		String[] q = sent("Q-CUST");
		String customer = as(ACME_BUYER);
		Map<String, Object> rejected = expect(200, null, "POST", "/api/v1/quotes/" + q[0] + "/reject", customer,
				obj("comment", " no thanks "))
			.map();
		assertThat(rejected).containsEntry("status", "rejected");
		assertThat(actions(rejected)).containsExactly("sent", "rejected");
		List<String> comments = new ArrayList<>();
		for (Object e : (List<?>) rejected.get("history")) {
			comments.add((String) m(e).get("comment"));
		}
		assertThat(comments).containsExactly(null, "no thanks");
		// Drafts never reach customers.
		String draft = create(RM1, "Q-HIDDEN");
		expect(404, "NOT_FOUND", "GET", "/api/v1/quotes/" + draft, customer, null);
	}

}
