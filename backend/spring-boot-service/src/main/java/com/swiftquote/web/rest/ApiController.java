package com.swiftquote.web.rest;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.GoText;
import com.swiftquote.domain.Quote;
import com.swiftquote.domain.Roles;
import com.swiftquote.domain.Statuses;
import com.swiftquote.repository.AdminRepository.UserInput;
import com.swiftquote.repository.DashboardRepository;
import com.swiftquote.service.AdminService;
import com.swiftquote.service.AuthService;
import com.swiftquote.service.CatalogService;
import com.swiftquote.service.ClientService;
import com.swiftquote.service.DashboardService;
import com.swiftquote.service.ProductService;
import com.swiftquote.service.QuoteService;
import com.swiftquote.web.rest.Dtos.AdminUserView;
import com.swiftquote.web.rest.Dtos.AuthResponse;
import com.swiftquote.web.rest.Dtos.AuthUser;
import com.swiftquote.web.rest.Dtos.CategoryView;
import com.swiftquote.web.rest.Dtos.ClientView;
import com.swiftquote.web.rest.Dtos.DashboardView;
import com.swiftquote.web.rest.Dtos.ProductView;
import com.swiftquote.web.rest.Dtos.PublicQuoteView;
import com.swiftquote.web.rest.Dtos.QuoteDetail;
import com.swiftquote.web.rest.Dtos.QuoteSummary;
import com.swiftquote.web.rest.Dtos.TeamView;

/**
 * All /api/v1 endpoints from contracts/openapi.yaml, route for route with backend/go-service/internal/delivery/http.
 * Error precedence: 401 session (an {@link Actor} parameter is resolved first), 400 malformed JSON (the body is
 * decoded next), then the service's 403 role, 404 visibility, 400 content and 409 state.
 */
@RestController
@RequestMapping("/api/v1")
class ApiController {

	/** A malformed id becomes the nil UUID, which no row has, so it is reported exactly like an unknown id. */
	private static final UUID NIL = new UUID(0, 0);

	private final AuthService auth;

	private final CatalogService catalog;

	private final ClientService clients;

	private final QuoteService quotes;

	private final AdminService admin;

	private final DashboardService dashboard;

	private final ProductService products;

	private final QuotePdf pdf;

	ApiController(AuthService auth, CatalogService catalog, ClientService clients, QuoteService quotes,
			AdminService admin, DashboardService dashboard, ProductService products, QuotePdf pdf) {
		this.products = products;
		this.pdf = pdf;
		this.auth = auth;
		this.catalog = catalog;
		this.clients = clients;
		this.quotes = quotes;
		this.admin = admin;
		this.dashboard = dashboard;
	}

	private static UUID pathId(String raw) {
		UUID id = GoText.parseUuid(raw);
		return (id != null) ? id : NIL;
	}

	@PostMapping("/auth/login")
	AuthResponse login(@RequestBody(required = false) byte[] body) {
		JsonBody req = JsonBody.of(body);
		AuthService.LoginResult res = this.auth.login(req.string("email"), req.string("password"));
		return new AuthResponse(res.accessToken(), res.login().organizationId(),
				new AuthUser(res.login().userId(), res.login().fullName(), res.login().role()));
	}

	@GetMapping("/clients")
	List<ClientView> listClients(Actor actor) {
		return this.clients.list(actor).stream().map(ClientView::of).toList();
	}

	@GetMapping("/categories")
	List<CategoryView> listCategories(Actor actor) {
		return this.catalog.list(actor).stream().map(CategoryView::of).toList();
	}

	@PostMapping("/admin/categories")
	@ResponseStatus(HttpStatus.CREATED)
	CategoryView createCategory(Actor actor, @RequestBody(required = false) byte[] body) {
		JsonBody req = JsonBody.of(body);
		return CategoryView.of(this.catalog.create(actor, req.string("name")));
	}

	@PutMapping("/admin/categories/{id}")
	CategoryView updateCategory(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		JsonBody req = JsonBody.of(body);
		return CategoryView.of(this.catalog.update(actor, pathId(id), req.string("name"), req.bool("active")));
	}

	/** Deletes are POSTs on a /delete sub-resource; the body is never read, so even malformed JSON is accepted. */
	@PostMapping("/admin/categories/{id}/delete")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void deleteCategory(Actor actor, @PathVariable String id) {
		this.catalog.delete(actor, pathId(id));
	}

	@GetMapping("/products")
	List<ProductView> listProducts(Actor actor) {
		return this.products.list(actor).stream().map(ProductView::of).toList();
	}

	@PostMapping("/admin/products")
	@ResponseStatus(HttpStatus.CREATED)
	ProductView createProduct(Actor actor, @RequestBody(required = false) byte[] body) {
		return ProductView.of(this.products.create(actor, productInput(JsonBody.of(body))));
	}

	@PutMapping("/admin/products/{id}")
	ProductView updateProduct(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		return ProductView.of(this.products.update(actor, pathId(id), productInput(JsonBody.of(body))));
	}

	@PostMapping("/admin/products/{id}/delete")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void deleteProduct(Actor actor, @PathVariable String id) {
		this.products.delete(actor, pathId(id));
	}

	private static ProductService.Input productInput(JsonBody req) {
		return new ProductService.Input(req.optString("name"), req.uuid("categoryId"), req.decimal("unitPrice"),
				req.decimal("unitCost"), req.decimal("stock"), req.bool("active"));
	}

	@GetMapping("/quotes")
	List<QuoteSummary> listQuotes(Actor actor, HttpServletRequest request) {
		if (Roles.ADMIN.equals(actor.role())) {
			throw ApiException.roleForbidden();
		}
		String status = null;
		String raw = request.getParameter("status");
		if (raw != null && !raw.isEmpty()) {
			if (!Statuses.valid(raw)) {
				throw ApiException.invalid("status %s is not a valid QuoteStatus".formatted(GoText.quote(raw)));
			}
			status = raw;
		}
		return this.quotes.list(actor, status).stream().map(QuoteSummary::of).toList();
	}

	@PostMapping("/quotes")
	@ResponseStatus(HttpStatus.CREATED)
	QuoteDetail createQuote(Actor actor, @RequestBody(required = false) byte[] body) {
		QuoteService.CreateInput in = createInput(JsonBody.of(body));
		return detail(actor, this.quotes.create(actor, in));
	}

	@GetMapping("/quotes/{id}")
	QuoteDetail getQuote(Actor actor, @PathVariable String id) {
		return detail(actor, this.quotes.get(actor, pathId(id)));
	}

	@PutMapping("/quotes/{id}")
	QuoteDetail updateQuote(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		QuoteService.CreateInput in = createInput(JsonBody.of(body));
		return detail(actor, this.quotes.update(actor, pathId(id), in));
	}

	private static QuoteService.CreateInput createInput(JsonBody req) {
		UUID clientId = req.uuid("clientId");
		UUID dealId = req.uuid("dealId");
		String quoteNumber = req.string("quoteNumber");
		LocalDate expiryDate = req.date("expiryDate");
		List<JsonBody> rawItems = req.array("items");
		List<QuoteService.ItemInput> items = new ArrayList<>();
		if (rawItems != null) {
			for (JsonBody it : rawItems) {
				items.add(new QuoteService.ItemInput(it.uuid("productId"), it.string("description"),
						it.decimal("quantity"), it.decimal("unitPrice"), it.optString("discountType"),
						it.decimal("discountValue"), it.decimal("taxPercent")));
			}
		}
		return new QuoteService.CreateInput(clientId, dealId, quoteNumber, expiryDate, items);
	}

	/** Cost and profit are left out for customers. */
	private static QuoteDetail detail(Actor actor, Quote q) {
		return QuoteDetail.of(q, !Roles.CUSTOMER.equals(actor.role()));
	}

	@GetMapping("/quotes/{id}/pdf")
	ResponseEntity<byte[]> getQuotePdf(Actor actor, @PathVariable String id) {
		return pdf(this.quotes.document(actor, pathId(id)));
	}

	private ResponseEntity<byte[]> pdf(QuoteService.Document doc) {
		byte[] bytes = this.pdf.render(doc.quote(), doc.vendorName());
		return ResponseEntity.ok()
			.contentType(MediaType.APPLICATION_PDF)
			.header(HttpHeaders.CONTENT_DISPOSITION,
					"attachment; filename=\"" + QuotePdf.fileName(doc.quote().quoteNumber()) + ".pdf\"")
			.body(bytes);
	}

	/** An optional {"comment": ...} body; an empty body means no comment. */
	private static String optionalComment(byte[] body) {
		return JsonBody.optional(body).optString("comment");
	}

	@PostMapping("/quotes/{id}/submit")
	QuoteDetail submitQuote(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		String comment = optionalComment(body);
		return detail(actor, this.quotes.submit(actor, pathId(id), comment));
	}

	@PostMapping("/quotes/{id}/approve")
	QuoteDetail approveQuote(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		String comment = optionalComment(body);
		return detail(actor, this.quotes.approve(actor, pathId(id), comment));
	}

	@PostMapping("/quotes/{id}/return")
	QuoteDetail returnQuote(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		String comment = optionalComment(body);
		return detail(actor, this.quotes.returnToDraft(actor, pathId(id), comment));
	}

	@PostMapping("/quotes/{id}/send")
	QuoteDetail sendQuote(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		optionalComment(body);
		return detail(actor, this.quotes.send(actor, pathId(id)));
	}

	@PostMapping("/quotes/{id}/accept")
	QuoteDetail acceptQuote(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		JsonBody req = JsonBody.of(body);
		return detail(actor, this.quotes.accept(actor, pathId(id), req.string("signerName"),
				req.string("signatureDataUrl")));
	}

	@PostMapping("/quotes/{id}/reject")
	QuoteDetail rejectQuote(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		String comment = optionalComment(body);
		return detail(actor, this.quotes.reject(actor, pathId(id), comment));
	}

	@GetMapping("/dashboard/summary")
	DashboardView dashboardSummary(Actor actor, HttpServletRequest request) {
		if (!Roles.WOC.equals(actor.role())) {
			throw ApiException.roleForbidden();
		}
		LocalDate from = dateParam(request, "from");
		LocalDate to = dateParam(request, "to");
		return DashboardView.of(this.dashboard.summary(actor, new DashboardRepository.Range(from, to)));
	}

	private static LocalDate dateParam(HttpServletRequest request, String name) {
		String raw = request.getParameter(name);
		if (raw == null || raw.isEmpty()) {
			return null;
		}
		LocalDate d = JsonBody.parseDate(raw);
		if (d == null) {
			throw ApiException.invalid(name + " must be a date (YYYY-MM-DD)");
		}
		return d;
	}

	@GetMapping("/admin/users")
	List<AdminUserView> listUsers(Actor actor) {
		return this.admin.listUsers(actor).stream().map(AdminUserView::of).toList();
	}

	@PostMapping("/admin/users")
	@ResponseStatus(HttpStatus.CREATED)
	AdminUserView createUser(Actor actor, @RequestBody(required = false) byte[] body) {
		JsonBody req = JsonBody.of(body);
		UserInput in = new UserInput(req.string("email"), req.string("name"), req.optString("password"),
				req.string("role"), null, req.uuid("teamId"), req.uuid("clientId"));
		return AdminUserView.of(this.admin.createUser(actor, in));
	}

	@PutMapping("/admin/users/{id}")
	AdminUserView updateUser(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		JsonBody req = JsonBody.of(body);
		UserInput in = new UserInput("", req.string("name"), req.optString("password"), req.string("role"),
				req.bool("active"), req.uuid("teamId"), req.uuid("clientId"));
		return AdminUserView.of(this.admin.updateUser(actor, pathId(id), in));
	}

	@PostMapping("/admin/users/{id}/delete")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void deleteUser(Actor actor, @PathVariable String id) {
		this.admin.deleteUser(actor, pathId(id));
	}

	@GetMapping("/admin/teams")
	List<TeamView> listTeams(Actor actor) {
		return this.admin.listTeams(actor).stream().map(TeamView::of).toList();
	}

	@PostMapping("/admin/teams")
	@ResponseStatus(HttpStatus.CREATED)
	TeamView createTeam(Actor actor, @RequestBody(required = false) byte[] body) {
		JsonBody req = JsonBody.of(body);
		return TeamView.of(this.admin.createTeam(actor, req.string("name"), req.uuid("woUserId")));
	}

	@PutMapping("/admin/teams/{id}")
	TeamView updateTeam(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
		JsonBody req = JsonBody.of(body);
		return TeamView.of(this.admin.updateTeam(actor, pathId(id), req.string("name"), req.uuid("woUserId")));
	}

	@PostMapping("/admin/teams/{id}/delete")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void deleteTeam(Actor actor, @PathVariable String id) {
		this.admin.deleteTeam(actor, pathId(id));
	}

	@GetMapping("/public/quotes/{accessToken}")
	PublicQuoteView getPublicQuote(@PathVariable String accessToken) {
		return PublicQuoteView.of(this.quotes.getPublic(pathId(accessToken)));
	}

	@GetMapping("/public/quotes/{accessToken}/pdf")
	ResponseEntity<byte[]> getPublicQuotePdf(@PathVariable String accessToken) {
		return pdf(this.quotes.publicDocument(pathId(accessToken)));
	}

	@PostMapping("/public/quotes/{accessToken}/accept")
	QuoteDetail acceptPublicQuote(@PathVariable String accessToken, @RequestBody(required = false) byte[] body) {
		JsonBody req = JsonBody.of(body);
		return QuoteDetail.of(this.quotes.acceptPublic(pathId(accessToken), req.string("signerName"),
				req.string("signatureDataUrl")), false);
	}

	@PostMapping("/public/quotes/{accessToken}/reject")
	QuoteDetail rejectPublicQuote(@PathVariable String accessToken, @RequestBody(required = false) byte[] body) {
		String comment = optionalComment(body);
		return QuoteDetail.of(this.quotes.rejectPublic(pathId(accessToken), comment), false);
	}

}
