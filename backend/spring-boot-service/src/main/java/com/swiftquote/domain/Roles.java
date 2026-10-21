package com.swiftquote.domain;

import java.util.Set;

/** Membership roles, as stored in organization_members.role and sent on the wire. */
public final class Roles {

	public static final String ADMIN = "admin";

	public static final String WOC = "woc";

	public static final String WO = "wo";

	public static final String RM = "rm";

	public static final String CUSTOMER = "customer";

	private static final Set<String> ALL = Set.of(ADMIN, WOC, WO, RM, CUSTOMER);

	private Roles() {
	}

	public static boolean valid(String role) {
		return role != null && ALL.contains(role);
	}

}
