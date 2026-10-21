import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Alert } from '../../components/alert';
import { StatusChip } from '../../components/status-chip';
import { ApiService, errorText } from '../../core/api.service';
import { formatMoney } from '../../core/pricing';
import { CategoryBreakdown } from './category-breakdown';
import type { MeasureKey, Summary, View } from './measures';
import { MonthlyBars, type MonthPoint } from './monthly-bars';
import { RankTables } from './rank-tables';
import { StatTile } from './stat-tile';

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

interface Tile {
  label: string;
  value: string;
  hint?: string;
  hero?: boolean;
}

/** The headline figures for each view. */
function tilesFor(data: Summary, view: View, measure: MeasureKey): Tile[] {
  if (view === 'pending') {
    const n = data.inApproval.count;
    return [
      { label: 'Waiting on customers', value: formatMoney(data.pending.amount), hero: true },
      { label: 'Quotes waiting', value: String(data.pending.count), hint: 'sent or viewed, not expired' },
      {
        label: 'In internal approval',
        value: formatMoney(data.inApproval.amount),
        hint: `${n} ${n === 1 ? 'quote' : 'quotes'} not yet sent`,
      },
      { label: 'Sold so far', value: formatMoney(data.won.amount) },
    ];
  }
  if (view === 'category') {
    const rows = data.byCategory.filter((r) => r[measure].count > 0);
    const top = [...rows].sort((a, b) => b[measure].amount - a[measure].amount)[0];
    return [
      { label: measure === 'won' ? 'Sold' : 'Waiting on customers', value: formatMoney(data[measure].amount), hero: true },
      { label: 'Top category', value: top ? (top.category?.name ?? 'Uncategorized') : '—' },
      { label: 'Top category amount', value: top ? formatMoney(top[measure].amount) : '—' },
      { label: 'Categories', value: String(rows.length), hint: 'with lines in this view' },
    ];
  }
  return [
    { label: 'Sold', value: formatMoney(data.won.amount), hero: true },
    { label: 'Quotes won', value: String(data.won.count) },
    { label: 'Quotes sent', value: String(data.sentCount) },
    { label: 'Conversion', value: percent.format(data.conversionRate), hint: 'won ÷ sent' },
  ];
}

/** Sales summary for WOC: sold, waiting on customers, or by product category. */
@Component({
  selector: 'app-dashboard-page',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    Alert,
    StatusChip,
    CategoryBreakdown,
    MonthlyBars,
    RankTables,
    StatTile,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  private readonly api = inject(ApiService);

  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly view = signal<View>('won');
  protected readonly categoryMeasure = signal<MeasureKey>('won');
  protected readonly data = signal<Summary | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly measure = computed<MeasureKey>(() => {
    const view = this.view();
    return view === 'category' ? this.categoryMeasure() : view;
  });

  protected readonly tiles = computed(() => {
    const data = this.data();
    return data ? tilesFor(data, this.view(), this.measure()) : [];
  });

  protected readonly monthPoints = computed<MonthPoint[]>(() => {
    const data = this.data();
    const key = this.measure();
    return data ? data.byMonth.map((m) => ({ month: m.month, value: m[key] })) : [];
  });

  protected readonly pipeline = computed(() => this.data()?.byStatus.filter((s) => s.status !== 'expired') ?? []);

  constructor() {
    // Refetch when the period changes; switching views reuses the same summary.
    effect((onCleanup) => {
      const from = this.from();
      const to = this.to();
      let cancelled = false;
      onCleanup(() => (cancelled = true));
      this.api
        .dashboardSummary(from, to)
        .then((data) => {
          if (cancelled) return;
          this.data.set(data);
          this.error.set(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          this.data.set(null);
          this.error.set(errorText(err, 'Could not load the dashboard'));
        });
    });
  }

  protected setView(value: View | null): void {
    if (value) this.view.set(value);
  }

  protected setCategoryMeasure(value: MeasureKey | null): void {
    if (value) this.categoryMeasure.set(value);
  }

  protected dateValue(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected allTime(): void {
    this.from.set('');
    this.to.set('');
  }
}
