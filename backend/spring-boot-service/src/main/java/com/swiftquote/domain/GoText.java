package com.swiftquote.domain;

import java.util.UUID;

/** Small helpers that reproduce Go's text formatting and parsing, so messages and edge cases match the Go service. */
public final class GoText {

	private static final char[] HEX = "0123456789abcdef".toCharArray();

	private GoText() {
	}

	/** Go's strings.TrimSpace: trims Unicode white space as defined by unicode.IsSpace. */
	public static String trim(String s) {
		int start = 0;
		int end = s.length();
		while (start < end && isSpace(s.charAt(start))) {
			start++;
		}
		while (end > start && isSpace(s.charAt(end - 1))) {
			end--;
		}
		return s.substring(start, end);
	}

	private static boolean isSpace(char c) {
		return switch (c) {
			case '\t', '\n', 0x0B, '\f', '\r', ' ', 0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000 -> true;
			default -> c >= 0x2000 && c <= 0x200A;
		};
	}

	/** Go's %q: a double-quoted string with Go escape sequences. */
	public static String quote(String s) {
		StringBuilder b = new StringBuilder(s.length() + 2).append('"');
		for (int i = 0; i < s.length();) {
			int cp = s.codePointAt(i);
			i += Character.charCount(cp);
			switch (cp) {
				case '"' -> b.append("\\\"");
				case '\\' -> b.append("\\\\");
				case '\n' -> b.append("\\n");
				case '\t' -> b.append("\\t");
				case '\r' -> b.append("\\r");
				case 0x07 -> b.append("\\a");
				case '\b' -> b.append("\\b");
				case '\f' -> b.append("\\f");
				case 0x0B -> b.append("\\v");
				default -> {
					if (cp < 0x20 || cp == 0x7F) {
						b.append("\\x").append(HEX[cp >> 4]).append(HEX[cp & 0xF]);
					}
					else if (Character.isISOControl(cp) || !Character.isDefined(cp)
							|| Character.getType(cp) == Character.FORMAT) {
						b.append((cp > 0xFFFF) ? "\\U%08x".formatted(cp) : "\\u%04x".formatted(cp));
					}
					else {
						b.appendCodePoint(cp);
					}
				}
			}
		}
		return b.append('"').toString();
	}

	/**
	 * github.com/google/uuid Parse: the canonical form, optionally wrapped in {} or prefixed by urn:uuid:, or 32 bare
	 * hex digits. Returns null when the text is not a UUID.
	 */
	public static UUID parseUuid(String s) {
		if (s == null) {
			return null;
		}
		String hex;
		switch (s.length()) {
			case 36 -> hex = dashed(s);
			case 38 -> hex = (s.charAt(0) == '{' && s.charAt(37) == '}') ? dashed(s.substring(1, 37)) : null;
			case 45 -> hex = s.substring(0, 9).equalsIgnoreCase("urn:uuid:") ? dashed(s.substring(9)) : null;
			case 32 -> hex = s;
			default -> hex = null;
		}
		if (hex == null || hex.length() != 32) {
			return null;
		}
		long hi = 0;
		long lo = 0;
		for (int i = 0; i < 32; i++) {
			char c = hex.charAt(i);
			int d = (c >= '0' && c <= '9') ? c - '0'
					: (c >= 'a' && c <= 'f') ? c - 'a' + 10 : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1;
			if (d < 0) {
				return null;
			}
			if (i < 16) {
				hi = (hi << 4) | d;
			}
			else {
				lo = (lo << 4) | d;
			}
		}
		return new UUID(hi, lo);
	}

	private static String dashed(String s) {
		if (s.charAt(8) != '-' || s.charAt(13) != '-' || s.charAt(18) != '-' || s.charAt(23) != '-') {
			return null;
		}
		return s.substring(0, 8) + s.substring(9, 13) + s.substring(14, 18) + s.substring(19, 23) + s.substring(24);
	}

}
