import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { Alert } from '../../components/alert';
import { StatusChip } from '../../components/status-chip';
import { TotalRow } from '../../components/total-row';
import { ApiService, errorText, type QuoteDetail, type Role, type Schemas } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { formatDateTime } from '../../core/format';
import { formatMoney } from '../../core/pricing';
import { SENT_STATUSES } from '../../core/roles';
import { AcceptCard } from './accept-card';
import { CommentDialog, DIALOGS, type CommentDialogData, type DialogSpec } from './comment-dialog';
import { QuoteHistory } from './quote-history';
import { ShareLink } from './share-link';
import { shareUrl } from './share-url';

/** Which workflow actions a role may take on a quote in its current status. */
function availableActions(role: Role, q: QuoteDetail) {
  return {
    edit: role === 'rm' && q.status === 'draft',
    submit: role === 'rm' && q.status === 'draft',
    approve: role === 'wo' && q.status === 'pending_approval',
    return: role === 'wo' && q.status === 'pending_approval',
    send: role === 'rm' && q.status === 'approved',
    respond: role === 'customer' && (q.status === 'sent' || q.status === 'viewed'),
  };
}

@Component({
  selector: 'app-quote-detail-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    Alert,
    StatusChip,
    TotalRow,
    AcceptCard,
    QuoteHistory,
    ShareLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-detail-page.html',
  styleUrl: './quote-detail-page.scss',
})
export class QuoteDetailPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);

  /** Route parameter. */
  readonly id = input.required<string>();

  protected readonly role = computed<Role>(() => this.auth.user()?.role ?? 'rm');
  protected readonly quote = signal<QuoteDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly can = computed(() => {
    const q = this.quote();
    return q ? availableActions(this.role(), q) : null;
  });
  protected readonly shareToken = computed(() => {
    const q = this.quote();
    return q && this.role() !== 'customer' && SENT_STATUSES.includes(q.status) && q.accessToken ? q.accessToken : null;
  });

  protected readonly dialogs = DIALOGS;
  protected readonly money = formatMoney;
  protected readonly when = formatDateTime;
  protected readonly shareUrl = shareUrl;

  constructor() {
    effect((onCleanup) => {
      const id = this.id();
      let cancelled = false;
      onCleanup(() => (cancelled = true));
      this.quote.set(null);
      this.error.set(null);
      this.api
        .getQuote(id)
        .then((data) => !cancelled && this.quote.set(data))
        .catch((err: unknown) => !cancelled && this.error.set(errorText(err, 'Could not load quotation')));
    });
  }

  /** Runs a workflow call and shows the updated quote; resolves to the error message, or null. */
  private async run(call: () => Promise<QuoteDetail>): Promise<string | null> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.quote.set(await call());
      return null;
    } catch (err) {
      const message = errorText(err, 'Action failed');
      this.actionError.set(message);
      return message;
    } finally {
      this.busy.set(false);
    }
  }

  protected openDialog(spec: DialogSpec): void {
    const data: CommentDialogData = {
      spec,
      run: (comment) => this.run(() => this.api.commentAction(this.id(), spec.action, { comment })),
    };
    this.dialog.open(CommentDialog, { data, width: '600px', maxWidth: '95vw' });
  }

  protected send(): void {
    void this.run(() => this.api.sendQuote(this.id()));
  }

  protected accept(body: Schemas['AcceptQuoteRequest']): void {
    void this.run(() => this.api.acceptQuote(this.id(), body));
  }

  protected discount(percent: number): string {
    return Number(percent) ? `${percent}%` : '—';
  }
}
