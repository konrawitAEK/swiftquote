import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { finalize, from, switchMap, type Subscription } from 'rxjs';
import { Alert } from '../../components/alert';
import { TotalRow } from '../../components/total-row';
import { errorText, type QuoteDetail, type Schemas } from '../../core/api';
import { isoDate } from '../../core/format';
import { calculate, formatMoney, toDecimal } from '../../core/pricing';
import { QuoteBuilderService } from '../../services/quote-builder.service';

interface Line {
  key: number;
  title: string;
  categoryId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
}

type LineField = keyof Omit<Line, 'key'>;

let nextKey = 1;
const newLine = (): Line => ({
  key: nextKey++,
  title: '',
  categoryId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountPercent: '0',
  taxPercent: '7',
});

function defaultQuoteNumber(): string {
  const stamp = isoDate(new Date()).replaceAll('-', '');
  return `Q-${stamp}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

const loadError = (err: Error | undefined, fallback: string) => (err ? errorText(err, fallback) : null);

/** Text of the input or select that fired an event. */
function valueOf(e: Event): string {
  return (e.target as HTMLInputElement | HTMLSelectElement).value;
}

/** Creates a draft (/quotes/new) or edits one (/quotes/:id/edit). Only RMs reach this page. */
@Component({
  selector: 'app-quote-builder-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
    Alert,
    TotalRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-builder-page.html',
  styleUrl: './quote-builder-page.scss',
})
export class QuoteBuilderPage {
  private readonly builderApi = inject(QuoteBuilderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  /** Route parameter; undefined on /quotes/new. */
  readonly id = input<string>();
  protected readonly editing = computed(() => this.id() !== undefined);

  private readonly categoriesRes = rxResource({ stream: () => this.builderApi.categories() });
  private readonly clientsRes = rxResource({ stream: () => this.builderApi.clients() });
  protected readonly categories = computed(() => (this.categoriesRes.hasValue() ? this.categoriesRes.value() : []));
  protected readonly clients = computed(() => (this.clientsRes.hasValue() ? this.clientsRes.value() : []));
  /** A new quote with only one client to choose from starts with that client. */
  protected readonly clientId = linkedSignal<Schemas['Client'][], string>({
    source: this.clients,
    computation: (clients, previous) =>
      !this.editing() && clients.length === 1 ? clients[0].id : (previous?.value ?? ''),
  });
  protected readonly quoteNumber = signal(defaultQuoteNumber());
  protected readonly today = isoDate(new Date());
  protected readonly expiryDate = signal(isoDate(new Date(Date.now() + 30 * 864e5)));
  protected readonly lines = signal<Line[]>([newLine()]);
  /** Quote load and save failures; reference-data failures come from the resources. */
  private readonly formError = signal<string | null>(null);
  protected readonly error = computed(
    () =>
      this.formError() ??
      loadError(this.categoriesRes.error(), 'Could not load product categories') ??
      loadError(this.clientsRes.error(), 'Could not load clients'),
  );
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly locked = signal<string | null>(null);

  /** Live totals: recalculated whenever any line changes, with the server's rounding rules. */
  protected readonly totals = computed(() =>
    calculate(
      this.lines().map((l) => ({
        quantity: toDecimal(l.quantity),
        unitPrice: toDecimal(l.unitPrice),
        discountPercent: toDecimal(l.discountPercent),
        taxPercent: toDecimal(l.taxPercent),
      })),
    ),
  );

  protected readonly heading = computed(() => (this.editing() ? `Edit ${this.quoteNumber()}` : 'New quotation'));
  protected readonly money = formatMoney;
  protected readonly valueOf = valueOf;

  constructor() {
    // Editing: load the draft once and copy it into the form's signals.
    effect((onCleanup) => {
      const id = this.id();
      if (!id) return;
      const sub = untracked(() => this.loadQuote(id));
      onCleanup(() => sub.unsubscribe());
    });
  }

  private loadQuote(id: string): Subscription {
    this.loading.set(true);
    return this.builderApi
      .get(id)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (data) => this.fill(data),
        error: (err: unknown) => this.formError.set(errorText(err, 'Could not load quotation')),
      });
  }

  private fill(data: QuoteDetail): void {
    this.locked.set(
      data.status !== 'draft' ? `This quotation is ${data.status.replace('_', ' ')} and can no longer be edited.` : null,
    );
    this.clientId.set(data.clientId);
    this.quoteNumber.set(data.quoteNumber);
    this.expiryDate.set(data.expiryDate);
    this.lines.set(
      data.items.map((it) => ({
        key: nextKey++,
        title: it.title,
        categoryId: it.category?.id ?? '',
        description: it.description ?? '',
        quantity: String(it.quantity),
        unitPrice: String(it.unitPrice),
        discountPercent: String(it.discountPercent),
        taxPercent: String(it.taxPercent),
      })),
    );
  }

  /** Active categories, plus the line's current one if it has been retired since. */
  protected categoryOptions(current: string): Schemas['ProductCategory'][] {
    return this.categories().filter((c) => c.active || c.id === current);
  }

  protected update(key: number, field: LineField, value: string): void {
    this.lines.update((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  }

  protected addLine(): void {
    this.lines.update((ls) => [...ls, newLine()]);
  }

  protected removeLine(key: number): void {
    this.lines.update((ls) => ls.filter((l) => l.key !== key));
  }

  protected submit(e: Event): void {
    e.preventDefault();
    this.busy.set(true);
    this.formError.set(null);
    const body: Schemas['CreateQuoteRequest'] = {
      clientId: this.clientId(),
      quoteNumber: this.quoteNumber(),
      expiryDate: this.expiryDate(),
      items: this.lines().map((l) => ({
        title: l.title,
        categoryId: l.categoryId,
        ...(l.description.trim() ? { description: l.description } : {}),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPercent: Number(l.discountPercent || 0),
        taxPercent: Number(l.taxPercent || 0),
      })),
    };
    const id = this.id();
    const save = id ? this.builderApi.update(id, body) : this.builderApi.create(body);
    save
      .pipe(
        switchMap((data) => from(this.router.navigate(['/quotes', data.id]))),
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({ error: (err: unknown) => this.formError.set(errorText(err, 'Could not save quotation')) });
  }
}
