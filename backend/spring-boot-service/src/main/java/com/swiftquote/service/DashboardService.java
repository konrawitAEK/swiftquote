package com.swiftquote.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Service;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.ApiException;
import com.swiftquote.domain.Roles;
import com.swiftquote.domain.Statuses;
import com.swiftquote.repository.DashboardRepository;
import com.swiftquote.repository.DashboardRepository.CategoryRow;
import com.swiftquote.repository.DashboardRepository.Measure;
import com.swiftquote.repository.DashboardRepository.MonthRow;
import com.swiftquote.repository.DashboardRepository.Range;
import com.swiftquote.repository.DashboardRepository.RmRow;
import com.swiftquote.repository.DashboardRepository.StatusRow;
import com.swiftquote.repository.DashboardRepository.TeamRow;

/**
 * Sales summary for WOC (backend/go-service/internal/dashboard/service.go). Measures: won = accepted; pending = sent
 * or viewed and not yet expired; inApproval = pending_approval or approved. Amounts are grand totals incl. VAT;
 * category amounts are line total plus that line's VAT.
 */
@Service
public class DashboardService {

	private static final List<String> SENT_STATUSES = List.of(Statuses.SENT, Statuses.VIEWED, Statuses.ACCEPTED,
			Statuses.REJECTED);

	private static final List<String> IN_APPROVAL_STATUSES = List.of(Statuses.PENDING_APPROVAL, Statuses.APPROVED);

	private final DashboardRepository repo;

	public DashboardService(DashboardRepository repo) {
		this.repo = repo;
	}

	public record Summary(Range range, Measure won, Measure pending, Measure inApproval, long sentCount,
			BigDecimal conversionRate, List<StatusRow> byStatus, List<MonthRow> byMonth, List<RmRow> byRm,
			List<TeamRow> byTeam, List<CategoryRow> byCategory) {
	}

	public Summary summary(Actor a, Range r) {
		if (!Roles.WOC.equals(a.role())) {
			throw ApiException.roleForbidden();
		}
		if (r.from() != null && r.to() != null && r.from().isAfter(r.to())) {
			throw ApiException.invalid("from must not be after to");
		}
		List<StatusRow> counts = this.repo.countByStatus(a.tenantId(), r);
		List<StatusRow> byStatus = new ArrayList<>();
		Measure won = Measure.ZERO;
		long inApprovalCount = 0;
		BigDecimal inApprovalAmount = BigDecimal.ZERO;
		long sentCount = 0;
		for (String st : Statuses.ALL) {
			StatusRow row = counts.stream()
				.filter((c) -> c.status().equals(st))
				.findFirst()
				.orElse(new StatusRow(st, 0, BigDecimal.ZERO));
			byStatus.add(row);
			if (st.equals(Statuses.ACCEPTED)) {
				won = new Measure(row.count(), row.amount());
			}
			if (IN_APPROVAL_STATUSES.contains(st)) {
				inApprovalCount += row.count();
				inApprovalAmount = inApprovalAmount.add(row.amount());
			}
			if (SENT_STATUSES.contains(st)) {
				sentCount += row.count();
			}
		}
		BigDecimal conversionRate = BigDecimal.ZERO;
		if (sentCount > 0) {
			conversionRate = BigDecimal.valueOf(won.count()).divide(BigDecimal.valueOf(sentCount), 4,
					RoundingMode.HALF_UP);
		}
		return new Summary(r, won, this.repo.pendingTotal(a.tenantId(), r),
				new Measure(inApprovalCount, inApprovalAmount), sentCount, conversionRate, byStatus,
				this.repo.byMonth(a.tenantId(), r), this.repo.byRm(a.tenantId(), r), this.repo.byTeam(a.tenantId(), r),
				this.repo.byCategory(a.tenantId(), r));
	}

}
