package com.swiftquote.web.rest;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.QuoteItem;
import com.swiftquote.domain.QuoteStatus;
import com.swiftquote.service.AuthService;
import com.swiftquote.service.ClientService;
import com.swiftquote.service.QuoteService;
import com.swiftquote.web.rest.Dtos.AcceptQuoteRequest;
import com.swiftquote.web.rest.Dtos.AuthResponse;
import com.swiftquote.web.rest.Dtos.AuthUser;
import com.swiftquote.web.rest.Dtos.ClientView;
import com.swiftquote.web.rest.Dtos.CreateQuoteRequest;
import com.swiftquote.web.rest.Dtos.LoginRequest;
import com.swiftquote.web.rest.Dtos.PublicQuoteView;
import com.swiftquote.web.rest.Dtos.QuoteDetail;
import com.swiftquote.web.rest.Dtos.QuoteItemInput;
import com.swiftquote.web.rest.Dtos.QuoteSummary;

/** All /api/v1 endpoints from contracts/openapi.yaml, path for path with the Go service. */
@RestController
@RequestMapping("/api/v1")
class ApiController {

	private static final BigDecimal DEFAULT_TAX_PERCENT = BigDecimal.valueOf(7);

	private final AuthService auth;

	private final ClientService clients;

	private final QuoteService quotes;

	ApiController(AuthService auth, ClientService clients, QuoteService quotes) {
		this.auth = auth;
		this.clients = clients;
		this.quotes = quotes;
	}

	@PostMapping("/auth/login")
	AuthResponse login(@RequestBody LoginRequest req) {
		AuthService.LoginResult res = this.auth.login(req.email(), req.password());
		return new AuthResponse(res.accessToken(), res.login().organizationId(),
				new AuthUser(res.login().userId(), res.login().fullName(), res.login().role()));
	}

	@GetMapping("/clients")
	List<ClientView> listClients(@AuthenticationPrincipal Jwt jwt) {
		return this.clients.list(Tenant.of(jwt)).stream().map(ClientView::of).toList();
	}

	@GetMapping("/quotes")
	List<QuoteSummary> listQuotes(@AuthenticationPrincipal Jwt jwt,
			@RequestParam(name = "status", required = false) String status) {
		QuoteStatus filter = null;
		if (status != null && !status.isEmpty()) {
			filter = QuoteStatus.parse(status)
				.orElseThrow(() -> new ApiException.Validation(
						"status \"%s\" is not a valid QuoteStatus".formatted(status)));
		}
		return this.quotes.list(Tenant.of(jwt), filter).stream().map(QuoteSummary::of).toList();
	}

	@PostMapping("/quotes")
	@ResponseStatus(HttpStatus.CREATED)
	QuoteDetail createQuote(@AuthenticationPrincipal Jwt jwt, @RequestBody CreateQuoteRequest req) {
		List<String> problems = new ArrayList<>();
		if (req.clientId() == null) {
			problems.add("clientId is required");
		}
		if (req.expiryDate() == null) {
			problems.add("expiryDate is required");
		}
		List<QuoteItemInput> inputs = (req.items() != null) ? req.items() : List.of();
		List<QuoteItem> items = new ArrayList<>(inputs.size());
		for (int i = 0; i < inputs.size(); i++) {
			QuoteItemInput in = inputs.get(i);
			if (in.quantity() == null) {
				problems.add("items[%d].quantity is required".formatted(i));
			}
			if (in.unitPrice() == null) {
				problems.add("items[%d].unitPrice is required".formatted(i));
			}
			items.add(new QuoteItem(null, in.title(), in.description(), orElse(in.quantity(), BigDecimal.ZERO),
					orElse(in.unitPrice(), BigDecimal.ZERO), orElse(in.discountPercent(), BigDecimal.ZERO),
					orElse(in.taxPercent(), DEFAULT_TAX_PERCENT), null));
		}
		if (!problems.isEmpty()) {
			throw new ApiException.Validation(problems);
		}
		return QuoteDetail.of(this.quotes.create(new QuoteService.CreateInput(Tenant.of(jwt), req.clientId(),
				req.dealId(), req.quoteNumber(), req.expiryDate(), items)));
	}

	@GetMapping("/quotes/{id}")
	QuoteDetail getQuote(@AuthenticationPrincipal Jwt jwt, @PathVariable String id) {
		return QuoteDetail.of(this.quotes.get(Tenant.of(jwt), uuidOr(id, "not found: quote not found")));
	}

	@GetMapping("/public/quotes/{accessToken}")
	PublicQuoteView getPublicQuote(@PathVariable String accessToken) {
		return PublicQuoteView.of(this.quotes.getPublic(uuidOr(accessToken, "not found: quote expired or not found")));
	}

	@PostMapping("/public/quotes/{accessToken}/accept")
	QuoteDetail acceptPublicQuote(@PathVariable String accessToken, @RequestBody AcceptQuoteRequest req) {
		UUID token = uuidOr(accessToken, "not found: quote expired or not found");
		return QuoteDetail.of(this.quotes.accept(token, req.signerName(), req.signatureDataUrl()));
	}

	/** A malformed id is reported like an unknown one. */
	private static UUID uuidOr(String raw, String notFoundMessage) {
		try {
			return UUID.fromString(raw);
		}
		catch (IllegalArgumentException ex) {
			throw new ApiException.NotFound(notFoundMessage);
		}
	}

	private static BigDecimal orElse(BigDecimal value, BigDecimal fallback) {
		return (value != null) ? value : fallback;
	}

}
