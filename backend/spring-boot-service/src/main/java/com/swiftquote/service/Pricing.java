package com.swiftquote.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

import com.swiftquote.domain.DiscountTypes;

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

	/** One line to price; discountType is percent or amount, unitCost is null when unknown. */
	public record Line(BigDecimal quantity, BigDecimal unitPrice, String discountType, BigDecimal discountValue,
			BigDecimal taxPercent, BigDecimal unitCost) {
	}

	/** A priced line; costTotal and profit are null when the line has no unitCost. */
	public record LineResult(BigDecimal gross, BigDecimal discount, BigDecimal lineTotal, BigDecimal tax,
			BigDecimal costTotal, BigDecimal profit) {
	}

	/** Quote totals; costTotal and profit are null unless every line has a unitCost. */
	public record Result(List<LineResult> lines, BigDecimal subtotal, BigDecimal discountAmount, BigDecimal taxAmount,
			BigDecimal grandTotal, BigDecimal costTotal, BigDecimal profit) {

		public List<BigDecimal> lineTotals() {
			return this.lines.stream().map(LineResult::lineTotal).toList();
		}

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
		BigDecimal costTotal = BigDecimal.ZERO;
		boolean allCosted = true;
		List<LineResult> results = new ArrayList<>(lines.size());
		for (int i = 0; i < lines.size(); i++) {
			Line it = lines.get(i);
			String problem = validate(it);
			if (problem != null) {
				throw new IllegalArgumentException("items[%d]: %s".formatted(i, problem));
			}
			LineResult r = priceLine(it);
			results.add(r);
			subtotal = subtotal.add(r.gross());
			discountAmount = discountAmount.add(r.discount());
			taxAmount = taxAmount.add(r.tax());
			if (r.costTotal() == null) {
				allCosted = false;
			}
			else {
				costTotal = costTotal.add(r.costTotal());
			}
		}
		BigDecimal profit = allCosted ? money(subtotal.subtract(discountAmount).subtract(costTotal)) : null;
		return new Result(List.copyOf(results), money(subtotal), money(discountAmount), money(taxAmount),
				money(subtotal.subtract(discountAmount).add(taxAmount)), allCosted ? money(costTotal) : null, profit);
	}

	private static LineResult priceLine(Line it) {
		BigDecimal gross = money(it.quantity().multiply(it.unitPrice()));
		BigDecimal discount = DiscountTypes.AMOUNT.equals(it.discountType()) ? money(it.discountValue())
				: money(gross.multiply(it.discountValue()).divide(HUNDRED));
		BigDecimal lineTotal = gross.subtract(discount);
		BigDecimal tax = money(lineTotal.multiply(it.taxPercent()).divide(HUNDRED));
		BigDecimal cost = (it.unitCost() != null) ? costTotal(it.quantity(), it.unitCost()) : null;
		return new LineResult(gross, discount, lineTotal, tax, cost, (cost != null) ? lineTotal.subtract(cost) : null);
	}

	/** round(quantity * unitCost). */
	public static BigDecimal costTotal(BigDecimal quantity, BigDecimal unitCost) {
		return money(quantity.multiply(unitCost));
	}

	/** round(quantity * unitPrice). */
	public static BigDecimal gross(BigDecimal quantity, BigDecimal unitPrice) {
		return money(quantity.multiply(unitPrice));
	}

	/** Enforces the QuoteItemInput constraints from contracts/openapi.yaml. */
	private static String validate(Line it) {
		if (it.quantity().compareTo(BigDecimal.ONE) < 0) {
			return "quantity must be at least 1";
		}
		if (it.unitPrice().signum() < 0) {
			return "unitPrice must not be negative";
		}
		if (it.discountValue().signum() < 0) {
			return "discountValue must not be negative";
		}
		if (DiscountTypes.AMOUNT.equals(it.discountType())) {
			if (money(it.discountValue()).compareTo(money(it.quantity().multiply(it.unitPrice()))) > 0) {
				return "discountValue must not exceed the line amount";
			}
		}
		else if (!inPercentRange(it.discountValue())) {
			return "discountValue must be between 0 and 100";
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
