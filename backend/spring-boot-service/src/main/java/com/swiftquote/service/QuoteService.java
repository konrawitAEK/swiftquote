package com.swiftquote.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.DiscountTypes;
import com.swiftquote.domain.GoText;
import com.swiftquote.domain.Quote;
import com.swiftquote.domain.Product;
import com.swiftquote.domain.QuoteEvent;
import com.swiftquote.domain.QuoteItem;
import com.swiftquote.domain.Ref;
import com.swiftquote.domain.Roles;
import com.swiftquote.domain.Statuses;
import com.swiftquote.repository.AuthRepository;
import com.swiftquote.repository.ProductRepository;
import com.swiftquote.repository.QuoteRepository;
import com.swiftquote.repository.QuoteRepository.NewEvent;
import com.swiftquote.repository.QuoteRepository.PublicView;
import com.swiftquote.repository.QuoteRepository.StateConflictException;
import com.swiftquote.repository.QuoteRepository.StockShortageException;
import com.swiftquote.repository.QuoteRepository.Summary;

/**
 * Quotation use cases; rules and messages mirror backend/go-service/internal/quote/service.go. Check order for every
 * action: 403 role, 404 visibility, 400 input, 409 state.
 */
@Service
public class QuoteService {

	private static final BigDecimal DEFAULT_TAX_PERCENT = BigDecimal.valueOf(7);

	private final QuoteRepository quotes;

	private final ProductRepository products;

	private final AuthRepository clients;

	private final Clock clock;

	public QuoteService(QuoteRepository quotes, ProductRepository products, AuthRepository clients, Clock clock) {
		this.quotes = quotes;
		this.products = products;
		this.clients = clients;
		this.clock = clock;
	}

	/** A create/update payload as decoded; null means the field was absent. */
	public record CreateInput(UUID clientId, UUID dealId, String quoteNumber, LocalDate expiryDate,
			List<ItemInput> items) {
	}

	/** discountType is null when absent; unitPrice null means the product's price. */
	public record ItemInput(UUID productId, String description, BigDecimal quantity, BigDecimal unitPrice,
			String discountType, BigDecimal discountValue, BigDecimal taxPercent) {
	}

	/** A quote to render as a PDF, with the tenant's name as the vendor. */
	public record Document(Quote quote, String vendorName) {
	}

	/** The states a quote can be exported in. */
	private static final List<String> EXPORTABLE = List.of(Statuses.APPROVED, Statuses.SENT, Statuses.VIEWED,
			Statuses.ACCEPTED, Statuses.REJECTED);

	private record Validated(UUID clientId, UUID dealId, String quoteNumber, LocalDate expiryDate,
			List<QuoteItem> items, Pricing.Result totals) {
	}

	private static ApiException notFound() {
		return ApiException.notFound("quote not found");
	}

	private static ApiException publicNotFound() {
		return ApiException.notFound("quote expired or not found");
	}

	private static ApiException stateConflict(String verb, String status) {
		return ApiException.conflict("cannot %s a quote that is %s".formatted(verb, status));
	}

	public Quote create(Actor a, CreateInput in) {
		if (!Roles.RM.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Validated v = validate(a.tenantId(), in);
		UUID id = UUID.randomUUID();
		Quote q = new Quote(id, a.tenantId(), v.clientId(), null, v.dealId(), v.quoteNumber(), Statuses.DRAFT,
				v.expiryDate(), v.totals().subtotal(), v.totals().discountAmount(), v.totals().taxAmount(),
				v.totals().grandTotal(), UUID.randomUUID(), null, null, null, new Ref(a.userId(), a.name()), null,
				this.clock.instant(), v.items(), List.of());
		try {
			this.quotes.create(q, event(Statuses.EV_CREATED, a.userId(), null));
		}
		catch (QuoteRepository.DuplicateNumberException ex) {
			throw duplicate(q.quoteNumber());
		}
		return get(a, id);
	}

	public Quote update(Actor a, UUID id, CreateInput in) {
		if (!Roles.RM.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Quote current = visible(a, id);
		Validated v = validate(a.tenantId(), in);
		if (!Statuses.DRAFT.equals(current.status())) {
			throw stateConflict("edit", current.status());
		}
		Quote q = new Quote(current.id(), current.organizationId(), v.clientId(), current.clientName(), v.dealId(),
				v.quoteNumber(), current.status(), v.expiryDate(), v.totals().subtotal(), v.totals().discountAmount(),
				v.totals().taxAmount(), v.totals().grandTotal(), current.accessToken(), current.signedBy(),
				current.signatureData(), current.signedAt(), current.createdBy(), current.creatorTeamWo(),
				current.createdAt(), v.items(), current.history());
		try {
			this.quotes.replace(q, event(Statuses.EV_UPDATED, a.userId(), null));
		}
		catch (StateConflictException ex) {
			throw raced(a.tenantId(), id, "edit");
		}
		catch (QuoteRepository.DuplicateNumberException ex) {
			throw duplicate(v.quoteNumber());
		}
		return get(a, id);
	}

	/**
	 * Checks a create/update payload in two passes (required fields and shapes, then values), resolves each line's
	 * product, prices the items and checks the client exists.
	 */
	private Validated validate(UUID orgId, CreateInput in) {
		ApiException.Problems problems = new ApiException.Problems();
		if (in.clientId() == null) {
			problems.add("clientId is required");
		}
		if (in.expiryDate() == null) {
			problems.add("expiryDate is required");
		}
		List<ItemInput> inputs = (in.items() != null) ? in.items() : List.of();
		for (int i = 0; i < inputs.size(); i++) {
			ItemInput it = inputs.get(i);
			if (it.productId() == null) {
				problems.add("items[%d].productId is required".formatted(i));
			}
			if (it.quantity() == null) {
				problems.add("items[%d].quantity is required".formatted(i));
			}
			if (it.discountType() != null && !DiscountTypes.valid(it.discountType())) {
				problems.add("items[%d].discountType %s is not a valid DiscountType".formatted(i,
						GoText.quote(it.discountType())));
			}
		}
		problems.throwIfAny();

		String number = GoText.trim(in.quoteNumber());
		if (number.isEmpty()) {
			problems.add("quoteNumber is required");
		}
		if (in.expiryDate().isBefore(today())) {
			problems.add("expiryDate must not be in the past");
		}
		Map<UUID, Product> products = this.products.byIds(orgId,
				inputs.stream().map(ItemInput::productId).collect(Collectors.toSet()));
		boolean productsOk = true;
		for (int i = 0; i < inputs.size(); i++) {
			Product p = products.get(inputs.get(i).productId());
			if (p == null || !p.active()) {
				problems.add("items[%d].productId is not an active product".formatted(i));
				productsOk = false;
			}
		}
		// Pricing needs every line's product (its default price and cost).
		List<Pricing.Line> lines = new ArrayList<>(inputs.size());
		Pricing.Result totals = null;
		if (productsOk) {
			for (ItemInput it : inputs) {
				Product p = products.get(it.productId());
				lines.add(new Pricing.Line(it.quantity(), orElse(it.unitPrice(), p.unitPrice()), discountType(it),
						orElse(it.discountValue(), BigDecimal.ZERO), orElse(it.taxPercent(), DEFAULT_TAX_PERCENT),
						p.unitCost()));
			}
			try {
				totals = Pricing.calculate(lines);
			}
			catch (IllegalArgumentException ex) {
				problems.add(ex.getMessage());
			}
		}
		problems.throwIfAny();
		if (!this.clients.clientExists(orgId, in.clientId())) {
			throw ApiException.invalid("clientId does not exist");
		}
		List<QuoteItem> items = new ArrayList<>(inputs.size());
		for (int i = 0; i < inputs.size(); i++) {
			ItemInput it = inputs.get(i);
			Product p = products.get(it.productId());
			Pricing.Line line = lines.get(i);
			Pricing.LineResult priced = totals.lines().get(i);
			items.add(new QuoteItem(UUID.randomUUID(), new Ref(p.id(), p.name()), p.name(), p.category(),
					it.description(), line.quantity(), line.unitPrice(), line.discountType(), line.discountValue(),
					priced.discount(), line.taxPercent(), priced.lineTotal(), p.unitCost()));
		}
		return new Validated(in.clientId(), in.dealId(), number, in.expiryDate(), items, totals);
	}

	private static String discountType(ItemInput it) {
		return (it.discountType() != null) ? it.discountType() : DiscountTypes.PERCENT;
	}

	private static BigDecimal orElse(BigDecimal value, BigDecimal fallback) {
		return (value != null) ? value : fallback;
	}

	public List<Summary> list(Actor a, String status) {
		UUID createdBy = null;
		UUID teamWo = null;
		UUID clientId = null;
		List<String> statuses = null;
		switch (a.role()) {
			case Roles.RM -> createdBy = a.userId();
			case Roles.WO -> teamWo = a.userId();
			case Roles.WOC -> {
			}
			case Roles.CUSTOMER -> {
				if (a.clientId() == null) {
					return List.of();
				}
				clientId = a.clientId();
				statuses = Statuses.CUSTOMER;
			}
			default -> throw ApiException.roleForbidden();
		}
		return this.quotes.list(new QuoteRepository.ListFilter(a.tenantId(), status, createdBy, teamWo, clientId,
				statuses));
	}

	/** A visible quote. A customer opening a sent quote marks it viewed. */
	public Quote get(Actor a, UUID id) {
		if (Roles.ADMIN.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Quote q = visible(a, id);
		if (Roles.CUSTOMER.equals(a.role()) && Statuses.SENT.equals(q.status())) {
			markViewed(q.id(), a.userId());
			q = this.quotes.get(a.tenantId(), id).orElseThrow(QuoteService::notFound);
		}
		return forActor(a, q);
	}

	public Quote submit(Actor a, UUID id, String comment) {
		if (!Roles.RM.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Quote q = visible(a, id);
		if (!Statuses.DRAFT.equals(q.status())) {
			throw stateConflict("submit", q.status());
		}
		if (q.creatorTeamWo() == null) {
			throw ApiException.conflict("you must be in a team led by a WO to submit");
		}
		checkStock(q.id());
		return transition(a, q, "submit", List.of(Statuses.DRAFT), Statuses.PENDING_APPROVAL, Statuses.EV_SUBMITTED,
				comment);
	}

	public Quote approve(Actor a, UUID id, String comment) {
		if (!Roles.WO.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Quote q = visible(a, id);
		return transition(a, q, "approve", List.of(Statuses.PENDING_APPROVAL), Statuses.APPROVED,
				Statuses.EV_APPROVED, comment);
	}

	public Quote returnToDraft(Actor a, UUID id, String comment) {
		if (!Roles.WO.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Quote q = visible(a, id);
		if (trimmed(comment) == null) {
			throw ApiException.invalid("comment is required");
		}
		return transition(a, q, "return", List.of(Statuses.PENDING_APPROVAL), Statuses.DRAFT, Statuses.EV_RETURNED,
				comment);
	}

	public Quote send(Actor a, UUID id) {
		if (!Roles.RM.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Quote q = visible(a, id);
		if (!Statuses.APPROVED.equals(q.status())) {
			throw stateConflict("send", q.status());
		}
		if (isExpired(q)) {
			throw ApiException.conflict("quote has expired");
		}
		checkStock(q.id());
		return transition(a, q, "send", List.of(Statuses.APPROVED), Statuses.SENT, Statuses.EV_SENT, null);
	}

	public Quote accept(Actor a, UUID id, String signerName, String signatureData) {
		if (!Roles.CUSTOMER.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Quote q = visible(a, id);
		String signer = validateSignature(signerName, signatureData);
		respondable(q, "accept");
		try {
			this.quotes.accept(q.id(), Statuses.RESPONDABLE, signer, signatureData,
					event(Statuses.EV_ACCEPTED, a.userId(), null));
		}
		catch (StateConflictException ex) {
			throw raced(a.tenantId(), q.id(), "accept");
		}
		catch (StockShortageException ex) {
			throw shortage(ex);
		}
		return get(a, id);
	}

	public Quote reject(Actor a, UUID id, String comment) {
		if (!Roles.CUSTOMER.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Quote q = visible(a, id);
		respondable(q, "reject");
		return transition(a, q, "reject", Statuses.RESPONDABLE, Statuses.REJECTED, Statuses.EV_REJECTED, comment);
	}

	/** A sent, unexpired quote by share link; marks it viewed on first open. */
	public PublicView getPublic(UUID accessToken) {
		PublicView v = publicQuote(accessToken);
		if (Statuses.SENT.equals(v.quote().status())) {
			markViewed(v.quote().id(), null);
			return publicQuote(accessToken);
		}
		return v;
	}

	public Quote acceptPublic(UUID accessToken, String signerName, String signatureData) {
		String signer = validateSignature(signerName, signatureData);
		PublicView v = publicQuote(accessToken);
		if (!Statuses.RESPONDABLE.contains(v.quote().status())) {
			throw stateConflict("accept", v.quote().status());
		}
		try {
			this.quotes.accept(v.quote().id(), Statuses.RESPONDABLE, signer, signatureData,
					event(Statuses.EV_ACCEPTED, null, null));
		}
		catch (StateConflictException ex) {
			throw raced(v.quote().organizationId(), v.quote().id(), "accept");
		}
		catch (StockShortageException ex) {
			throw shortage(ex);
		}
		return customerView(v.quote());
	}

	public Quote rejectPublic(UUID accessToken, String comment) {
		PublicView v = publicQuote(accessToken);
		if (!Statuses.RESPONDABLE.contains(v.quote().status())) {
			throw stateConflict("reject", v.quote().status());
		}
		try {
			this.quotes.transition(v.quote().id(), Statuses.RESPONDABLE, Statuses.REJECTED,
					event(Statuses.EV_REJECTED, null, comment));
		}
		catch (StateConflictException ex) {
			throw raced(v.quote().organizationId(), v.quote().id(), "reject");
		}
		return customerView(v.quote());
	}

	/** A visible quote to export; never marks it viewed. */
	public Document document(Actor a, UUID id) {
		if (Roles.ADMIN.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		Quote q = visible(a, id);
		if (!EXPORTABLE.contains(q.status())) {
			throw stateConflict("export", q.status());
		}
		return new Document(q, this.quotes.organizationName(q.organizationId()));
	}

	/** A quote to export by share link; same reachability as {@link #getPublic} but never marks it viewed. */
	public Document publicDocument(UUID accessToken) {
		PublicView v = publicQuote(accessToken);
		return new Document(v.quote(), v.vendorName());
	}

	/** 409 when a tracked product has less stock than the quote's total quantity of it. */
	private void checkStock(UUID quoteId) {
		this.quotes.stockShortage(quoteId).ifPresent((ex) -> {
			throw shortage(ex);
		});
	}

	private static ApiException shortage(StockShortageException ex) {
		return ApiException.conflict("not enough stock for %s (available %s)".formatted(ex.productName(),
				ex.available().setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()));
	}

	/** Loads a quote and hides it (404) unless the actor's role lets them see it. */
	private Quote visible(Actor a, UUID id) {
		Quote q = this.quotes.get(a.tenantId(), id).orElseThrow(QuoteService::notFound);
		if (!canView(a, q)) {
			throw notFound();
		}
		return q;
	}

	private static boolean canView(Actor a, Quote q) {
		return switch (a.role()) {
			case Roles.RM -> q.createdBy() != null && q.createdBy().id().equals(a.userId());
			case Roles.WO -> q.creatorTeamWo() != null && q.creatorTeamWo().equals(a.userId());
			case Roles.WOC -> true;
			case Roles.CUSTOMER -> a.clientId() != null && a.clientId().equals(q.clientId())
					&& Statuses.CUSTOMER.contains(q.status());
			default -> false;
		};
	}

	/** Hides internal history from customers. */
	private static Quote forActor(Actor a, Quote q) {
		return Roles.CUSTOMER.equals(a.role()) ? q.withHistory(customerHistory(q.history())) : q;
	}

	private static List<QuoteEvent> customerHistory(List<QuoteEvent> events) {
		return events.stream().filter((e) -> Statuses.CUSTOMER_EVENTS.contains(e.action())).toList();
	}

	private Quote transition(Actor a, Quote q, String verb, List<String> from, String to, String action,
			String comment) {
		if (!from.contains(q.status())) {
			throw stateConflict(verb, q.status());
		}
		try {
			this.quotes.transition(q.id(), from, to, event(action, a.userId(), comment));
		}
		catch (StateConflictException ex) {
			throw raced(a.tenantId(), q.id(), verb);
		}
		return get(a, q.id());
	}

	/** Turns a lost conditional update into the same conflict message the pre-check would have given. */
	private ApiException raced(UUID orgId, UUID id, String verb) {
		Quote q = this.quotes.get(orgId, id).orElseThrow(() -> new IllegalStateException("quote vanished: " + id));
		return stateConflict(verb, q.status());
	}

	private void respondable(Quote q, String verb) {
		if (isExpired(q)) {
			throw ApiException.conflict("quote has expired");
		}
		if (!Statuses.RESPONDABLE.contains(q.status())) {
			throw stateConflict(verb, q.status());
		}
	}

	private void markViewed(UUID id, UUID actor) {
		try {
			this.quotes.transition(id, List.of(Statuses.SENT), Statuses.VIEWED, event(Statuses.EV_VIEWED, actor, null));
		}
		catch (StateConflictException ex) {
			// someone else already moved it on
		}
	}

	/** Resolves a share link; drafts, unsent, expired and unknown quotes are all "not found". */
	private PublicView publicQuote(UUID accessToken) {
		PublicView v = this.quotes.getByAccessToken(accessToken).orElseThrow(QuoteService::publicNotFound);
		if (!Statuses.CUSTOMER.contains(v.quote().status()) || isExpired(v.quote())) {
			throw publicNotFound();
		}
		return v;
	}

	private Quote customerView(Quote q) {
		Quote fresh = this.quotes.get(q.organizationId(), q.id())
			.orElseThrow(() -> new IllegalStateException("quote vanished: " + q.id()));
		return fresh.withHistory(customerHistory(fresh.history()));
	}

	private NewEvent event(String action, UUID actor, String comment) {
		return new NewEvent(action, actor, trimmed(comment), this.clock.instant());
	}

	private LocalDate today() {
		return LocalDate.ofInstant(this.clock.instant(), ZoneOffset.UTC);
	}

	/** expiryDate is the last valid day. */
	private boolean isExpired(Quote q) {
		return Statuses.EXPIRED.equals(q.status()) || q.expiryDate().isBefore(today());
	}

	private static String validateSignature(String signerName, String signatureData) {
		ApiException.Problems problems = new ApiException.Problems();
		String signer = GoText.trim(signerName);
		if (signer.isEmpty()) {
			problems.add("signerName is required");
		}
		if (GoText.trim(signatureData).isEmpty()) {
			problems.add("signatureDataUrl is required");
		}
		problems.throwIfAny();
		return signer;
	}

	private static ApiException duplicate(String number) {
		return ApiException.conflict("quoteNumber %s already exists".formatted(GoText.quote(number)));
	}

	/** Null for a missing or blank comment. */
	static String trimmed(String s) {
		if (s == null) {
			return null;
		}
		String t = GoText.trim(s);
		return t.isEmpty() ? null : t;
	}

}
