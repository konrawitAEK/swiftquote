package com.swiftquote.domain;

import java.math.BigDecimal;
import java.util.UUID;

/** A single priced line; category is null for lines created before categories existed, description "" if none. */
public record QuoteItem(UUID id, String title, Ref category, String description, BigDecimal quantity,
		BigDecimal unitPrice, BigDecimal discountPercent, BigDecimal taxPercent, BigDecimal lineTotal) {
}
