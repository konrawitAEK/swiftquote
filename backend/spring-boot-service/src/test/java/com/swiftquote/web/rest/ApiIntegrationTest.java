package com.swiftquote.web.rest;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import com.swiftquote.TestcontainersConfiguration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end over real HTTP and Postgres. Mirrors backend/go-service/internal/delivery/http/router_test.go so both
 * backends are held to the same behaviour.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = "swiftquote.jwt-secret=test-secret-at-least-32-bytes-long")
@Import(TestcontainersConfiguration.class)
class ApiIntegrationTest {

	static final UUID DEMO_ORG = UUID.fromString("00000000-0000-4000-8000-000000000001");

	static final UUID DEMO_USER = UUID.fromString("00000000-0000-4000-8000-000000000002");

	static final UUID DEMO_CLIENT = UUID.fromString("00000000-0000-4000-8000-000000000003");

	static final JsonMapper json = JsonMapper.builder().build();

	static final HttpClient http = HttpClient.newHttpClient();

	@LocalServerPort
	int port;

	@Autowired
	JdbcClient jdbc;

	record Res(int status, String body) {

		Map<String, Object> map() {
			return json.readValue(this.body, new TypeReference<>() {
			});
		}

		List<Map<String, Object>> list() {
			return json.readValue(this.body, new TypeReference<>() {
			});
		}

	}

	/** Removes everything except the demo seed, like the Go test's resetDB. */
	@BeforeEach
	void resetDb() {
		this.jdbc.sql("DELETE FROM quotes").update();
		this.jdbc.sql("DELETE FROM clients WHERE id <> :id").param("id", DEMO_CLIENT).update();
		this.jdbc.sql("DELETE FROM users WHERE id <> :id").param("id", DEMO_USER).update();
		this.jdbc.sql("DELETE FROM organizations WHERE id <> :id").param("id", DEMO_ORG).update();
	}

	Res call(String method, String path, String token, Object body) {
		try {
			HttpRequest.Builder req = HttpRequest.newBuilder(URI.create("http://localhost:" + this.port + path))
				.header("Content-Type", "application/json")
				.method(method, (body != null) ? HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))
						: HttpRequest.BodyPublishers.noBody());
			if (token != null) {
				req.header("Authorization", "Bearer " + token);
			}
			HttpResponse<String> res = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
			return new Res(res.statusCode(), res.body());
		}
		catch (Exception ex) {
			throw new IllegalStateException(ex);
		}
	}

	String login(String email) {
		Res res = call("POST", "/api/v1/auth/login", null, Map.of("email", email, "password", "password"));
		assertThat(res.status()).as(res.body()).isEqualTo(200);
		return (String) res.map().get("accessToken");
	}

	static String inAMonth() {
		return LocalDate.now(ZoneOffset.UTC).plusMonths(1).toString();
	}

	static Map<String, Object> validQuote(String number) {
		Map<String, Object> body = new HashMap<>();
		body.put("clientId", DEMO_CLIENT.toString());
		body.put("quoteNumber", number);
		body.put("expiryDate", inAMonth());
		body.put("items",
				List.of(Map.of("title", "Consulting", "quantity", 2, "unitPrice", 100, "discountPercent", 10),
						Map.of("title", "Setup fee", "quantity", 1, "unitPrice", 1.5)));
		return body;
	}

	@Test
	void quoteLifecycle() {
		String token = login("demo@swiftquote.dev");

		Res created = call("POST", "/api/v1/quotes", token, validQuote("Q-001"));
		assertThat(created.status()).as(created.body()).isEqualTo(201);
		// Money is rendered with exactly two decimals, as the Go service does.
		assertThat(created.body()).contains("\"subtotal\":201.50", "\"discountAmount\":20.00", "\"taxAmount\":12.71",
				"\"grandTotal\":194.21", "\"signedAt\":null", "\"signedBy\":null", "\"quantity\":2.00");
		Map<String, Object> quote = created.map();
		assertThat(quote).containsEntry("status", "draft").containsEntry("expiryDate", inAMonth());
		String id = (String) quote.get("id");
		String accessToken = (String) quote.get("accessToken");

		Map<String, Object> detail = call("GET", "/api/v1/quotes/" + id, token, null).map();
		assertThat(detail).containsEntry("accessToken", accessToken);
		List<String> titles = ((List<?>) detail.get("items")).stream().map((it) -> (String) ((Map<?, ?>) it).get("title")).toList();
		assertThat(titles).containsExactly("Consulting", "Setup fee");

		List<Map<String, Object>> clients = call("GET", "/api/v1/clients", token, null).list();
		assertThat(clients).singleElement()
			.satisfies((c) -> assertThat(c).containsEntry("name", "Acme Corporation")
				.containsEntry("email", "buyer@acme.example"));

		List<Map<String, Object>> list = call("GET", "/api/v1/quotes", token, null).list();
		assertThat(list).singleElement().satisfies((q) -> assertThat(q).containsEntry("clientName", "Acme Corporation"));

		Res pub = call("GET", "/api/v1/public/quotes/" + accessToken, null, null);
		assertThat(pub.status()).isEqualTo(200);
		assertThat(pub.body()).contains("\"vendorLogo\":null", "\"signedBy\":null");
		assertThat(pub.map()).containsEntry("vendorName", "Demo Co., Ltd.").containsEntry("status", "draft");

		Map<String, String> accept = Map.of("signerName", "Jane Buyer", "signatureDataUrl", "data:image/png;base64,AAAA");
		Res accepted = call("POST", "/api/v1/public/quotes/" + accessToken + "/accept", null, accept);
		assertThat(accepted.status()).as(accepted.body()).isEqualTo(200);
		assertThat(accepted.map()).containsEntry("status", "accepted").containsEntry("signedBy", "Jane Buyer");
		String signedAt = (String) accepted.map().get("signedAt");
		assertThat(OffsetDateTime.parse(signedAt).getOffset()).isEqualTo(ZoneOffset.UTC);

		Res again = call("POST", "/api/v1/public/quotes/" + accessToken + "/accept", null, accept);
		assertThat(again.status()).isEqualTo(409);
		assertThat(again.map()).containsEntry("code", "CONFLICT");

		assertThat(call("GET", "/api/v1/public/quotes/" + accessToken, null, null).map())
			.containsEntry("status", "accepted")
			.containsEntry("signedBy", "Jane Buyer");
	}

	static Stream<Arguments> errorCases() {
		String bad = UUID.randomUUID().toString();
		return Stream.of(
				Arguments.of("wrong password", "POST", "/api/v1/auth/login", false,
						Map.of("email", "demo@swiftquote.dev", "password", "nope"), 401, "UNAUTHORIZED"),
				Arguments.of("unknown email", "POST", "/api/v1/auth/login", false,
						Map.of("email", "x@y.z", "password", "password"), 401, "UNAUTHORIZED"),
				Arguments.of("list without token", "GET", "/api/v1/quotes", false, null, 401, "UNAUTHORIZED"),
				Arguments.of("clients without token", "GET", "/api/v1/clients", false, null, 401, "UNAUTHORIZED"),
				Arguments.of("get quote without token", "GET", "/api/v1/quotes/" + bad, false, null, 401,
						"UNAUTHORIZED"),
				Arguments.of("unknown quote id", "GET", "/api/v1/quotes/" + bad, true, null, 404, "NOT_FOUND"),
				Arguments.of("malformed quote id", "GET", "/api/v1/quotes/not-a-uuid", true, null, 404, "NOT_FOUND"),
				Arguments.of("invalid status filter", "GET", "/api/v1/quotes?status=bogus", true, null, 400,
						"VALIDATION_ERROR"),
				Arguments.of("create without token", "POST", "/api/v1/quotes", false, validQuote("Q-X"), 401,
						"UNAUTHORIZED"),
				Arguments.of("duplicate quote number", "POST", "/api/v1/quotes", true, validQuote("Q-DUP"), 409,
						"CONFLICT"),
				Arguments.of("no items", "POST", "/api/v1/quotes", true, with(validQuote("Q-NEW"), "items", List.of()),
						400, "VALIDATION_ERROR"),
				Arguments.of("missing clientId", "POST", "/api/v1/quotes", true,
						with(validQuote("Q-NEW"), "clientId", null), 400, "VALIDATION_ERROR"),
				Arguments.of("past expiry", "POST", "/api/v1/quotes", true,
						with(validQuote("Q-NEW"), "expiryDate", "2000-01-01"), 400, "VALIDATION_ERROR"),
				Arguments.of("bad date format", "POST", "/api/v1/quotes", true,
						with(validQuote("Q-NEW"), "expiryDate", "01/01/2099"), 400, "VALIDATION_ERROR"),
				Arguments.of("quantity below 1", "POST", "/api/v1/quotes", true,
						with(validQuote("Q-NEW"), "items",
								List.of(Map.of("title", "x", "quantity", 0, "unitPrice", 1))),
						400, "VALIDATION_ERROR"),
				Arguments.of("unknown access token", "GET", "/api/v1/public/quotes/" + bad, false, null, 404,
						"NOT_FOUND"),
				Arguments.of("malformed access token", "GET", "/api/v1/public/quotes/not-a-uuid", false, null, 404,
						"NOT_FOUND"),
				Arguments.of("unknown route", "GET", "/api/v1/nope", false, null, 404, "NOT_FOUND"),
				Arguments.of("accept without signature", "POST", "/api/v1/public/quotes/" + bad + "/accept", false,
						Map.of("signerName", "A"), 400, "VALIDATION_ERROR"));
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("errorCases")
	void errorResponses(String name, String method, String path, boolean authed, Object body, int status,
			String code) {
		String token = login("demo@swiftquote.dev");
		call("POST", "/api/v1/quotes", token, validQuote("Q-DUP"));

		Res res = call(method, path, authed ? token : null, body);

		assertThat(res.status()).as(res.body()).isEqualTo(status);
		assertThat(res.map()).containsEntry("code", code);
		assertThat((String) res.map().get("message")).isNotBlank();
	}

	@Test
	void badBearerTokenIsUnauthorized() {
		Res res = call("GET", "/api/v1/quotes", "garbage", null);
		assertThat(res.status()).isEqualTo(401);
		assertThat(res.map()).containsEntry("code", "UNAUTHORIZED");
	}

	@Test
	void clientOfAnotherTenantIsRejected() {
		UUID otherOrg = insertOrg();
		UUID otherClient = UUID.randomUUID();
		this.jdbc.sql("INSERT INTO clients (id, organization_id, name) VALUES (:id, :org, 'Other client')")
			.param("id", otherClient)
			.param("org", otherOrg)
			.update();

		Res res = call("POST", "/api/v1/quotes", login("demo@swiftquote.dev"),
				with(validQuote("Q-NEW"), "clientId", otherClient.toString()));

		assertThat(res.status()).isEqualTo(400);
		assertThat(res.map()).containsEntry("code", "VALIDATION_ERROR");
	}

	@Test
	void expiredQuoteIsNotFound() {
		UUID token = UUID.randomUUID();
		insertQuote("Q-OLD", "sent", token, LocalDate.now(ZoneOffset.UTC).minusDays(1));

		assertThat(call("GET", "/api/v1/public/quotes/" + token, null, null).status()).isEqualTo(404);
		assertThat(call("POST", "/api/v1/public/quotes/" + token + "/accept", null,
				Map.of("signerName", "A", "signatureDataUrl", "data:x"))
			.status()).isEqualTo(404);
	}

	@Test
	void quotesAreTenantScoped() {
		String id = (String) call("POST", "/api/v1/quotes", login("demo@swiftquote.dev"), validQuote("Q-001")).map()
			.get("id");

		UUID otherOrg = insertOrg();
		UUID otherUser = UUID.randomUUID();
		this.jdbc.sql("""
				INSERT INTO users (id, email, password_hash, full_name)
				SELECT :id, 'other@example.com', password_hash, 'Other' FROM users WHERE id = :demo""")
			.param("id", otherUser)
			.param("demo", DEMO_USER)
			.update();
		this.jdbc.sql("INSERT INTO organization_members (organization_id, user_id, role) VALUES (:org, :user, 'owner')")
			.param("org", otherOrg)
			.param("user", otherUser)
			.update();

		String other = login("other@example.com");
		assertThat(call("GET", "/api/v1/quotes", other, null).list()).isEmpty();
		assertThat(call("GET", "/api/v1/clients", other, null).list()).isEmpty();
		assertThat(call("GET", "/api/v1/quotes/" + id, other, null).status()).isEqualTo(404);
	}

	@Test
	void publicViewMarksSentQuoteViewed() {
		UUID token = UUID.randomUUID();
		UUID id = insertQuote("Q-SENT", "sent", token, LocalDate.now(ZoneOffset.UTC).plusMonths(1));

		call("GET", "/api/v1/public/quotes/" + token, null, null);

		assertThat(this.jdbc.sql("SELECT status FROM quotes WHERE id = :id").param("id", id).query(String.class).single())
			.isEqualTo("viewed");
	}

	UUID insertOrg() {
		UUID id = UUID.randomUUID();
		this.jdbc.sql("INSERT INTO organizations (id, name, slug) VALUES (:id, 'Other', :slug)")
			.param("id", id)
			.param("slug", id.toString())
			.update();
		return id;
	}

	UUID insertQuote(String number, String status, UUID accessToken, LocalDate expiry) {
		UUID id = UUID.randomUUID();
		this.jdbc.sql("""
				INSERT INTO quotes (id, organization_id, client_id, quote_number, status, expiry_date, access_token)
				VALUES (:id, :org, :client, :number, :status, :expiry, :token)""")
			.param("id", id)
			.param("org", DEMO_ORG)
			.param("client", DEMO_CLIENT)
			.param("number", number)
			.param("status", status)
			.param("expiry", expiry)
			.param("token", accessToken)
			.update();
		return id;
	}

	static Map<String, Object> with(Map<String, Object> body, String key, Object value) {
		Map<String, Object> copy = new HashMap<>(body);
		if (value == null) {
			copy.remove(key);
		}
		else {
			copy.put(key, value);
		}
		return copy;
	}

}
