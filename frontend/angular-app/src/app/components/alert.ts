import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type Severity = 'error' | 'warning' | 'info' | 'success';

const ICONS: Record<Severity, string> = {
  error: 'error_outline',
  warning: 'report_problem',
  info: 'info_outline',
  success: 'check_circle_outline',
};

/** MUI-style alert banner. Project an element with [alertAction] for a trailing action. */
@Component({
  selector: 'app-alert',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'alert', '[class]': '"sev-" + severity()' },
  template: `
    <mat-icon class="icon">{{ iconName() }}</mat-icon>
    <div class="msg"><ng-content /></div>
    <div class="action"><ng-content select="[alertAction]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 6px 16px;
      border-radius: 8px;
      font: var(--mat-sys-body-medium);
      --c: var(--sq-info);
      background: color-mix(in srgb, var(--c) 12%, var(--mat-sys-surface));
      color: color-mix(in srgb, var(--c) 70%, var(--mat-sys-on-surface));
    }
    :host(.sev-error) {
      --c: var(--sq-error);
    }
    :host(.sev-warning) {
      --c: var(--sq-warning);
    }
    :host(.sev-success) {
      --c: var(--sq-success);
    }
    .icon {
      color: var(--c);
      padding: 7px 0;
      font-size: 22px;
      width: 22px;
      height: 22px;
    }
    .msg {
      padding: 8px 0;
      flex: 1;
      white-space: pre-wrap;
    }
    .action {
      align-self: center;
    }
    .action:empty {
      display: none;
    }
  `,
})
export class Alert {
  readonly severity = input<Severity>('info');
  /** Overrides the severity's default icon. */
  readonly icon = input<string>();
  protected readonly iconName = computed(() => this.icon() ?? ICONS[this.severity()]);
}
