import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { Alert } from '../../components/alert';
import { StatusChip } from '../../components/status-chip';
import { errorText, type QuoteStatus, type Role } from '../../core/api';
import { AuthService } from '../../services/auth.service';
import { formatMoney } from '../../core/pricing';
import { STATUS_LABELS } from '../../core/roles';
import { QuotesService } from '../../services/quotes.service';

const STATUSES: QuoteStatus[] = ['draft', 'pending_approval', 'approved', 'sent', 'viewed', 'accepted', 'rejected'];
const CUSTOMER_STATUSES: QuoteStatus[] = ['sent', 'viewed', 'accepted', 'rejected'];

const TITLES: Record<Role, string> = {
  rm: 'My quotations',
  wo: 'Team quotations',
  woc: 'All quotations',
  customer: 'My quotations',
  admin: 'Quotations',
};

@Component({
  selector: 'app-quotes-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatSelectModule,
    Alert,
    StatusChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack-lg">
      <div class="spread">
        <h1 class="page-title">{{ title() }}</h1>
        <div class="row controls">
          <mat-form-field class="dense status">
            <mat-label>Status</mat-label>
            <mat-select [value]="status()" (valueChange)="setStatus($event)">
              <mat-option value="">All</mat-option>
              @for (s of statuses(); track s) {
                <mat-option [value]="s">{{ statusLabels[s] }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          @if (role() === 'rm') {
            <a mat-flat-button routerLink="/quotes/new"><mat-icon>add</mat-icon>New quote</a>
          }
        </div>
      </div>

      @if (error(); as e) {
        <app-alert severity="error">{{ e }}</app-alert>
      }

      <mat-card>
        @if (quotes() === null && !error()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Client</th>
                @if (showCreator()) {
                  <th>Created by</th>
                }
                <th>Status</th>
                <th>Expires</th>
                <th class="right">Grand total</th>
              </tr>
            </thead>
            <tbody>
              @for (q of quotes() ?? []; track q.id) {
                <tr class="clickable" (click)="open(q.id)">
                  <td class="number">
                    <a [routerLink]="['/quotes', q.id]" (click)="$event.stopPropagation()">{{ q.quoteNumber }}</a>
                  </td>
                  <td>{{ q.clientName }}</td>
                  @if (showCreator()) {
                    <td>{{ q.createdBy?.name ?? '—' }}</td>
                  }
                  <td><app-status-chip [status]="q.status" /></td>
                  <td>{{ q.expiryDate }}</td>
                  <td class="right">{{ money(q.grandTotal) }}</td>
                </tr>
              }
              @if (quotes()?.length === 0) {
                <tr>
                  <td [attr.colspan]="showCreator() ? 6 : 5" class="empty pad">
                    {{ role() === 'rm' ? 'No quotations yet. Create one to get started.' : 'No quotations to show.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </mat-card>
    </div>
  `,
  styles: `
    .controls {
      gap: 16px;
      align-items: center;
    }
    .status {
      min-width: 160px;
    }
    .number {
      font-weight: 500;
    }
    .number a {
      color: inherit;
      text-decoration: none;
    }
    .pad {
      padding: 32px 16px !important;
    }
  `,
})
export class QuotesPage {
  private readonly quotesApi = inject(QuotesService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly role = computed<Role>(() => this.auth.user()?.role ?? 'rm');
  protected readonly title = computed(() => TITLES[this.role()]);
  protected readonly showCreator = computed(() => this.role() === 'wo' || this.role() === 'woc');
  protected readonly statuses = computed(() => (this.role() === 'customer' ? CUSTOMER_STATUSES : STATUSES));
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly money = formatMoney;

  protected readonly status = signal<QuoteStatus | ''>('');
  /** Reloads whenever the status filter changes; a newer request cancels a slower older one. */
  private readonly list = rxResource({
    params: () => ({ status: this.status() }),
    stream: ({ params }) => this.quotesApi.list(params.status || undefined),
  });
  /** null while loading; empty after a failed load. */
  protected readonly quotes = computed(() => {
    if (this.list.status() === 'error') return [];
    return this.list.hasValue() ? this.list.value() : null;
  });
  protected readonly error = computed(() => {
    const err = this.list.error();
    return err ? errorText(err, 'Could not load quotes') : null;
  });

  protected setStatus(value: QuoteStatus | ''): void {
    this.status.set(value);
  }

  protected open(id: string): void {
    void this.router.navigate(['/quotes', id]);
  }
}
