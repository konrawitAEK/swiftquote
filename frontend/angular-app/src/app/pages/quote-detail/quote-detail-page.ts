import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { catchError, defer, finalize, map, of, type Observable } from 'rxjs';
import { Alert } from '../../components/alert';
import { StatusChip } from '../../components/status-chip';
import { TotalRow } from '../../components/total-row';
import { errorText, type QuoteDetail, type Role, type Schemas } from '../../core/api';
import { AuthService } from '../../services/auth.service';
import { formatDateTime } from '../../core/format';
import { formatMoney } from '../../core/pricing';
import { SENT_STATUSES } from '../../core/roles';
import { AcceptCard } from './accept-card';
import { CommentDialog, DIALOGS, type CommentDialogData, type DialogSpec } from './comment-dialog';
import { QuoteDetailService } from '../../services/quote-detail.service';
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
  private readonly quoteApi = inject(QuoteDetailService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);

  /** Route parameter. */
  readonly id = input.required<string>();

  protected readonly role = computed<Role>(() => this.auth.user()?.role ?? 'rm');
  /** Loads the quote for the route's id; workflow calls overwrite it locally with the server's reply. */
  private readonly quoteRes = rxResource({
    params: () => ({ id: this.id() }),
    stream: ({ params }) => this.quoteApi.get(params.id),
  });
  protected readonly quote = computed(() => (this.quoteRes.hasValue() ? this.quoteRes.value() : null));
  protected readonly error = computed(() => {
    const err = this.quoteRes.error();
    return err ? errorText(err, 'Could not load quotation') : null;
  });
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

  /**
   * Runs a workflow call and shows the updated quote. Emits the error message, or null on success;
   * the call starts on subscribe.
   */
  private run(call: Observable<QuoteDetail>): Observable<string | null> {
    return defer(() => {
      this.busy.set(true);
      this.actionError.set(null);
      return call;
    }).pipe(
      map((updated) => {
        this.quoteRes.set(updated);
        return null;
      }),
      catchError((err: unknown) => {
        const message = errorText(err, 'Action failed');
        this.actionError.set(message);
        return of(message);
      }),
      finalize(() => this.busy.set(false)),
    );
  }

  protected openDialog(spec: DialogSpec): void {
    const data: CommentDialogData = {
      spec,
      run: (comment) =>
        this.run(this.quoteApi.commentAction(this.id(), spec.action, comment)).pipe(takeUntilDestroyed(this.destroyRef)),
    };
    this.dialog.open(CommentDialog, { data, width: '600px', maxWidth: '95vw' });
  }

  protected send(): void {
    this.run(this.quoteApi.send(this.id())).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  protected accept(body: Schemas['AcceptQuoteRequest']): void {
    this.run(this.quoteApi.accept(this.id(), body)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  protected discount(percent: number): string {
    return Number(percent) ? `${percent}%` : '—';
  }
}
