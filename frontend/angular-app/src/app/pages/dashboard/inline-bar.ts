import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatMoney } from '../../core/pricing';

/** Value text plus a thin bar scaled to the column maximum; the text carries the value, the bar the comparison. */
@Component({
  selector: 'app-inline-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="track"><span class="fill" [style.width.%]="percent()"></span></span>
    <span class="text">{{ text() }}</span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .track {
      flex: 1;
      height: 8px;
      background: var(--mat-sys-surface-container-high);
      border-radius: 0 4px 4px 0;
    }
    .fill {
      display: block;
      height: 100%;
      background: var(--mat-sys-primary);
      border-radius: 0 4px 4px 0;
    }
    .text {
      min-width: 104px;
      text-align: right;
      font: var(--mat-sys-body-medium);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class InlineBar {
  readonly value = input.required<number>();
  readonly max = input.required<number>();
  protected readonly percent = computed(() => (this.max() > 0 ? (this.value() / this.max()) * 100 : 0));
  protected readonly text = computed(() => formatMoney(this.value()));
}
