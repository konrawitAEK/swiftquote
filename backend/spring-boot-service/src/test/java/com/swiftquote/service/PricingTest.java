package com.swiftquote.service;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

/** Runs the cross-backend pricing cases that the Go service and the React preview also pass. */
class PricingTest {

	record FixtureItem(String quantity, String unitPrice, String unitCost, String discountType,
			String discountValue, String taxPercent) {
	}

	record Expected(List<String> lineTotals, String subtotal, String discountAmount, String taxAmount,
			String grandTotal, String costTotal, String profit) {
	}

	record Case(String name, List<FixtureItem> items, Expected expected) {

		@Override
		public String toString() {
			return this.name;
		}

	}

	record Fixtures(List<Case> cases) {
	}

	static Stream<Case> sharedFixtures() {
		Fixtures fx = JsonMapper.builder()
			.build()
			.readValue(Path.of("../../contracts/fixtures/pricing-cases.json").toFile(), Fixtures.class);
		assertThat(fx.cases()).isNotEmpty();
		return fx.cases().stream();
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("sharedFixtures")
	void matchesSharedFixtures(Case tc) {
		List<Pricing.Line> items = tc.items()
			.stream()
			.map((fi) -> new Pricing.Line(new BigDecimal(fi.quantity()), new BigDecimal(fi.unitPrice()),
					(fi.discountType() != null) ? fi.discountType() : "percent",
					new BigDecimal((fi.discountValue() != null) ? fi.discountValue() : "0"),
					new BigDecimal(fi.taxPercent()), (fi.unitCost() != null) ? new BigDecimal(fi.unitCost()) : null))
			.toList();

		Pricing.Result got = Pricing.calculate(items);

		assertThat(got.lineTotals().stream().map(BigDecimal::toPlainString)).containsExactlyElementsOf(
				tc.expected().lineTotals());
		assertThat(got.subtotal().toPlainString()).isEqualTo(tc.expected().subtotal());
		assertThat(got.discountAmount().toPlainString()).isEqualTo(tc.expected().discountAmount());
		assertThat(got.taxAmount().toPlainString()).isEqualTo(tc.expected().taxAmount());
		assertThat(got.grandTotal().toPlainString()).isEqualTo(tc.expected().grandTotal());
		if (tc.expected().costTotal() != null) {
			assertThat(got.costTotal().toPlainString()).isEqualTo(tc.expected().costTotal());
			assertThat(got.profit().toPlainString()).isEqualTo(tc.expected().profit());
		}
		if (tc.items().stream().anyMatch((fi) -> fi.unitCost() == null)) {
			assertThat(got.costTotal()).isNull();
			assertThat(got.profit()).isNull();
		}
	}

	@Test
	void rejectsInvalidItems() {
		Map<String, Pricing.Line> invalid = new LinkedHashMap<>();
		invalid.put("quantity must be at least 1", item("0.5", "10", "percent", "0", "7"));
		invalid.put("unitPrice must not be negative", item("1", "-1", "percent", "0", "7"));
		invalid.put("discountValue must be between 0 and 100", item("1", "10", "percent", "101", "7"));
		invalid.put("discountValue must not be negative", item("1", "10", "percent", "-1", "7"));
		invalid.put("discountValue must not exceed the line amount", item("2", "50", "amount", "100.005", "7"));
		invalid.put("taxPercent must be between 0 and 100", item("1", "10", "percent", "0", "101"));
		invalid.forEach((message, line) -> assertThatIllegalArgumentException()
			.isThrownBy(() -> Pricing.calculate(List.of(item("1", "1", "percent", "0", "7"), line)))
			.withMessage("items[1]: " + message));
		// An amount equal to the line after rounding is allowed; 100.004 rounds to 100.00.
		assertThat(Pricing.calculate(List.of(item("2", "50", "amount", "100.004", "7"))).grandTotal().toPlainString())
			.isEqualTo("0.00");
		assertThatIllegalArgumentException().isThrownBy(() -> Pricing.calculate(List.of()))
			.withMessage(Pricing.NO_ITEMS);
	}

	private static Pricing.Line item(String qty, String price, String discountType, String discount, String tax) {
		return new Pricing.Line(new BigDecimal(qty), new BigDecimal(price), discountType, new BigDecimal(discount),
				new BigDecimal(tax), null);
	}

}
