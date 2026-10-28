package com.swiftquote.domain;

import java.math.BigDecimal;
import java.util.UUID;

/** A catalog product; stock is null when it is not tracked (services, licences). */
public record Product(UUID id, String name, Ref category, BigDecimal unitPrice, BigDecimal unitCost,
		BigDecimal stock, boolean active) {
}
