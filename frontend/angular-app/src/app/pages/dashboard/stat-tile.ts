import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

/** A labelled headline number; `hero` is the one figure the current view leads with. */
@Component({
  selector: 'app-stat-tile',
  imports: [MatCardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card class="tile">
      <mat-card-content>
        <div class="body2 muted">{{ label() }}</div>
        <div class="value" [class.hero]="hero()">{{ value() }}</div>
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
}
