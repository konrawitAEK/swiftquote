import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { formatDateTime } from '../../core/format';
import type { QuoteEvent } from '../../models';


const LABELS: Record<QuoteEvent['action'], string> = {
  created: 'Created',
  updated: 'Edited',
  submitted: 'Submitted for approval',
  approved: 'Approved',
  returned: 'Returned for changes',
  sent: 'Sent to customer',
  viewed: 'Viewed',
  accepted: 'Accepted',
  rejected: 'Declined',
};

const DOT: Partial<Record<QuoteEvent['action'], string>> = {
  approved: 'var(--sq-success)',
  accepted: 'var(--sq-success)',
  returned: 'var(--sq-warning)',
  rejected: 'var(--sq-error)',
};

/** Oldest-first audit trail of a quotation. */
@Component({
  selector: 'app-quote-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (events().length === 0) {
      <p class="body2 muted">No history yet.</p>
    } @else {
      <ol>
        @for (e of events(); track $index) {
          <li>
            <span class="dot" [style.background]="dot(e)"></span>
            <div>
              <div class="body2">
                <strong>{{ label(e) }}</strong>{{ who(e) }}
              </div>
              <div class="caption">{{ when(e.at) }}</div>
              @if (e.comment) {
                <div class="body2 comment">{{ e.comment }}</div>
              }
            </div>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    ol {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    li {
      display: flex;
      gap: 12px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-top: 6px;
      flex-shrink: 0;
    }
    .comment {
      margin-top: 4px;
      padding-left: 12px;
      border-left: 2px solid var(--mat-sys-outline-variant);
      white-space: pre-wrap;
    }
    p {
      margin: 0;
    }
  `,
})
export class QuoteHistory {
  readonly events = input.required<QuoteEvent[]>();

  protected label(e: QuoteEvent): string {
    return LABELS[e.action];
  }

  protected who(e: QuoteEvent): string {
    if (e.actor) return ` by ${e.actor.name}`;
    return e.action === 'viewed' || e.action === 'accepted' || e.action === 'rejected' ? ' via link' : '';
  }

  protected dot(e: QuoteEvent): string {
    return DOT[e.action] ?? 'var(--mat-sys-primary)';
  }

  protected readonly when = formatDateTime;
}
