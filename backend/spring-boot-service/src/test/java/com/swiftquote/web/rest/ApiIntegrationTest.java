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

	static final String CAT_HARDWARE = "00000000-0000-4000-8000-000000000032";

	static final String CRM_LICENCE = "00000000-0000-4000-8000-000000000040";

	static final String CONSULTING = "00000000-0000-4000-8000-000000000043";

	static final String LAPTOP = "00000000-0000-4000-8000-000000000044";

	static final String MOUSE = "00000000-0000-4000-8000-000000000045";

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

	/** Consulting (Services) 2 x 100 less 10% and a CRM licence (Software) at 1.50: 194.21 incl. VAT. */
	static Map<String, Object> quoteBody(String number) {
		return quoteBody(number, List.of(obj("productId", CONSULTING, "quantity", 2, "unitPrice", 100,
				"discountValue", 10), obj("productId", CRM_LICENCE, "quantity", 1, "unitPrice", 1.5)));
	}

	static Map<String, Object> quoteBody(String number, List<Map<String, Object>> items) {
		return obj("clientId", ACME_CLIENT, "quoteNumber", number, "expiryDate", inAMonth(), "items", items);
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

	/** "cost/profit" of a dashboard measure. */
	static String margin(Object v) {
		return text(m(v).get("cost")) + "/" + text(m(v).get("profit"));
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
		body.put("items", List.of(obj("productId", CONSULTING, "quantity", 2, "unitPrice", 100, "discountType",
				"percent", "discountValue", 5)));
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
		// Cost and profit are before VAT: Consulting 2 x 900 against 180.00, CRM licence 1 x 1800 against 1.50.
		assertThat(res.raw()).contains("\"won\":{\"count\":1,\"amount\":194.21,\"cost\":3600.00,\"profit\":-3418.50}");
		assertThat(margin(s.get("pending"))).isEqualTo("3600.00/-3418.50");
		assertThat(margin(s.get("inApproval"))).isEqualTo("3600.00/-3418.50");
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
		assertThat(margin(at(months, 1).get("won"))).isEqualTo("0.00/0.00");
		assertThat(margin(at(months, 0).get("won"))).isEqualTo("3600.00/-3418.50");
		assertThat(margin(at(months, 1).get("pending"))).isEqualTo("3600.00/-3418.50");

		List<?> rms = (List<?>) s.get("byRm");
		assertThat(rms).hasSize(2);
		Map<String, Object> top = at(rms, 0);
		assertThat(m(top.get("user"))).containsEntry("name", "Nok Rattana");
		assertThat(top).containsEntry("team", "Team Alpha").containsEntry("quoteCount", 4).containsEntry("sentCount", 3);
		assertThat(measure(top.get("pending"))).isEqualTo("1/194.21");
		assertThat(margin(top.get("won"))).isEqualTo("3600.00/-3418.50");
		assertThat(margin(at(rms, 1).get("won"))).isEqualTo("0.00/0.00");
		assertThat(at(s.get("byTeam"), 0)).containsEntry("name", "Team Alpha");
		assertThat(margin(at(s.get("byTeam"), 0).get("pending"))).isEqualTo("3600.00/-3418.50");

		List<?> cats = (List<?>) s.get("byCategory");
		assertThat(cats).hasSize(2);
		assertThat(m(at(cats, 0).get("category"))).containsEntry("name", "Services");
		assertThat(measure(at(cats, 0).get("won"))).isEqualTo("1/192.60");
		assertThat(measure(at(cats, 1).get("pending"))).isEqualTo("1/1.61");
		// A category's cost and profit come from its own lines.
		assertThat(margin(at(cats, 0).get("won"))).isEqualTo("1800.00/-1620.00");
		assertThat(margin(at(cats, 1).get("pending"))).isEqualTo("1800.00/-1798.50");

		// Lines without a cost (saved before products) are left out of cost and profit, not the counts.
		this.jdbc.sql("UPDATE quote_items SET unit_cost = NULL WHERE position = 1").update();
		s = expect(200, null, "GET", "/api/v1/dashboard/summary", woc, null).map();
		assertThat(measure(s.get("won"))).isEqualTo("1/194.21");
		assertThat(margin(s.get("won"))).isEqualTo("1800.00/-1620.00");
		cats = (List<?>) s.get("byCategory");
		assertThat(measure(at(cats, 1).get("pending"))).isEqualTo("1/1.61");
		assertThat(margin(at(cats, 1).get("pending"))).isEqualTo("0.00/0.00");

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

		// Lines take their category from the product, so a retired category stays on new lines.
		Map<String, Object> q = expect(201, null, "POST", "/api/v1/quotes", rm, quoteBody("Q-CAT")).map();
		assertThat(m(at(q.get("items"), 1).get("category"))).containsEntry("name", "Software");
	}

	@Test
	void adminDeletes() {
		String adm = as(ADMIN);

		// Users: only accounts nothing refers to; the rest are deactivated instead.
		String temp = (String) expect(201, null, "POST", "/api/v1/admin/users", adm, obj("email", "temp@swiftquote.dev",
				"name", "Temp", "password", "password", "role", "rm", "teamId", TEAM_ALPHA))
			.map()
			.get("id");
		String tempDelete = "/api/v1/admin/users/" + temp + "/delete";
		expect(401, "UNAUTHORIZED", "POST", tempDelete, null, null);
		Res forbidden = expect(403, "FORBIDDEN", "POST", tempDelete, as(WOC), null);
		assertThat(forbidden.map()).containsEntry("message", "forbidden: your role cannot perform this action");
		Res done = expect(204, null, "POST", tempDelete, adm, null);
		assertThat(done.raw()).isEmpty();
		assertThat(this.jdbc.sql("SELECT count(*) FROM users WHERE email = 'temp@swiftquote.dev'")
			.query(Integer.class)
			.single()).isZero();
		Res gone = expect(404, "NOT_FOUND", "POST", tempDelete, adm, null);
		assertThat(gone.map()).containsEntry("message", "not found: user not found");
		expect(404, "NOT_FOUND", "POST", "/api/v1/admin/users/" + UNKNOWN_ID + "/delete", adm, null);
		expect(404, "NOT_FOUND", "POST", "/api/v1/admin/users/nope/delete", adm, null);
		expect(401, "UNAUTHORIZED", "POST", "/api/v1/auth/login", null,
				obj("email", "temp@swiftquote.dev", "password", "password"));

		Res self = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/users/" + ADMIN_USER + "/delete", adm, null);
		assertThat(self.map()).containsEntry("message", "request validation failed")
			.containsEntry("details", List.of("you cannot delete yourself"));
		Res leads = expect(409, "CONFLICT", "POST", "/api/v1/admin/users/" + WO_USER + "/delete", adm, null);
		assertThat(leads.map()).containsEntry("message", "conflict: user leads a team; assign another WO first");
		create(RM1, "Q-DEL");
		Res history = expect(409, "CONFLICT", "POST", "/api/v1/admin/users/" + RM1_USER + "/delete", adm, null);
		assertThat(history.map()).containsEntry("message", "conflict: user has quote history; deactivate instead");

		// A user who also belongs to another organization only loses this membership.
		String shared = (String) expect(201, null, "POST", "/api/v1/admin/users", adm,
				obj("email", "shared@swiftquote.dev", "name", "Shared", "password", "password", "role", "woc"))
			.map()
			.get("id");
		this.jdbc.sql("""
				WITH o AS (INSERT INTO organizations (name, slug) VALUES ('Other', 'other-delete') RETURNING id)
				INSERT INTO organization_members (organization_id, user_id, role)
				SELECT o.id, CAST(:u AS uuid), 'woc' FROM o""").param("u", shared).update();
		expect(204, null, "POST", "/api/v1/admin/users/" + shared + "/delete", adm, null);
		assertThat(this.jdbc.sql("SELECT count(*) FROM users WHERE id = CAST(:u AS uuid)")
			.param("u", shared)
			.query(Integer.class)
			.single()).isOne();
		expect(404, "NOT_FOUND", "POST", "/api/v1/admin/users/" + shared + "/delete", adm, null);

		// Teams: only empty ones, counting inactive members too.
		Res members = expect(409, "CONFLICT", "POST", "/api/v1/admin/teams/" + TEAM_ALPHA + "/delete", adm, null);
		assertThat(members.map()).containsEntry("message",
				"conflict: team has members; move them to another team first");
		String team = (String) expect(201, null, "POST", "/api/v1/admin/teams", adm,
				obj("name", "Empty", "woUserId", WO_USER))
			.map()
			.get("id");
		String parked = (String) expect(201, null, "POST", "/api/v1/admin/users", adm, obj("email",
				"parked@swiftquote.dev", "name", "Parked", "password", "password", "role", "rm", "teamId", team))
			.map()
			.get("id");
		expect(200, null, "PUT", "/api/v1/admin/users/" + parked, adm,
				obj("name", "Parked", "role", "rm", "active", false, "teamId", team));
		expect(409, "CONFLICT", "POST", "/api/v1/admin/teams/" + team + "/delete", adm, null);
		expect(403, "FORBIDDEN", "POST", "/api/v1/admin/teams/" + team + "/delete", as(WO), null);
		expect(200, null, "PUT", "/api/v1/admin/users/" + parked, adm,
				obj("name", "Parked", "role", "rm", "active", false, "teamId", TEAM_ALPHA));
		expect(204, null, "POST", "/api/v1/admin/teams/" + team + "/delete", adm, obj());
		Res noTeam = expect(404, "NOT_FOUND", "POST", "/api/v1/admin/teams/" + team + "/delete", adm, null);
		assertThat(noTeam.map()).containsEntry("message", "not found: team not found");
		expect(404, "NOT_FOUND", "POST", "/api/v1/admin/teams/nope/delete", adm, null);
		expect(404, "NOT_FOUND", "POST", "/api/v1/admin/teams/" + UNKNOWN_ID + "/delete", adm, null);

		// Categories: only unused ones (Q-DEL uses Services and Software); the body is ignored, even when not JSON.
		Res used = expect(409, "CONFLICT", "POST", "/api/v1/admin/categories/" + CAT_SOFTWARE + "/delete", adm, null);
		assertThat(used.map()).containsEntry("message", "conflict: category is used on quotes; retire it instead");
		String cat = (String) expect(201, null, "POST", "/api/v1/admin/categories", adm, obj("name", "Unused"))
			.map()
			.get("id");
		expect(403, "FORBIDDEN", "POST", "/api/v1/admin/categories/" + cat + "/delete", as(RM1), null);
		Res malformed = raw("POST", "/api/v1/admin/categories/" + cat + "/delete", adm, "{nope");
		assertThat(malformed.status()).as(malformed.raw()).isEqualTo(204);
		Res noCat = expect(404, "NOT_FOUND", "POST", "/api/v1/admin/categories/" + cat + "/delete", adm, null);
		assertThat(noCat.map()).containsEntry("message", "not found: category not found");
		expect(404, "NOT_FOUND", "POST", "/api/v1/admin/categories/nope/delete", adm, null);
		expect(404, "NOT_FOUND", "POST", "/api/v1/admin/categories/" + UNKNOWN_ID + "/delete", adm, null);
		// Hardware is on no quote but has products.
		Res products = expect(409, "CONFLICT", "POST", "/api/v1/admin/categories/" + CAT_HARDWARE + "/delete", adm,
				null);
		assertThat(products.map()).containsEntry("message",
				"conflict: category is used by products; move them to another category first");
		assertThat(expect(200, null, "GET", "/api/v1/categories", adm, null).list()).hasSize(3);
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
						obj("quoteNumber", " ", "items", List.of(obj("description", ""))), 400, "VALIDATION_ERROR",
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
		assertThat(call("POST", "/api/v1/quotes", rm,
				obj("quoteNumber", " ", "items", List.of(obj("discountType", "fixed"))))
			.map()).containsEntry("details", List.of("clientId is required", "expiryDate is required",
					"items[0].productId is required", "items[0].quantity is required",
					"items[0].discountType \"fixed\" is not a valid DiscountType"));
		assertThat(call("POST", "/api/v1/quotes", rm, otherClient).map()).containsEntry("details",
				List.of("clientId does not exist"));

		// The second pass reports every value problem at once; pricing reports its first invalid line.
		Map<String, Object> values = quoteBody(" ");
		values.put("expiryDate", "2000-01-01");
		values.put("items", List.of(obj("productId", CONSULTING, "quantity", 0.5, "unitPrice", -1,
				"discountValue", 101)));
		assertThat(call("POST", "/api/v1/quotes", rm, values).map()).containsEntry("details",
				List.of("quoteNumber is required", "expiryDate must not be in the past",
						"items[0]: quantity must be at least 1"));
		values.put("items", List.of(obj("productId", CONSULTING, "quantity", 1), obj("productId", UNKNOWN_ID,
				"quantity", 1)));
		assertThat(call("POST", "/api/v1/quotes", rm, values).map()).containsEntry("details",
				List.of("quoteNumber is required", "expiryDate must not be in the past",
						"items[1].productId is not an active product"));
		Map<String, Object> amount = quoteBody("Q-AMT", List.of(obj("productId", CONSULTING, "quantity", 1),
				obj("productId", MOUSE, "quantity", 2, "discountType", "amount", "discountValue", 1180.01)));
		assertThat(call("POST", "/api/v1/quotes", rm, amount).map()).containsEntry("details",
				List.of("items[1]: discountValue must not exceed the line amount"));
		amount.put("items", List.of(obj("productId", MOUSE, "quantity", 2, "discountType", "percent",
				"discountValue", -1)));
		assertThat(call("POST", "/api/v1/quotes", rm, amount).map()).containsEntry("details",
				List.of("items[0]: discountValue must not be negative"));
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
				"expiryDate", "subtotal", "discountAmount", "taxAmount", "grandTotal", "costTotal", "profit",
				"accessToken", "signedBy", "signedAt", "items", "history");
		Map<String, Object> line = at(q.get("items"), 0);
		assertThat(line.keySet()).containsExactly("product", "title", "category", "description", "quantity",
				"unitPrice", "discountType", "discountValue", "discountAmount", "taxPercent", "lineTotal", "unitCost",
				"costTotal", "profit");
		assertThat(m(line.get("product"))).containsEntry("id", CONSULTING)
			.containsEntry("name", "Consulting (per hour)");
		assertThat(line).containsEntry("title", "Consulting (per hour)").containsEntry("discountType", "percent");
		// Consulting costs 900/h: 2 x 900 = 1800 against 180 of revenue; the licence costs 1800.
		assertThat(created.raw()).contains("\"discountValue\":10.00", "\"discountAmount\":20.00",
				"\"unitCost\":900.00", "\"costTotal\":1800.00", "\"profit\":-1620.00", "\"costTotal\":3600.00",
				"\"profit\":-3418.50");
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


	@Test
	void products() {
		String adm = as(ADMIN);

		for (String email : List.of(ADMIN, WOC, WO, RM1)) {
			assertThat(expect(200, null, "GET", "/api/v1/products", as(email), null).list()).as(email).hasSize(6);
		}
		expect(403, "FORBIDDEN", "GET", "/api/v1/products", as(ACME_BUYER), null);
		expect(401, "UNAUTHORIZED", "GET", "/api/v1/products", null, null);

		Res list = expect(200, null, "GET", "/api/v1/products", as(RM1), null);
		assertThat(list.list()).extracting((p) -> p.get("name"))
			.containsExactly("CRM licence (per user / year)", "Consulting (per hour)", "Hosting (per month)",
					"Laptop 14-inch", "Website redesign", "Wireless mouse");
		assertThat(list.list().get(0).keySet()).containsExactly("id", "name", "category", "unitPrice", "unitCost",
				"stock", "active");
		assertThat(list.raw()).contains("{\"id\":\"" + LAPTOP
				+ "\",\"name\":\"Laptop 14-inch\",\"category\":{\"id\":\"" + CAT_HARDWARE
				+ "\",\"name\":\"Hardware\"},\"unitPrice\":32900.00,\"unitCost\":26500.00,\"stock\":25.00,\"active\":true}");
		assertThat(list.list().get(0)).containsEntry("stock", null);

		Map<String, Object> p = expect(201, null, "POST", "/api/v1/admin/products", adm, obj("name", " Docking station ",
				"categoryId", CAT_HARDWARE, "unitPrice", 4990, "unitCost", 3200.5, "stock", 2.5))
			.map();
		String id = (String) p.get("id");
		assertThat(p).containsEntry("name", "Docking station").containsEntry("active", true);
		assertThat(text(p.get("stock"))).isEqualTo("2.50");
		assertThat(text(p.get("unitCost"))).isEqualTo("3200.50");
		Res dup = expect(409, "CONFLICT", "POST", "/api/v1/admin/products", adm,
				obj("name", "Wireless mouse", "categoryId", CAT_HARDWARE, "unitPrice", 1, "unitCost", 1));
		assertThat(dup.map()).containsEntry("message", "conflict: product \"Wireless mouse\" already exists");
		Res empty = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/products", adm, obj("stock", -1));
		assertThat(empty.map()).containsEntry("details", List.of("name is required", "categoryId is required",
				"unitPrice is required", "unitCost is required", "stock must not be negative"));
		Res negative = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/products", adm,
				obj("name", "X", "categoryId", UNKNOWN_ID, "unitPrice", -1, "unitCost", -2));
		assertThat(negative.map()).containsEntry("details",
				List.of("unitPrice must not be negative", "unitCost must not be negative"));
		Res category = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/admin/products", adm,
				obj("name", "X", "categoryId", UNKNOWN_ID, "unitPrice", 1, "unitCost", 1));
		assertThat(category.map()).containsEntry("details", List.of("categoryId is not an active category"));
		expect(403, "FORBIDDEN", "POST", "/api/v1/admin/products", as(RM1), obj());
		expect(403, "FORBIDDEN", "PUT", "/api/v1/admin/products/" + UNKNOWN_ID, as(WOC), obj());

		Res unknown = expect(404, "NOT_FOUND", "PUT", "/api/v1/admin/products/" + UNKNOWN_ID, adm, obj());
		assertThat(unknown.map()).containsEntry("message", "not found: product not found");
		Res noActive = expect(400, "VALIDATION_ERROR", "PUT", "/api/v1/admin/products/" + id, adm,
				obj("name", "Dock", "categoryId", CAT_HARDWARE, "unitPrice", 1, "unitCost", 1));
		assertThat(noActive.map()).containsEntry("details", List.of("active is required"));
		Res renameDup = expect(409, "CONFLICT", "PUT", "/api/v1/admin/products/" + id, adm, obj("name",
				"Laptop 14-inch", "categoryId", CAT_HARDWARE, "unitPrice", 1, "unitCost", 1, "active", true));
		assertThat(renameDup.map()).containsEntry("message", "conflict: product \"Laptop 14-inch\" already exists");
		p = expect(200, null, "PUT", "/api/v1/admin/products/" + id, adm, obj("name", "Dock", "categoryId",
				CAT_SERVICES, "unitPrice", 5000, "unitCost", 3000, "active", true))
			.map();
		assertThat(p).containsEntry("name", "Dock").containsEntry("stock", null);
		assertThat(m(p.get("category"))).containsEntry("name", "Services");

		// Lines snapshot the cost; changing it later does not touch existing quotes.
		Map<String, Object> q = expect(201, null, "POST", "/api/v1/quotes", as(RM1),
				quoteBody("Q-DOCK", List.of(obj("productId", id, "quantity", 1, "description", "Desk"))))
			.map();
		Map<String, Object> line = at(q.get("items"), 0);
		assertThat(line).containsEntry("title", "Dock").containsEntry("description", "Desk");
		assertThat(text(line.get("unitPrice"))).isEqualTo("5000.00");
		assertThat(text(line.get("unitCost"))).isEqualTo("3000.00");
		expect(200, null, "PUT", "/api/v1/admin/products/" + id, adm, obj("name", "Dock", "categoryId", CAT_SERVICES,
				"unitPrice", 5000, "unitCost", 4000, "active", false));
		q = expect(200, null, "GET", "/api/v1/quotes/" + q.get("id"), as(RM1), null).map();
		assertThat(text(at(q.get("items"), 0).get("unitCost"))).isEqualTo("3000.00");
		assertThat(text(q.get("profit"))).isEqualTo("2000.00");

		// Retired products cannot be put on lines.
		Res retired = expect(400, "VALIDATION_ERROR", "POST", "/api/v1/quotes", as(RM1),
				quoteBody("Q-RET", List.of(obj("productId", id, "quantity", 1))));
		assertThat(retired.map()).containsEntry("details", List.of("items[0].productId is not an active product"));

		Res used = expect(409, "CONFLICT", "POST", "/api/v1/admin/products/" + id + "/delete", adm, null);
		assertThat(used.map()).containsEntry("message", "conflict: product is used on quotes; retire it instead");
		expect(403, "FORBIDDEN", "POST", "/api/v1/admin/products/" + MOUSE + "/delete", as(WO), null);
		Res done = raw("POST", "/api/v1/admin/products/" + MOUSE + "/delete", adm, "{nope");
		assertThat(done.status()).as(done.raw()).isEqualTo(204);
		assertThat(done.raw()).isEmpty();
		Res gone = expect(404, "NOT_FOUND", "POST", "/api/v1/admin/products/" + MOUSE + "/delete", adm, null);
		assertThat(gone.map()).containsEntry("message", "not found: product not found");
		expect(404, "NOT_FOUND", "POST", "/api/v1/admin/products/nope/delete", adm, null);
	}

	@Test
	void costIsHiddenFromCustomers() {
		String[] q = sent("Q-COST");
		Map<String, Object> internal = expect(200, null, "GET", "/api/v1/quotes/" + q[0], as(WOC), null).map();
		assertThat(internal).containsKeys("costTotal", "profit");
		assertThat(at(internal.get("items"), 0)).containsKeys("unitCost", "costTotal", "profit");

		Res customer = expect(200, null, "GET", "/api/v1/quotes/" + q[0], as(ACME_BUYER), null);
		Res link = expect(200, null, "GET", "/api/v1/public/quotes/" + q[1], null, null);
		Res accepted = expect(200, null, "POST", "/api/v1/public/quotes/" + q[1] + "/accept", null,
				obj("signerName", "A", "signatureDataUrl", "data:x"));
		for (Res res : List.of(customer, link, accepted)) {
			assertThat(res.raw()).doesNotContain("unitCost", "costTotal", "profit");
			assertThat(at(res.map().get("items"), 0).keySet()).containsExactly("product", "title", "category",
					"description", "quantity", "unitPrice", "discountType", "discountValue", "discountAmount",
					"taxPercent", "lineTotal");
		}
		assertThat(customer.map().keySet()).containsExactly("id", "quoteNumber", "status", "clientId", "clientName",
				"createdBy", "expiryDate", "subtotal", "discountAmount", "taxAmount", "grandTotal", "accessToken",
				"signedBy", "signedAt", "items", "history");

		// Lines saved before products existed have no cost: null for staff, and the quote has no profit.
		this.jdbc.sql("UPDATE quote_items SET unit_cost = NULL, product_id = NULL WHERE position = 1").update();
		Res legacy = expect(200, null, "GET", "/api/v1/quotes/" + q[0], as(RM1), null);
		assertThat(legacy.map()).containsEntry("costTotal", null).containsEntry("profit", null);
		assertThat(at(legacy.map().get("items"), 1)).containsEntry("product", null)
			.containsEntry("unitCost", null)
			.containsEntry("costTotal", null)
			.containsEntry("profit", null);
	}

	@Test
	void amountDiscounts() {
		Map<String, Object> q = expect(201, null, "POST", "/api/v1/quotes", as(RM1), quoteBody("Q-AMOUNT",
				List.of(obj("productId", LAPTOP, "quantity", 2, "discountType", "percent", "discountValue", 5),
						obj("productId", MOUSE, "quantity", 10, "discountType", "amount", "discountValue", 400),
						obj("productId", "00000000-0000-4000-8000-000000000041", "quantity", 12, "taxPercent", 0))))
			.map();
		// The mixed case from contracts/fixtures/pricing-cases.json.
		assertThat(text(q.get("subtotal"))).isEqualTo("75900.00");
		assertThat(text(q.get("discountAmount"))).isEqualTo("3690.00");
		assertThat(text(q.get("grandTotal"))).isEqualTo("76970.70");
		assertThat(text(q.get("costTotal"))).isEqualTo("57540.00");
		assertThat(text(q.get("profit"))).isEqualTo("14670.00");
		Map<String, Object> mouse = at(q.get("items"), 1);
		assertThat(mouse).containsEntry("discountType", "amount");
		assertThat(text(mouse.get("discountValue"))).isEqualTo("400.00");
		assertThat(text(mouse.get("discountAmount"))).isEqualTo("400.00");
		assertThat(text(mouse.get("lineTotal"))).isEqualTo("5500.00");
		assertThat(at(q.get("items"), 2)).containsEntry("discountType", "percent");
	}

	@Test
	void stockIsCheckedAndDeducted() {
		String rm = as(RM1);
		String id = (String) expect(201, null, "POST", "/api/v1/quotes", rm, quoteBody("Q-STOCK",
				List.of(obj("productId", MOUSE, "quantity", 1), obj("productId", LAPTOP, "quantity", 20),
						obj("productId", CONSULTING, "quantity", 500), obj("productId", LAPTOP, "quantity", 6))))
			.map()
			.get("id");
		Res submit = expect(409, "CONFLICT", "POST", "/api/v1/quotes/" + id + "/submit", rm, null);
		assertThat(submit.map()).containsEntry("message", "conflict: not enough stock for Laptop 14-inch (available 25)");

		Map<String, Object> body = quoteBody("Q-STOCK", List.of(obj("productId", MOUSE, "quantity", 1),
				obj("productId", LAPTOP, "quantity", 20), obj("productId", LAPTOP, "quantity", 2.5)));
		expect(200, null, "PUT", "/api/v1/quotes/" + id, rm, body);
		expect(200, null, "POST", "/api/v1/quotes/" + id + "/submit", rm, null);
		expect(200, null, "POST", "/api/v1/quotes/" + id + "/approve", as(WO), null);
		setStock(LAPTOP, "10");
		Res send = expect(409, "CONFLICT", "POST", "/api/v1/quotes/" + id + "/send", rm, null);
		assertThat(send.map()).containsEntry("message", "conflict: not enough stock for Laptop 14-inch (available 10)");
		setStock(LAPTOP, "25");
		String link = (String) expect(200, null, "POST", "/api/v1/quotes/" + id + "/send", rm, null).map()
			.get("accessToken");

		// Someone else sold laptops meanwhile: nothing changes, not even the mouse stock.
		setStock(LAPTOP, "2.5");
		Map<String, Object> sign = obj("signerName", "Alice", "signatureDataUrl", "data:x");
		Res accept = expect(409, "CONFLICT", "POST", "/api/v1/quotes/" + id + "/accept", as(ACME_BUYER), sign);
		assertThat(accept.map()).containsEntry("message", "conflict: not enough stock for Laptop 14-inch (available 2.5)");
		Res pub = expect(409, "CONFLICT", "POST", "/api/v1/public/quotes/" + link + "/accept", null, sign);
		assertThat(pub.map()).containsEntry("message", "conflict: not enough stock for Laptop 14-inch (available 2.5)");
		assertThat(stock(MOUSE)).isEqualTo("200.00");
		assertThat(expect(200, null, "GET", "/api/v1/quotes/" + id, rm, null).map()).containsEntry("status", "sent");

		setStock(LAPTOP, "30");
		expect(200, null, "POST", "/api/v1/public/quotes/" + link + "/accept", null, sign);
		assertThat(stock(LAPTOP)).isEqualTo("7.50");
		assertThat(stock(MOUSE)).isEqualTo("199.00");
		assertThat(stock(CONSULTING)).isNull();

		// Zero left is reported as 0.
		setStock(LAPTOP, "0");
		String other = (String) expect(201, null, "POST", "/api/v1/quotes", rm,
				quoteBody("Q-STOCK2", List.of(obj("productId", LAPTOP, "quantity", 1))))
			.map()
			.get("id");
		Res none = expect(409, "CONFLICT", "POST", "/api/v1/quotes/" + other + "/submit", rm, null);
		assertThat(none.map()).containsEntry("message", "conflict: not enough stock for Laptop 14-inch (available 0)");
	}

	void setStock(String product, String stock) {
		this.jdbc.sql("UPDATE products SET stock = CAST(:s AS numeric) WHERE id = CAST(:id AS uuid)")
			.param("s", stock)
			.param("id", product)
			.update();
	}

	String stock(String product) {
		BigDecimal s = this.jdbc.sql("SELECT stock FROM products WHERE id = CAST(:id AS uuid)")
			.param("id", product)
			.query((rs, n) -> rs.getBigDecimal(1))
			.list()
			.get(0);
		return (s != null) ? s.toPlainString() : null;
	}

	record Download(int status, String contentType, String disposition, byte[] body) {
	}

	Download download(String path, String token) {
		try {
			HttpRequest.Builder req = HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path)).GET();
			if (token != null) {
				req.header("Authorization", "Bearer " + token);
			}
			HttpResponse<byte[]> res = http.send(req.build(), HttpResponse.BodyHandlers.ofByteArray());
			return new Download(res.statusCode(), res.headers().firstValue("Content-Type").orElse(null),
					res.headers().firstValue("Content-Disposition").orElse(null), res.body());
		}
		catch (IOException | InterruptedException ex) {
			throw new IllegalStateException(ex);
		}
	}

	@Test
	void quotePdf() throws IOException {
		String rm = as(RM1);
		Map<String, Object> body = quoteBody("Q/PDF 1", List.of(
				obj("productId", CONSULTING, "quantity", 3, "description", "ที่ปรึกษาระบบ ฉบับภาษาไทย น้ำ ผู้ใหญ่"),
				obj("productId", MOUSE, "quantity", 2, "discountType", "amount", "discountValue", 80)));
		String id = (String) expect(201, null, "POST", "/api/v1/quotes", rm, body).map().get("id");

		Res draft = expect(409, "CONFLICT", "GET", "/api/v1/quotes/" + id + "/pdf", rm, null);
		assertThat(draft.map()).containsEntry("message", "conflict: cannot export a quote that is draft");
		expect(403, "FORBIDDEN", "GET", "/api/v1/quotes/" + id + "/pdf", as(ADMIN), null);
		expect(404, "NOT_FOUND", "GET", "/api/v1/quotes/" + id + "/pdf", as("rm2@swiftquote.dev"), null);
		expect(404, "NOT_FOUND", "GET", "/api/v1/quotes/" + UNKNOWN_ID + "/pdf", rm, null);
		expect(401, "UNAUTHORIZED", "GET", "/api/v1/quotes/" + id + "/pdf", null, null);

		expect(200, null, "POST", "/api/v1/quotes/" + id + "/submit", rm, null);
		expect(200, null, "POST", "/api/v1/quotes/" + id + "/approve", as(WO), null);
		Download approved = download("/api/v1/quotes/" + id + "/pdf", rm);
		assertThat(approved.status()).isEqualTo(200);
		assertThat(approved.contentType()).isEqualTo("application/pdf");
		assertThat(approved.disposition()).isEqualTo("attachment; filename=\"Q_PDF_1.pdf\"");
		assertThat(new String(approved.body(), 0, 5, java.nio.charset.StandardCharsets.ISO_8859_1)).isEqualTo("%PDF-");

		String link = (String) expect(200, null, "POST", "/api/v1/quotes/" + id + "/send", rm, null).map()
			.get("accessToken");
		// Downloading never marks the quote viewed.
		Download pub = download("/api/v1/public/quotes/" + link + "/pdf", null);
		assertThat(pub.status()).isEqualTo(200);
		assertThat(pub.disposition()).isEqualTo("attachment; filename=\"Q_PDF_1.pdf\"");
		Download customer = download("/api/v1/quotes/" + id + "/pdf", as(ACME_BUYER));
		assertThat(customer.status()).isEqualTo(200);
		assertThat(expect(200, null, "GET", "/api/v1/quotes/" + id, rm, null).map()).containsEntry("status", "sent");
		expect(404, "NOT_FOUND", "GET", "/api/v1/quotes/" + id + "/pdf", as("buyer@globex.example"), null);

		expect(200, null, "POST", "/api/v1/public/quotes/" + link + "/accept", null,
				obj("signerName", "สมชาย ใจดี", "signatureDataUrl", "data:x"));
		Download signed = download("/api/v1/public/quotes/" + link + "/pdf", null);
		assertThat(signed.status()).isEqualTo(200);
		String dir = System.getProperty("swiftquote.pdf-dir");
		if (dir != null) {
			Files.write(Path.of(dir, "quote.pdf"), signed.body());
		}

		Res unknown = expect(404, "NOT_FOUND", "GET", "/api/v1/public/quotes/" + UNKNOWN_ID + "/pdf", null, null);
		assertThat(unknown.map()).containsEntry("message", "not found: quote expired or not found");
		String draftLink = (String) expect(201, null, "POST", "/api/v1/quotes", rm, quoteBody("Q-PDF-DRAFT")).map()
			.get("accessToken");
		expect(404, "NOT_FOUND", "GET", "/api/v1/public/quotes/" + draftLink + "/pdf", null, null);
	}

}
