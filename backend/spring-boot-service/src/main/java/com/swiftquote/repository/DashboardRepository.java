package com.swiftquote.repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import com.swiftquote.domain.Ref;

/**
 * Sales aggregates for the WOC dashboard. The SQL is the Go service's (storage/postgres/dashboard.go) verbatim, with
 * :from/:to as the optional inclusive UTC date bounds, so all backends aggregate identically.
 */
@Repository
public class DashboardRepository {

	public record Range(LocalDate from, LocalDate to) {
	}

	public record Measure(long count, BigDecimal amount) {

		public static final Measure ZERO = new Measure(0, BigDecimal.ZERO);

	}

	public record StatusRow(String status, long count, BigDecimal amount) {
	}

	public record MonthRow(String month, Measure won, Measure pending) {
	}

	public record RmRow(Ref user, String team, long quoteCount, long sentCount, Measure won, Measure pending) {
	}

	public record TeamRow(UUID id, String name, Measure won, Measure pending) {
	}

	/** category is null for lines created before categories existed. */
	public record CategoryRow(Ref category, Measure won, Measure pending) {
	}

	private static final String IN_RANGE = """
			(CAST(:from AS date) IS NULL OR (q.created_at AT TIME ZONE 'UTC')::date >= CAST(:from AS date))
				AND (CAST(:to AS date) IS NULL OR (q.created_at AT TIME ZONE 'UTC')::date <= CAST(:to AS date))""";

	private static final String IS_WON = "q.status = 'accepted'";

	private static final String IS_PENDING = "(q.status IN ('sent', 'viewed') AND q.expiry_date >= (now() AT TIME ZONE 'UTC')::date)";

	private static final String IS_SENT = "q.status IN ('sent', 'viewed', 'accepted', 'rejected')";

	// Line amount incl. VAT, rounded per line exactly like pricing, so categories add up to grand totals.
	private static final String LINE_GROSS = "(i.line_total + round(i.line_total * i.tax_percent / 100, 2))";

	private final JdbcClient jdbc;

	public DashboardRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	private JdbcClient.StatementSpec sql(String sql, UUID orgId, Range r) {
		return this.jdbc.sql(sql).param("org", orgId).param("from", r.from()).param("to", r.to());
	}

	/** Reads a (count, amount) column pair starting at col. */
	private static Measure measure(ResultSet rs, int col) throws SQLException {
		return new Measure(rs.getLong(col), rs.getBigDecimal(col + 1));
	}

	public List<StatusRow> countByStatus(UUID orgId, Range r) {
		return sql("""
				SELECT q.status, count(*), COALESCE(sum(q.grand_total), 0)
				FROM quotes q
				WHERE q.organization_id = :org AND\s""" + IN_RANGE + """

				GROUP BY q.status""", orgId, r)
			.query((rs, n) -> new StatusRow(rs.getString(1), rs.getLong(2), rs.getBigDecimal(3)))
			.list();
	}

	public Measure pendingTotal(UUID orgId, Range r) {
		return sql("""
				SELECT count(*), COALESCE(sum(q.grand_total), 0)
				FROM quotes q
				WHERE q.organization_id = :org AND\s""" + IS_PENDING + " AND " + IN_RANGE, orgId, r)
			.query((rs, n) -> measure(rs, 1))
			.single();
	}

	public List<MonthRow> byMonth(UUID orgId, Range r) {
		return sql("""
				SELECT month, sum(won_count), sum(won_amount), sum(pending_count), sum(pending_amount)
				FROM (
					SELECT to_char(q.signed_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
						1 AS won_count, q.grand_total AS won_amount, 0 AS pending_count, 0 AS pending_amount
					FROM quotes q
					WHERE q.organization_id = :org AND\s""" + IS_WON + " AND q.signed_at IS NOT NULL AND " + IN_RANGE + """

					UNION ALL
					SELECT to_char(q.expiry_date, 'YYYY-MM'), 0, 0, 1, q.grand_total
					FROM quotes q
					WHERE q.organization_id = :org AND\s""" + IS_PENDING + " AND " + IN_RANGE + """

				) m
				GROUP BY month
				ORDER BY month""", orgId, r)
			.query((rs, n) -> new MonthRow(rs.getString(1), measure(rs, 2), measure(rs, 4)))
			.list();
	}

	public List<RmRow> byRm(UUID orgId, Range r) {
		return sql("""
				SELECT u.id, u.full_name, t.name,
					count(*),
					count(*) FILTER (WHERE %1$s),
					count(*) FILTER (WHERE %2$s),
					COALESCE(sum(q.grand_total) FILTER (WHERE %2$s), 0) AS won_amount,
					count(*) FILTER (WHERE %3$s),
					COALESCE(sum(q.grand_total) FILTER (WHERE %3$s), 0)
				FROM quotes q
				JOIN users u ON u.id = q.created_by
				LEFT JOIN organization_members m ON m.user_id = u.id AND m.organization_id = q.organization_id
				LEFT JOIN teams t ON t.id = m.team_id
				WHERE q.organization_id = :org AND %4$s
				GROUP BY u.id, u.full_name, t.name
				ORDER BY won_amount DESC, u.full_name, u.id""".formatted(IS_SENT, IS_WON, IS_PENDING, IN_RANGE), orgId, r)
			.query((rs, n) -> new RmRow(new Ref(Rows.uuid(rs, 1), rs.getString(2)), rs.getString(3), rs.getLong(4),
					rs.getLong(5), measure(rs, 6), measure(rs, 8)))
			.list();
	}

	public List<TeamRow> byTeam(UUID orgId, Range r) {
		return sql("""
				SELECT t.id, t.name,
					count(q.id) FILTER (WHERE %1$s),
					COALESCE(sum(q.grand_total) FILTER (WHERE %1$s), 0) AS won_amount,
					count(q.id) FILTER (WHERE %2$s),
					COALESCE(sum(q.grand_total) FILTER (WHERE %2$s), 0)
				FROM teams t
				LEFT JOIN organization_members m ON m.team_id = t.id
				LEFT JOIN quotes q ON q.created_by = m.user_id AND q.organization_id = t.organization_id AND %3$s
				WHERE t.organization_id = :org
				GROUP BY t.id, t.name
				ORDER BY won_amount DESC, t.name, t.id""".formatted(IS_WON, IS_PENDING, IN_RANGE), orgId, r)
			.query((rs, n) -> new TeamRow(Rows.uuid(rs, 1), rs.getString(2), measure(rs, 3), measure(rs, 5)))
			.list();
	}

	public List<CategoryRow> byCategory(UUID orgId, Range r) {
		return sql("""
				SELECT c.id, c.name,
					count(*) FILTER (WHERE %1$s),
					COALESCE(sum(%3$s) FILTER (WHERE %1$s), 0) AS won_amount,
					count(*) FILTER (WHERE %2$s),
					COALESCE(sum(%3$s) FILTER (WHERE %2$s), 0)
				FROM quote_items i
				JOIN quotes q ON q.id = i.quote_id
				LEFT JOIN product_categories c ON c.id = i.category_id
				WHERE q.organization_id = :org AND (%1$s OR %2$s) AND %4$s
				GROUP BY c.id, c.name
				ORDER BY (c.id IS NULL), won_amount DESC, c.name, c.id""".formatted(IS_WON, IS_PENDING, LINE_GROSS,
				IN_RANGE), orgId, r)
			.query((rs, n) -> new CategoryRow(Ref.of(Rows.uuid(rs, 1), rs.getString(2)), measure(rs, 3),
					measure(rs, 5)))
			.list();
	}

}
