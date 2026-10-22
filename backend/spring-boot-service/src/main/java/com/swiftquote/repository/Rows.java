package com.swiftquote.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/** Column readers shared by the repositories. */
final class Rows {

	private Rows() {
	}

	static UUID uuid(ResultSet rs, int col) throws SQLException {
		return rs.getObject(col, UUID.class);
	}

	static Instant instant(ResultSet rs, int col) throws SQLException {
		OffsetDateTime t = rs.getObject(col, OffsetDateTime.class);
		return (t != null) ? t.toInstant() : null;
	}

	static OffsetDateTime utc(Instant t) {
		return (t != null) ? t.atOffset(ZoneOffset.UTC) : null;
	}

	/** True when a statement failed on a foreign key (SQLSTATE 23503), whatever Spring translated it to. */
	static boolean isForeignKeyViolation(Throwable ex) {
		for (Throwable t = ex; t != null; t = (t.getCause() != t) ? t.getCause() : null) {
			if (t instanceof SQLException sql && "23503".equals(sql.getSQLState())) {
				return true;
			}
		}
		return false;
	}

}
