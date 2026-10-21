import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { InlineBar } from './inline-bar';
import { byAmount, maxAmount, MEASURE_LABELS, type MeasureKey, type Summary } from './measures';

/** RM and team rankings for the selected measure. */
@Component({
  selector: 'app-rank-tables',
  imports: [MatCardModule, InlineBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card>
      <mat-card-content class="head"><h2 class="section-title">By RM</h2></mat-card-content>
      <div class="table-wrap">
        <table class="data-table small">
          <thead>
            <tr>
              <th>RM</th>
              <th>Team</th>
              <th class="right">Quotes</th>
              <th class="right">Sent</th>
              <th class="right">{{ measure() === 'won' ? 'Won' : 'Waiting' }}</th>
              <th>{{ label() }}</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rms(); track r.user.id) {
              <tr>
                <td>{{ r.user.name }}</td>
                <td>{{ r.team ?? '—' }}</td>
                <td class="right">{{ r.quoteCount }}</td>
                <td class="right">{{ r.sentCount }}</td>
                <td class="right">{{ r[measure()].count }}</td>
                <td class="bar-cell rm"><app-inline-bar [value]="r[measure()].amount" [max]="rmMax()" /></td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty">Nothing in this period.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </mat-card>
    <mat-card>
      <mat-card-content class="head"><h2 class="section-title">By team</h2></mat-card-content>
      <div class="table-wrap">
        <table class="data-table small">
          <thead>
            <tr>
              <th>Team</th>
              <th class="right">Quotes</th>
              <th>{{ label() }}</th>
            </tr>
          </thead>
          <tbody>
            @for (t of teams(); track t.id) {
              <tr>
                <td>{{ t.name }}</td>
                <td class="right">{{ t[measure()].count }}</td>
                <td class="bar-cell team"><app-inline-bar [value]="t[measure()].amount" [max]="teamMax()" /></td>
              </tr>
            } @empty {
              <tr><td colspan="3" class="empty">Nothing in this period.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </mat-card>
  `,
  styles: `
    :host {
      display: grid;
      gap: 16px;
      grid-template-columns: 3fr 2fr;
      align-items: start;
    }
    @media (max-width: 899px) {
      :host {
        grid-template-columns: 1fr;
      }
    }
    .head {
      padding-top: 16px !important;
    }
    .rm {
      min-width: 200px;
    }
    .team {
      min-width: 180px;
    }
  `,
})
export class RankTables {
  readonly data = input.required<Summary>();
  readonly measure = input.required<MeasureKey>();

  protected readonly rms = computed(() => byAmount(this.data().byRm, this.measure()));
  protected readonly teams = computed(() => byAmount(this.data().byTeam, this.measure()));
  protected readonly rmMax = computed(() => maxAmount(this.rms().map((r) => r[this.measure()])));
  protected readonly teamMax = computed(() => maxAmount(this.teams().map((t) => t[this.measure()])));
  protected readonly label = computed(() => MEASURE_LABELS[this.measure()]);
}
