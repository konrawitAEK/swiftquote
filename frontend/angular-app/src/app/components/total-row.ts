import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-total-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span>{{ label() }}</span><span>{{ value() }}</span>`,
  host: { '[class.strong]': 'strong()' },
  styles: `
    :host {
      display: flex;
      justify-content: space-between;
      font-variant-numeric: tabular-nums;
    }
    :host(.strong) {
      font-weight: 700;
    }
  `,
})
export class TotalRow {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly strong = input(false);
}
