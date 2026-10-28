import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { isLoss, profitLine, type Measure } from './measures';

/**
 * A labelled headline number; `hero` is the one figure the current view leads with. A tile for a money
 * measure passes it as `profit` to get a second line with its profit and margin (before VAT).
 */
@Component({
  selector: 'app-stat-tile',
  imports: [MatCardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card class="tile">
      <mat-card-content>
        <div class="body2 muted">{{ label() }}</div>
        <div class="value" [class.hero]="hero()">{{ value() }}</div>
        @if (profit()) {
          <div class="body2 profit" [class.loss]="loss()">{{ profitText() }}</div>
        }
        @if (hint(); as h) {
          <div class="caption">{{ h }}</div>
        }
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .tile {
      height: 100%;
    }
    mat-card-content {
      padding-top: 16px !important;
    }
    .value {
      font-weight: 600;
      font-size: 28px;
      line-height: 1.2;
      margin-top: 4px;
      font-variant-numeric: tabular-nums;
    }
    .value.hero {
      font-size: 44px;
    }
    .profit {
      margin-top: 4px;
      color: var(--sq-muted);
      font-variant-numeric: tabular-nums;
    }
    .profit.loss {
      color: var(--sq-error);
    }
    @media (max-width: 899px) {
      .value.hero {
        font-size: 32px;
      }
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input<string>();
  readonly hero = input(false);
  readonly profit = input<Measure>();

  protected readonly profitText = computed(() => {
    const p = this.profit();
    return p ? profitLine(p) : '';
  });
  protected readonly loss = computed(() => {
    const p = this.profit();
    return p ? isLoss(p) : false;
  });
}
