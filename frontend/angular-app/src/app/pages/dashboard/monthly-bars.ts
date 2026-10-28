import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { formatMoney } from '../../core/pricing';
import { maxAmount, profitLine, type Measure } from './measures';

const compact = new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 });

export interface MonthPoint {
  month: string;
  value: Measure;
}

/** Single-series column chart; values (and each month's profit and margin) live in per-column tooltips and the y-axis ticks. */
@Component({
  selector: 'app-monthly-bars',
  imports: [MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length === 0) {
      <p class="body2 muted empty">{{ empty() }}</p>
    } @else {
      <div class="chart">
        <div class="axis">
          @for (t of ticks(); track $index) {
            <span class="caption">{{ t }}</span>
          }
        </div>
        <div class="scroll">
          <div class="bars" [style.min-width.px]="rows().length * 40">
            @for (r of rows(); track r.month) {
              <!-- Full-height hit target, larger than the bar itself. -->
              <div class="hit" [matTooltip]="tooltip(r)" matTooltipPosition="above" matTooltipClass="sq-tooltip-lines">
                <div class="bar" role="img" [attr.aria-label]="r.month + ': ' + money(r.value.amount)" [style.height.%]="height(r)"></div>
              </div>
            }
          </div>
          <div class="labels" [style.min-width.px]="rows().length * 40">
            @for (r of rows(); track r.month) {
              <span class="caption">{{ r.month }}</span>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .empty {
      padding: 32px 0;
      text-align: center;
      margin: 0;
    }
    .chart {
      display: flex;
      gap: 8px;
    }
    .axis {
      height: 180px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      text-align: right;
      min-width: 40px;
      line-height: 1;
    }
    .scroll {
      flex: 1;
      overflow-x: auto;
    }
    .bars {
      height: 180px;
      display: flex;
      align-items: flex-end;
      gap: 2px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .hit {
      flex: 1;
      height: 100%;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }
    .bar {
      width: 100%;
      max-width: 24px;
      background: var(--mat-sys-primary);
      border-radius: 4px 4px 0 0;
    }
    .labels {
      display: flex;
      gap: 2px;
    }
    .labels span {
      flex: 1;
      text-align: center;
    }
  `,
})
export class MonthlyBars {
  readonly points = input.required<MonthPoint[]>();
  readonly empty = input.required<string>();

  protected readonly rows = computed(() => this.points().filter((p) => p.value.count > 0));
  private readonly max = computed(() => maxAmount(this.rows().map((r) => r.value)));
  protected readonly ticks = computed(() => [this.max(), this.max() / 2, 0].map((t) => compact.format(t)));
  protected readonly money = formatMoney;

  protected height(r: MonthPoint): number {
    const max = this.max();
    return max > 0 ? Math.max((r.value.amount / max) * 100, 1) : 0;
  }

  protected tooltip(r: MonthPoint): string {
    const head = `${r.month}: ${formatMoney(r.value.amount)} from ${r.value.count} quote${r.value.count === 1 ? '' : 's'}`;
    return `${head}\n${profitLine(r.value)} (before VAT)`;
  }
}
