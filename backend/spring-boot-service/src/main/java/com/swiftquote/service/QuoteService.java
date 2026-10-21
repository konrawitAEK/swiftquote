package com.swiftquote.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.Quote;
import com.swiftquote.domain.QuoteItem;
import com.swiftquote.domain.QuoteStatus;
import com.swiftquote.repository.ClientRepository;
import com.swiftquote.repository.QuoteRepository;

/** Quotation use cases; rules and messages mirror backend/go-service/internal/quote/service.go. */
@Service
public class QuoteService {

	private final QuoteRepository quotes;

	private final ClientRepository clients;

	private final Clock clock;

	public QuoteService(QuoteRepository quotes, ClientRepository clients, Clock clock) {
		this.quotes = quotes;
		this.clients = clients;
		this.clock = clock;
	}

	public record CreateInput(UUID organizationId, UUID clientId, UUID dealId, String quoteNumber,
			LocalDate expiryDate, List<QuoteItem> items) {
	}

	public Quote create(CreateInput in) {
		List<String> problems = new ArrayList<>();
		String number = (in.quoteNumber() != null) ? in.quoteNumber().strip() : "";
		if (number.isEmpty()) {
			problems.add("quoteNumber is required");
		}
		if (in.expiryDate().isBefore(today())) {
			problems.add("expiryDate must not be in the past");
		}
		for (int i = 0; i < in.items().size(); i++) {
			String title = in.items().get(i).title();
			if (title == null || title.isBlank()) {
				problems.add("items[%d].title is required".formatted(i));
			}
		}
		Pricing.Result priced = null;
		try {
			priced = Pricing.calculate(in.items());
		}
		catch (IllegalArgumentException ex) {
			problems.add(ex.getMessage());
		}
		if (!problems.isEmpty()) {
			throw new ApiException.Validation(problems);
		}
		if (!this.clients.belongsTo(in.organizationId(), in.clientId())) {
			throw new ApiException.Validation("clientId does not exist");
		}

		List<QuoteItem> items = new ArrayList<>(in.items().size());
		for (int i = 0; i < in.items().size(); i++) {
			items.add(in.items().get(i).withIdAndLineTotal(UUID.randomUUID(), priced.lineTotals().get(i)));
		}
		Quote q = new Quote(UUID.randomUUID(), in.organizationId(), in.clientId(), in.dealId(), number,
				QuoteStatus.DRAFT, in.expiryDate(), priced.subtotal(), priced.discountAmount(), priced.taxAmount(),
				priced.grandTotal(), UUID.randomUUID(), null, null, null, this.clock.instant(), List.copyOf(items));
		this.quotes.create(q);
		return q;
	}

	public List<QuoteRepository.Summary> list(UUID orgId, QuoteStatus status) {
		return this.quotes.list(orgId, status);
	}

	public Quote get(UUID orgId, UUID id) {
		return this.quotes.get(orgId, id).orElseThrow(() -> new ApiException.NotFound("not found: quote not found"));
	}

	/** Expired quotes are reported as not found, and a sent quote is marked viewed on first open. */
	public QuoteRepository.PublicView getPublic(UUID accessToken) {
		QuoteRepository.PublicView v = this.quotes.getPublic(accessToken)
			.filter((pv) -> !isExpired(pv.quote()))
			.orElseThrow(QuoteService::expiredOrNotFound);
		if (v.quote().status() == QuoteStatus.SENT) {
			this.quotes.updateStatus(v.quote().id(), QuoteStatus.VIEWED, List.of(QuoteStatus.SENT));
		}
		return v;
	}

	public Quote accept(UUID accessToken, String signerName, String signatureData) {
		List<String> problems = new ArrayList<>();
		String signer = (signerName != null) ? signerName.strip() : "";
		if (signer.isEmpty()) {
			problems.add("signerName is required");
		}
		if (signatureData == null || signatureData.isBlank()) {
			problems.add("signatureDataUrl is required");
		}
		if (!problems.isEmpty()) {
			throw new ApiException.Validation(problems);
		}

		Quote current = this.quotes.getPublic(accessToken)
			.map(QuoteRepository.PublicView::quote)
			.filter((q) -> !isExpired(q))
			.orElseThrow(QuoteService::expiredOrNotFound);
		return this.quotes.accept(current.id(), signer, signatureData, this.clock.instant())
			.orElseThrow(() -> new ApiException.Conflict("conflict: quote is %s and can no longer be accepted"
				.formatted(current.status().value())));
	}

	private LocalDate today() {
		return LocalDate.now(this.clock.withZone(ZoneOffset.UTC));
	}

	/** expiryDate is the last valid day. */
	private boolean isExpired(Quote q) {
		return q.status() == QuoteStatus.EXPIRED || q.expiryDate().isBefore(today());
	}

	private static ApiException.NotFound expiredOrNotFound() {
		return new ApiException.NotFound("not found: quote expired or not found");
	}

}
