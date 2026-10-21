import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { formatMoney } from '../../core/pricing';
import { InlineBar } from './inline-bar';
import { byAmount, maxAmount, MEASURE_LABELS, type MeasureKey, type Summary } from './measures';

/** Amount by product category (line total incl. VAT), with each category's share of the total. */
@Component({
  selector: 'app-category-breakdown',
  imports: [MatCardModule, InlineBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card>
      <mat-card-content class="head">
        <h2 class="section-title">{{ title() }}</h2>
        <div class="body2 muted">Line amounts after discount, incl. VAT · total {{ totalText() }}</div>
      </mat-card-content>
      <div class="table-wrap">
        <table class="data-table small">
          <thead>
            <tr>
              <th>Category</th>
              <th class="right">Lines</th>
              <th class="right">Share</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.category?.id ?? 'none') {
              <tr>
                <td class="name" [class.muted]="!r.category">{{ r.category?.name ?? 'Uncategorized' }}</td>
                <td class="right">{{ r[measure()].count }}</td>
                <td class="right">{{ share(r[measure()].amount) }}</td>
                <td class="bar"><app-inline-bar [value]="r[measure()].amount" [max]="max()" /></td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="empty">Nothing in this period.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </mat-card>
  `,
  styles: `
    .head {
      padding-top: 16px !important;
    }
    .name {
      font-weight: 500;
    }
    .bar {
      min-width: 240px;
    }
  `,
})
export class CategoryBreakdown {
  readonly data = input.required<Summary>();
  readonly measure = input.required<MeasureKey>();

  protected readonly rows = computed(() =>
    byAmount(this.data().byCategory, this.measure()).filter((r) => r[this.measure()].count > 0),
  );
  private readonly total = computed(() => this.rows().reduce((sum, r) => sum + r[this.measure()].amount, 0));
  protected readonly totalText = computed(() => formatMoney(this.total()));
  protected readonly max = computed(() => maxAmount(this.rows().map((r) => r[this.measure()])));
  protected readonly title = computed(() => `${MEASURE_LABELS[this.measure()]} by product category`);

  protected share(amount: number): string {
    const total = this.total();
    return total > 0 ? `${((amount / total) * 100).toFixed(1)}%` : '—';
  }
}
