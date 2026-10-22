import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { QuoteStatus } from '../core/api';
import { STATUS_LABELS } from '../core/roles';

/** Small coloured pill for a quote status. */
@Component({
  selector: 'app-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="chip" [class]="'s-' + status()">{{ label() }}</span>`,
  styles: `
    .chip {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 10px;
      border-radius: 12px;
      font: var(--mat-sys-label-medium);
      white-space: nowrap;
      color: #fff;
    }
    .s-draft,
    .s-expired {
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface);
    }
    .s-pending_approval {
      background: var(--sq-warning);
    }
    .s-approved {
      background: var(--sq-secondary);
    }
    .s-sent {
      background: var(--sq-info);
    }
    .s-viewed {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    .s-accepted {
      background: var(--sq-success);
    }
    .s-rejected {
      background: var(--sq-error);
    }
  `,
})
export class StatusChip {
  readonly status = input.required<QuoteStatus>();
  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
}
