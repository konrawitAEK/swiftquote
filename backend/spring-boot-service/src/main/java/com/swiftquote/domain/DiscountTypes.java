package com.swiftquote.domain;

/** Line discount kinds, as stored in quote_items.discount_type and sent on the wire. */
public final class DiscountTypes {

	public static final String PERCENT = "percent";

	public static final String AMOUNT = "amount";

	private DiscountTypes() {
	}

	public static boolean valid(String type) {
		return PERCENT.equals(type) || AMOUNT.equals(type);
	}

}
