package com.swiftquote.domain;

import java.util.List;

/** Quote statuses and event actions, as stored in the database and sent on the wire. */
public final class Statuses {

	public static final String DRAFT = "draft";

	public static final String PENDING_APPROVAL = "pending_approval";

	public static final String APPROVED = "approved";

	public static final String SENT = "sent";

	public static final String VIEWED = "viewed";

	public static final String ACCEPTED = "accepted";

	public static final String REJECTED = "rejected";

	public static final String EXPIRED = "expired";

	/** The contract's enum order. */
	public static final List<String> ALL = List.of(DRAFT, PENDING_APPROVAL, APPROVED, SENT, VIEWED, ACCEPTED,
			REJECTED, EXPIRED);

	/** The states a customer can see: the quote has been sent to them. */
	public static final List<String> CUSTOMER = List.of(SENT, VIEWED, ACCEPTED, REJECTED);

	/** The states in which a customer may still accept or reject. */
	public static final List<String> RESPONDABLE = List.of(SENT, VIEWED);

	public static final String EV_CREATED = "created";

	public static final String EV_UPDATED = "updated";

	public static final String EV_SUBMITTED = "submitted";

	public static final String EV_APPROVED = "approved";

	public static final String EV_RETURNED = "returned";

	public static final String EV_SENT = "sent";

	public static final String EV_VIEWED = "viewed";

	public static final String EV_ACCEPTED = "accepted";

	public static final String EV_REJECTED = "rejected";

	/** The history entries a customer may see. */
	public static final List<String> CUSTOMER_EVENTS = List.of(EV_SENT, EV_VIEWED, EV_ACCEPTED, EV_REJECTED);

	private Statuses() {
	}

	public static boolean valid(String status) {
		return ALL.contains(status);
	}

}
