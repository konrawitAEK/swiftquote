package com.swiftquote.service;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

/** Runs the cross-backend pricing cases that the Go service and the React preview also pass. */
class PricingTest {

	record FixtureItem(String quantity, String unitPrice, String discountPercent, String taxPercent) {
	}

	record Expected(List<String> lineTotals, String subtotal, String discountAmount, String taxAmount,
			String grandTotal) {
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
			.map((fi) -> item(fi.quantity(), fi.unitPrice(), fi.discountPercent(), fi.taxPercent()))
			.toList();

		Pricing.Result got = Pricing.calculate(items);

		assertThat(got.lineTotals().stream().map(BigDecimal::toPlainString)).containsExactlyElementsOf(
				tc.expected().lineTotals());
		assertThat(got.subtotal().toPlainString()).isEqualTo(tc.expected().subtotal());
		assertThat(got.discountAmount().toPlainString()).isEqualTo(tc.expected().discountAmount());
		assertThat(got.taxAmount().toPlainString()).isEqualTo(tc.expected().taxAmount());
		assertThat(got.grandTotal().toPlainString()).isEqualTo(tc.expected().grandTotal());
	}

	@Test
	void rejectsInvalidItems() {
		List<Executable> invalid = List.of(() -> Pricing.calculate(List.of(item("0.5", "10", "0", "7"))),
				() -> Pricing.calculate(List.of(item("1", "-1", "0", "7"))),
				() -> Pricing.calculate(List.of(item("1", "10", "101", "7"))),
				() -> Pricing.calculate(List.of(item("1", "10", "-1", "7"))),
				() -> Pricing.calculate(List.of(item("1", "10", "0", "101"))));
		for (Executable call : invalid) {
			assertThatIllegalArgumentException().isThrownBy(call::execute).withMessageStartingWith("items[0]: ");
		}
		assertThatIllegalArgumentException().isThrownBy(() -> Pricing.calculate(List.of()))
			.withMessage(Pricing.NO_ITEMS);
	}

	private static Pricing.Line item(String qty, String price, String discount, String tax) {
		return new Pricing.Line(new BigDecimal(qty), new BigDecimal(price), new BigDecimal(discount),
				new BigDecimal(tax));
	}

}
