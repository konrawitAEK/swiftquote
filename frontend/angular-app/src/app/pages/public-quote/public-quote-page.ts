import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Alert } from '../../components/alert';
import { SignaturePad } from '../../components/signature-pad';
import { ApiService, errorText, type Schemas } from '../../core/api.service';
import { formatDateTime } from '../../core/format';
import { formatMoney } from '../../core/pricing';

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
  private readonly api = inject(ApiService);

  /** Route parameter. */
  readonly accessToken = input.required<string>();

  protected readonly state = signal<LoadState>({ kind: 'loading' });
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

  constructor() {
    effect(() => {
      const token = this.accessToken();
      this.api
        .getPublicQuote(token)
        .then((quote) => this.state.set({ kind: 'ready', quote }))
        .catch((err: unknown) =>
          this.state.set({
            kind: 'error',
            message: errorText(err, 'Something went wrong', 'Cannot reach the server. Please try again later.'),
          }),
        );
    });
  }

  protected async decline(): Promise<void> {
    this.busy.set(true);
    this.submitError.set(null);
    try {
      await this.api.rejectPublicQuote(this.accessToken(), { comment: this.declineReason().trim() || null });
      const state = this.state();
      if (state.kind === 'ready') this.state.set({ kind: 'ready', quote: { ...state.quote, status: 'rejected' } });
    } catch (err) {
      this.submitError.set(errorText(err, 'Could not decline this quotation', OFFLINE));
    } finally {
      this.busy.set(false);
      this.declining.set(false);
    }
  }

  protected async accept(e: Event): Promise<void> {
    e.preventDefault();
    const signature = this.signature();
    if (!signature) {
      this.submitError.set('Please sign in the box above.');
      return;
    }
    this.busy.set(true);
    this.submitError.set(null);
    try {
      const data = await this.api.acceptPublicQuote(this.accessToken(), {
        signerName: this.signerName(),
        signatureDataUrl: signature,
      });
      this.acceptedAt.set(data.signedAt ?? new Date().toISOString());
    } catch (err) {
      this.submitError.set(errorText(err, 'Could not accept this quotation', OFFLINE));
    } finally {
      this.busy.set(false);
    }
  }
}
