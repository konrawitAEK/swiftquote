package com.swiftquote.domain;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * A single priced line. product and category are null for lines created before they existed, description is "" if
 * none, and unitCost is null for lines saved without a cost. discountAmount is the discount in money.
 */
public record QuoteItem(UUID id, Ref product, String title, Ref category, String description, BigDecimal quantity,
		BigDecimal unitPrice, String discountType, BigDecimal discountValue, BigDecimal discountAmount,
		BigDecimal taxPercent, BigDecimal lineTotal, BigDecimal unitCost) {
}
