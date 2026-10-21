import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, type OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Alert } from '../../components/alert';
import { TotalRow } from '../../components/total-row';
import { ApiService, errorText, type Schemas } from '../../core/api.service';
import { isoDate } from '../../core/format';
import { calculate, formatMoney, toDecimal } from '../../core/pricing';

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
export class QuoteBuilderPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  /** Route parameter; undefined on /quotes/new. */
  readonly id = input<string>();
  protected readonly editing = computed(() => this.id() !== undefined);

  protected readonly clients = signal<Schemas['Client'][]>([]);
  protected readonly categories = signal<Schemas['ProductCategory'][]>([]);
  protected readonly clientId = signal('');
  protected readonly quoteNumber = signal(defaultQuoteNumber());
  protected readonly today = isoDate(new Date());
  protected readonly expiryDate = signal(isoDate(new Date(Date.now() + 30 * 864e5)));
  protected readonly lines = signal<Line[]>([newLine()]);
  protected readonly error = signal<string | null>(null);
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
    effect(() => {
      const id = this.id();
      if (id) untracked(() => void this.loadQuote(id));
    });
  }

  ngOnInit(): void {
    this.api
      .listCategories()
      .then((data) => this.categories.set(data))
      .catch((err: unknown) => this.error.set(errorText(err, 'Could not load product categories')));
    this.api
      .listClients()
      .then((data) => {
        this.clients.set(data);
        if (!this.editing() && data.length === 1) this.clientId.set(data[0].id);
      })
      .catch((err: unknown) => this.error.set(errorText(err, 'Could not load clients')));
  }

  private async loadQuote(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.api.getQuote(id);
      this.locked.set(
        data.status !== 'draft'
          ? `This quotation is ${data.status.replace('_', ' ')} and can no longer be edited.`
          : null,
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
    } catch (err) {
      this.error.set(errorText(err, 'Could not load quotation'));
    } finally {
      this.loading.set(false);
    }
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

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.busy.set(true);
    this.error.set(null);
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
    try {
      const id = this.id();
      const data = id ? await this.api.updateQuote(id, body) : await this.api.createQuote(body);
      await this.router.navigate(['/quotes', data.id]);
    } catch (err) {
      this.error.set(errorText(err, 'Could not save quotation'));
    } finally {
      this.busy.set(false);
    }
  }
}
