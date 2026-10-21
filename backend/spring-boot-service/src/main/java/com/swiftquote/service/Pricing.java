package com.swiftquote.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * Quote pricing, identical to backend/go-service/internal/quote/pricing.go and pinned by
 * contracts/fixtures/pricing-cases.json. Change all backends together.
 */
public final class Pricing {

	private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

	private static final int MONEY_SCALE = 2;

	public static final String NO_ITEMS = "quote must have at least one item";

	private Pricing() {
	}

	public record Line(BigDecimal quantity, BigDecimal unitPrice, BigDecimal discountPercent, BigDecimal taxPercent) {
	}

	public record Result(List<BigDecimal> lineTotals, BigDecimal subtotal, BigDecimal discountAmount,
			BigDecimal taxAmount, BigDecimal grandTotal) {
	}

	/**
	 * Validates lines and prices them. Rounding is HALF_UP (half away from zero) to 2 places, applied per line;
	 * lineTotal is gross minus discount, before VAT.
	 * @throws IllegalArgumentException with the contract message for the first invalid line
	 */
	public static Result calculate(List<Line> lines) {
		if (lines.isEmpty()) {
			throw new IllegalArgumentException(NO_ITEMS);
		}
		BigDecimal subtotal = BigDecimal.ZERO;
		BigDecimal discountAmount = BigDecimal.ZERO;
		BigDecimal taxAmount = BigDecimal.ZERO;
		List<BigDecimal> lineTotals = new ArrayList<>(lines.size());
		for (int i = 0; i < lines.size(); i++) {
			Line it = lines.get(i);
			String problem = validate(it);
			if (problem != null) {
				throw new IllegalArgumentException("items[%d]: %s".formatted(i, problem));
			}
			BigDecimal gross = money(it.quantity().multiply(it.unitPrice()));
			BigDecimal discount = money(gross.multiply(it.discountPercent()).divide(HUNDRED));
			BigDecimal lineTotal = gross.subtract(discount);
			BigDecimal tax = money(lineTotal.multiply(it.taxPercent()).divide(HUNDRED));
			lineTotals.add(lineTotal);
			subtotal = subtotal.add(gross);
			discountAmount = discountAmount.add(discount);
			taxAmount = taxAmount.add(tax);
		}
		return new Result(List.copyOf(lineTotals), money(subtotal), money(discountAmount), money(taxAmount),
				money(subtotal.subtract(discountAmount).add(taxAmount)));
	}

	/** Enforces the QuoteItemInput constraints from contracts/openapi.yaml. */
	private static String validate(Line it) {
		if (it.quantity().compareTo(BigDecimal.ONE) < 0) {
			return "quantity must be at least 1";
		}
		if (it.unitPrice().signum() < 0) {
			return "unitPrice must not be negative";
		}
		if (!inPercentRange(it.discountPercent())) {
			return "discountPercent must be between 0 and 100";
		}
		if (!inPercentRange(it.taxPercent())) {
			return "taxPercent must be between 0 and 100";
		}
		return null;
	}

	private static boolean inPercentRange(BigDecimal d) {
		return d.signum() >= 0 && d.compareTo(HUNDRED) <= 0;
	}

	private static BigDecimal money(BigDecimal d) {
		return d.setScale(MONEY_SCALE, RoundingMode.HALF_UP);
	}

}
