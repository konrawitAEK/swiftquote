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

	/** cost and profit are before VAT, over the lines that have a unit cost. */
	public record Measure(long count, BigDecimal amount, BigDecimal cost, BigDecimal profit) {

		public static final Measure ZERO = new Measure(0, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);

		public Measure plus(Measure o) {
			return new Measure(this.count + o.count, this.amount.add(o.amount), this.cost.add(o.cost),
					this.profit.add(o.profit));
		}

	}

	/** cost and profit feed won and inApproval; byStatus shows only count and amount. */
	public record StatusRow(String status, long count, BigDecimal amount, BigDecimal cost, BigDecimal profit) {

		public Measure measure() {
			return new Measure(this.count, this.amount, this.cost, this.profit);
		}

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

	// Per line cost and profit, over lines with a unit cost only (older lines have none).
	private static final String LINE_COST = "round(i.quantity * i.unit_cost, 2)";

	private static final String LINE_PROFIT = "(i.line_total - round(i.quantity * i.unit_cost, 2))";

	// One row per quote q: its cost and profit (0 when no line has a cost).
	private static final String QUOTE_COST = """
			LEFT JOIN LATERAL (
				SELECT COALESCE(sum(%1$s), 0) AS cost, COALESCE(sum(%2$s), 0) AS profit
				FROM quote_items i
				WHERE i.quote_id = q.id AND i.unit_cost IS NOT NULL
			) qc ON true""".formatted(LINE_COST, LINE_PROFIT);

	private final JdbcClient jdbc;

	public DashboardRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	private JdbcClient.StatementSpec sql(String sql, UUID orgId, Range r) {
		return this.jdbc.sql(sql).param("org", orgId).param("from", r.from()).param("to", r.to());
	}

	/** Reads (count, amount, cost, profit) columns starting at col. */
	private static Measure measure(ResultSet rs, int col) throws SQLException {
		return new Measure(rs.getLong(col), rs.getBigDecimal(col + 1), rs.getBigDecimal(col + 2),
				rs.getBigDecimal(col + 3));
	}

	public List<StatusRow> countByStatus(UUID orgId, Range r) {
		return sql("""
				SELECT q.status, count(*), COALESCE(sum(q.grand_total), 0), COALESCE(sum(qc.cost), 0),
					COALESCE(sum(qc.profit), 0)
				FROM quotes q
				""" + QUOTE_COST + """

				WHERE q.organization_id = :org AND\s""" + IN_RANGE + """

				GROUP BY q.status""", orgId, r)
			.query((rs, n) -> new StatusRow(rs.getString(1), rs.getLong(2), rs.getBigDecimal(3), rs.getBigDecimal(4),
					rs.getBigDecimal(5)))
			.list();
	}

	public Measure pendingTotal(UUID orgId, Range r) {
		return sql("""
				SELECT count(*), COALESCE(sum(q.grand_total), 0), COALESCE(sum(qc.cost), 0), COALESCE(sum(qc.profit), 0)
				FROM quotes q
				""" + QUOTE_COST + """

				WHERE q.organization_id = :org AND\s""" + IS_PENDING + " AND " + IN_RANGE, orgId, r)
			.query((rs, n) -> measure(rs, 1))
			.single();
	}

	public List<MonthRow> byMonth(UUID orgId, Range r) {
		return sql("""
				SELECT month, sum(won_count), sum(won_amount), sum(won_cost), sum(won_profit),
					sum(pending_count), sum(pending_amount), sum(pending_cost), sum(pending_profit)
				FROM (
					SELECT to_char(q.signed_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
						1 AS won_count, q.grand_total AS won_amount, qc.cost AS won_cost, qc.profit AS won_profit,
						0 AS pending_count, 0 AS pending_amount, 0 AS pending_cost, 0 AS pending_profit
					FROM quotes q
					""" + QUOTE_COST + """

					WHERE q.organization_id = :org AND\s""" + IS_WON + " AND q.signed_at IS NOT NULL AND " + IN_RANGE + """

					UNION ALL
					SELECT to_char(q.expiry_date, 'YYYY-MM'), 0, 0, 0, 0, 1, q.grand_total, qc.cost, qc.profit
					FROM quotes q
					""" + QUOTE_COST + """

					WHERE q.organization_id = :org AND\s""" + IS_PENDING + " AND " + IN_RANGE + """

				) m
				GROUP BY month
				ORDER BY month""", orgId, r)
			.query((rs, n) -> new MonthRow(rs.getString(1), measure(rs, 2), measure(rs, 6)))
			.list();
	}

	public List<RmRow> byRm(UUID orgId, Range r) {
		return sql("""
				SELECT u.id, u.full_name, t.name,
					count(*),
					count(*) FILTER (WHERE %1$s),
					count(*) FILTER (WHERE %2$s),
					COALESCE(sum(q.grand_total) FILTER (WHERE %2$s), 0) AS won_amount,
					COALESCE(sum(qc.cost) FILTER (WHERE %2$s), 0),
					COALESCE(sum(qc.profit) FILTER (WHERE %2$s), 0),
					count(*) FILTER (WHERE %3$s),
					COALESCE(sum(q.grand_total) FILTER (WHERE %3$s), 0),
					COALESCE(sum(qc.cost) FILTER (WHERE %3$s), 0),
					COALESCE(sum(qc.profit) FILTER (WHERE %3$s), 0)
				FROM quotes q
				%5$s
				JOIN users u ON u.id = q.created_by
				LEFT JOIN organization_members m ON m.user_id = u.id AND m.organization_id = q.organization_id
				LEFT JOIN teams t ON t.id = m.team_id
				WHERE q.organization_id = :org AND %4$s
				GROUP BY u.id, u.full_name, t.name
				ORDER BY won_amount DESC, u.full_name, u.id""".formatted(IS_SENT, IS_WON, IS_PENDING, IN_RANGE, QUOTE_COST), orgId, r)
			.query((rs, n) -> new RmRow(new Ref(Rows.uuid(rs, 1), rs.getString(2)), rs.getString(3), rs.getLong(4),
					rs.getLong(5), measure(rs, 6), measure(rs, 10)))
			.list();
	}

	public List<TeamRow> byTeam(UUID orgId, Range r) {
		return sql("""
				SELECT t.id, t.name,
					count(q.id) FILTER (WHERE %1$s),
					COALESCE(sum(q.grand_total) FILTER (WHERE %1$s), 0) AS won_amount,
					COALESCE(sum(qc.cost) FILTER (WHERE %1$s), 0),
					COALESCE(sum(qc.profit) FILTER (WHERE %1$s), 0),
					count(q.id) FILTER (WHERE %2$s),
					COALESCE(sum(q.grand_total) FILTER (WHERE %2$s), 0),
					COALESCE(sum(qc.cost) FILTER (WHERE %2$s), 0),
					COALESCE(sum(qc.profit) FILTER (WHERE %2$s), 0)
				FROM teams t
				LEFT JOIN organization_members m ON m.team_id = t.id
				LEFT JOIN quotes q ON q.created_by = m.user_id AND q.organization_id = t.organization_id AND %3$s
				%4$s
				WHERE t.organization_id = :org
				GROUP BY t.id, t.name
				ORDER BY won_amount DESC, t.name, t.id""".formatted(IS_WON, IS_PENDING, IN_RANGE, QUOTE_COST), orgId, r)
			.query((rs, n) -> new TeamRow(Rows.uuid(rs, 1), rs.getString(2), measure(rs, 3), measure(rs, 7)))
			.list();
	}

	public List<CategoryRow> byCategory(UUID orgId, Range r) {
		return sql("""
				SELECT c.id, c.name,
					count(*) FILTER (WHERE %1$s),
					COALESCE(sum(%3$s) FILTER (WHERE %1$s), 0) AS won_amount,
					COALESCE(sum(%5$s) FILTER (WHERE %1$s AND i.unit_cost IS NOT NULL), 0),
					COALESCE(sum(%6$s) FILTER (WHERE %1$s AND i.unit_cost IS NOT NULL), 0),
					count(*) FILTER (WHERE %2$s),
					COALESCE(sum(%3$s) FILTER (WHERE %2$s), 0),
					COALESCE(sum(%5$s) FILTER (WHERE %2$s AND i.unit_cost IS NOT NULL), 0),
					COALESCE(sum(%6$s) FILTER (WHERE %2$s AND i.unit_cost IS NOT NULL), 0)
				FROM quote_items i
				JOIN quotes q ON q.id = i.quote_id
				LEFT JOIN product_categories c ON c.id = i.category_id
				WHERE q.organization_id = :org AND (%1$s OR %2$s) AND %4$s
				GROUP BY c.id, c.name
				ORDER BY (c.id IS NULL), won_amount DESC, c.name, c.id""".formatted(IS_WON, IS_PENDING, LINE_GROSS,
				IN_RANGE, LINE_COST, LINE_PROFIT), orgId, r)
			.query((rs, n) -> new CategoryRow(Ref.of(Rows.uuid(rs, 1), rs.getString(2)), measure(rs, 3),
					measure(rs, 7)))
			.list();
	}

}
