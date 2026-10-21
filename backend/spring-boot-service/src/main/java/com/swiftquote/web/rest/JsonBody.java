package com.swiftquote.web.rest;

import java.math.BigDecimal;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.GoText;

/**
 * A request body decoded with the Go service's encoding/json semantics: unknown fields are ignored, keys match field
 * names case-insensitively (the last match wins), JSON null leaves a field at its zero value, and any type mismatch
 * is a 400 "malformed JSON body". Decoding happens after authentication and before the role check, as in Go.
 */
final class JsonBody {

	private static final JsonMapper MAPPER = JsonMapper.builder()
		.enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
		.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
		.build();

	private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

	/** An object node, or null for a JSON null body (all fields absent). */
	private final JsonNode node;

	private JsonBody(JsonNode node) {
		this.node = node;
	}

	/** Decodes a required body; an empty body is malformed. */
	static JsonBody of(byte[] raw) {
		if (raw == null || raw.length == 0) {
			throw malformed("unexpected end of JSON input");
		}
		JsonNode node;
		try {
			node = MAPPER.readTree(raw);
		}
		catch (JacksonException ex) {
			throw malformed(firstLine(ex.getOriginalMessage()));
		}
		if (node == null || node.isMissingNode()) {
			throw malformed("unexpected end of JSON input");
		}
		if (node.isNull()) {
			return new JsonBody(null);
		}
		if (!node.isObject()) {
			throw malformed("json: cannot unmarshal " + kind(node) + " into Go value of type object");
		}
		return new JsonBody(node);
	}

	/** Decodes an optional body: an empty body means every field is absent. */
	static JsonBody optional(byte[] raw) {
		return (raw == null || raw.length == 0) ? new JsonBody(null) : of(raw);
	}

	private JsonNode field(String name) {
		if (this.node == null) {
			return null;
		}
		JsonNode found = null;
		for (Map.Entry<String, JsonNode> e : this.node.properties()) {
			if (e.getKey().equalsIgnoreCase(name)) {
				found = e.getValue();
			}
		}
		return (found == null || found.isNull()) ? null : found;
	}

	/** A Go string field: "" when absent or null. */
	String string(String name) {
		String s = optString(name);
		return (s != null) ? s : "";
	}

	/** A Go *string field: null when absent or null. */
	String optString(String name) {
		JsonNode v = field(name);
		if (v == null) {
			return null;
		}
		if (!v.isString()) {
			throw typeError(v, name, "string");
		}
		return v.stringValue();
	}

	UUID uuid(String name) {
		String s = textOf(name, "uuid.UUID");
		if (s == null) {
			return null;
		}
		UUID id = GoText.parseUuid(s);
		if (id == null) {
			throw malformed("invalid UUID length: " + s.length());
		}
		return id;
	}

	BigDecimal decimal(String name) {
		JsonNode v = field(name);
		if (v == null) {
			return null;
		}
		if (v.isNumber()) {
			return v.decimalValue();
		}
		if (v.isString()) {
			try {
				return new BigDecimal(v.stringValue());
			}
			catch (NumberFormatException ex) {
				throw malformed("can't convert " + v.stringValue() + " to decimal");
			}
		}
		throw malformed("can't convert " + v + " to decimal");
	}

	Boolean bool(String name) {
		JsonNode v = field(name);
		if (v == null) {
			return null;
		}
		if (!v.isBoolean()) {
			throw typeError(v, name, "bool");
		}
		return v.booleanValue();
	}

	/** A format: date value (YYYY-MM-DD). */
	LocalDate date(String name) {
		String s = textOf(name, "date");
		if (s == null) {
			return null;
		}
		LocalDate d = parseDate(s);
		if (d == null) {
			throw malformed("parsing time " + GoText.quote(s) + " as \"2006-01-02\": cannot parse");
		}
		return d;
	}

	/** An array of objects; null when absent or null, and a null element decodes as an empty object. */
	List<JsonBody> array(String name) {
		JsonNode v = field(name);
		if (v == null) {
			return null;
		}
		if (!v.isArray()) {
			throw typeError(v, name, "array");
		}
		List<JsonBody> out = new ArrayList<>();
		for (JsonNode el : v) {
			if (el.isNull()) {
				out.add(new JsonBody(null));
			}
			else if (el.isObject()) {
				out.add(new JsonBody(el));
			}
			else {
				throw typeError(el, name, "object");
			}
		}
		return out;
	}

	private String textOf(String name, String type) {
		JsonNode v = field(name);
		if (v == null) {
			return null;
		}
		if (!v.isString()) {
			throw typeError(v, name, type);
		}
		return v.stringValue();
	}

	/** Go's time.Parse("2006-01-02", s): exactly 4-2-2 ASCII digits naming a real date; null otherwise. */
	static LocalDate parseDate(String s) {
		if (!DATE.matcher(s).matches()) {
			return null;
		}
		try {
			return LocalDate.of(Integer.parseInt(s.substring(0, 4)), Integer.parseInt(s.substring(5, 7)),
					Integer.parseInt(s.substring(8, 10)));
		}
		catch (DateTimeException ex) {
			return null;
		}
	}

	private static ApiException typeError(JsonNode v, String field, String type) {
		return malformed("json: cannot unmarshal " + kind(v) + " into Go struct field ." + field + " of type " + type);
	}

	private static String kind(JsonNode v) {
		if (v.isString()) {
			return "string";
		}
		if (v.isNumber()) {
			return "number";
		}
		if (v.isBoolean()) {
			return "bool";
		}
		if (v.isArray()) {
			return "array";
		}
		return "object";
	}

	static ApiException malformed(String detail) {
		return new ApiException.Validation(List.of("malformed JSON body: " + detail));
	}

	private static String firstLine(String s) {
		if (s == null) {
			return "invalid JSON";
		}
		int nl = s.indexOf('\n');
		return (nl >= 0) ? s.substring(0, nl) : s;
	}

}
