import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { finalize } from 'rxjs';
import { Alert } from '../../components/alert';
import { SignaturePad } from '../../components/signature-pad';
import { errorText, type Schemas } from '../../core/api';
import { formatDateTime } from '../../core/format';
import { formatMoney } from '../../core/pricing';
import { PublicQuoteService } from '../../services/public-quote.service';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; quote: Schemas['PublicQuoteView'] };

const OFFLINE = 'Cannot reach the server. Please try again.';

/** Client portal: no login, addressed by the quote's access token. */
@Component({
  selector: 'app-public-quote-page',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    Alert,
    SignaturePad,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './public-quote-page.html',
  styleUrl: './public-quote-page.scss',
})
export class PublicQuotePage {
  private readonly publicApi = inject(PublicQuoteService);
  private readonly destroyRef = inject(DestroyRef);

  /** Route parameter. */
  readonly accessToken = input.required<string>();

  /** The quote for the link's access token; a decline updates it locally. */
  private readonly quoteRes = rxResource({
    params: () => ({ token: this.accessToken() }),
    stream: ({ params }) => this.publicApi.get(params.token),
  });
  protected readonly state = computed<LoadState>(() => {
    const err = this.quoteRes.error();
    if (err) {
      return {
        kind: 'error',
        message: errorText(err, 'Something went wrong', 'Cannot reach the server. Please try again later.'),
      };
    }
    return this.quoteRes.hasValue() ? { kind: 'ready', quote: this.quoteRes.value() } : { kind: 'loading' };
  });
  protected readonly signerName = signal('');
  protected readonly signature = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly acceptedAt = signal<string | null>(null);
  protected readonly declining = signal(false);
  protected readonly declineReason = signal('');

  protected readonly money = formatMoney;
  protected readonly when = formatDateTime;
  protected readonly valueOf = (e: Event) => (e.target as HTMLInputElement | HTMLTextAreaElement).value;

  protected decline(): void {
    this.busy.set(true);
    this.submitError.set(null);
    this.publicApi
      .reject(this.accessToken(), this.declineReason().trim() || null)
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.declining.set(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.quoteRes.update((quote) => quote && { ...quote, status: 'rejected' }),
        error: (err: unknown) => this.submitError.set(errorText(err, 'Could not decline this quotation', OFFLINE)),
      });
  }

  protected accept(e: Event): void {
    e.preventDefault();
    const signature = this.signature();
    if (!signature) {
      this.submitError.set('Please sign in the box above.');
      return;
    }
    this.busy.set(true);
    this.submitError.set(null);
    this.publicApi
      .accept(this.accessToken(), { signerName: this.signerName(), signatureDataUrl: signature })
      .pipe(
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => this.acceptedAt.set(data.signedAt ?? new Date().toISOString()),
        error: (err: unknown) => this.submitError.set(errorText(err, 'Could not accept this quotation', OFFLINE)),
      });
  }
}
