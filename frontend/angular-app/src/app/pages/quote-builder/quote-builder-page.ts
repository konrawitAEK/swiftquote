import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, from, switchMap, type Subscription } from 'rxjs';
import { Alert } from '../../components/alert';
import { TotalRow } from '../../components/total-row';
import { errorBody, errorText } from '../../core/api';
import { isoDate } from '../../core/format';
import { calculate, discountError, formatMoney, formatOptionalMoney, toDecimal, type PricingItem } from '../../core/pricing';
import { QuoteBuilderService } from '../../services/quote-builder.service';
import type { Client, CreateQuoteRequest, DiscountType, Product, QuoteDetail, QuoteItemInput } from '../../models';

interface Line {
  key: number;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountType: DiscountType;
  discountValue: string;
  taxPercent: string;
  /** Unit cost saved on a loaded line; used when its product is not in the product list. */
  savedUnitCost: number | null;
}

type LineField = 'description' | 'quantity' | 'unitPrice' | 'discountValue' | 'taxPercent';

let nextKey = 1;
const newLine = (): Line => ({
  key: nextKey++,
  productId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountType: 'percent',
  discountValue: '0',
  taxPercent: '7',
  savedUnitCost: null,
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

/** A 400 detail about one line: "items[2].productId is required" or "items[2]: quantity must be at least 1". */
const LINE_DETAIL = /^items\[(\d+)\](?:\.|:\s*)(.+)$/;

/** Stock, rounded to 2 places without trailing zeros, like the API's stock messages. */
const stockText = (stock: number) => String(Number(stock.toFixed(2)));

/** Option text of the product picker: name, price and stock. */
function productLabel(p: Product): string {
  const stock = p.stock === null ? 'stock not tracked' : `${stockText(p.stock)} in stock`;
  return `${p.name}${p.active ? '' : ' (retired)'} — ${formatMoney(p.unitPrice)} · ${stock}`;
}

/** Creates a draft (/quotes/new) or edits one (/quotes/:id/edit). Only RMs reach this page. */
@Component({
  selector: 'app-quote-builder-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
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

  /**
   * The :id path parameter; undefined on /quotes/new. Read from the route itself rather than an input(), because
   * input binding also maps query params, and /quotes/new?id=... must not turn into an edit.
   */
  protected readonly id = signal(inject(ActivatedRoute).snapshot.paramMap.get('id') ?? undefined);
  protected readonly editing = computed(() => this.id() !== undefined);

  private readonly productsRes = rxResource({ stream: () => this.builderApi.products() });
  private readonly clientsRes = rxResource({ stream: () => this.builderApi.clients() });
  protected readonly products = computed(() => (this.productsRes.hasValue() ? this.productsRes.value() : []));
  private readonly productsById = computed(() => new Map(this.products().map((p) => [p.id, p])));
  protected readonly clients = computed(() => (this.clientsRes.hasValue() ? this.clientsRes.value() : []));
  /** A new quote with only one client to choose from starts with that client. */
  protected readonly clientId = linkedSignal<Client[], string>({
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
  /** The API's 400 details for each line, by line key, from the last save. */
  protected readonly lineErrors = signal<ReadonlyMap<number, string[]>>(new Map());
  protected readonly error = computed(
    () =>
      this.formError() ??
      loadError(this.productsRes.error(), 'Could not load products') ??
      loadError(this.clientsRes.error(), 'Could not load clients'),
  );
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly locked = signal<string | null>(null);

  /** The lines as pricing input: a blank unit price previews the product's price, which the API defaults to. */
  private readonly pricingItems = computed(() =>
    this.lines().map((l): PricingItem => {
      const product = this.productsById().get(l.productId);
      return {
        quantity: toDecimal(l.quantity),
        unitPrice: l.unitPrice.trim() === '' && product ? product.unitPrice : toDecimal(l.unitPrice),
        discountType: l.discountType,
        discountValue: toDecimal(l.discountValue),
        taxPercent: toDecimal(l.taxPercent),
        unitCost: product?.unitCost ?? l.savedUnitCost,
      };
    }),
  );
  /** Live totals: recalculated whenever any line changes, with the server's rounding rules. */
  protected readonly totals = computed(() => calculate(this.pricingItems()));
  /** Discount problems the API would reject, shown as the line is edited. */
  protected readonly discountIssues = computed(() => this.pricingItems().map(discountError));
  /** Quantity on this quote per product, for the stock warnings. */
  private readonly quantityByProduct = computed(() => {
    const totals = new Map<string, number>();
    for (const l of this.lines()) {
      if (l.productId) totals.set(l.productId, (totals.get(l.productId) ?? 0) + (Number(l.quantity) || 0));
    }
    return totals;
  });

  protected readonly heading = computed(() => (this.editing() ? `Edit ${this.quoteNumber()}` : 'New quotation'));
  protected readonly money = formatMoney;
  protected readonly optionalMoney = formatOptionalMoney;
  protected readonly productLabel = productLabel;
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
        // Lines saved before products existed have none; the RM picks one before saving.
        productId: it.product?.id ?? '',
        description: it.description ?? '',
        quantity: String(it.quantity),
        unitPrice: String(it.unitPrice),
        discountType: it.discountType,
        discountValue: String(it.discountValue),
        taxPercent: String(it.taxPercent),
        savedUnitCost: it.unitCost ?? null,
      })),
    );
  }

  /** Active products, plus the line's current one if it has been retired since. */
  protected productOptions(current: string): Product[] {
    return this.products().filter((p) => p.active || p.id === current);
  }

  protected product(id: string): Product | undefined {
    return this.productsById().get(id);
  }

  /** Warning when the quote asks for more of a tracked product than is in stock; the API checks on submit. */
  protected stockWarning(productId: string): string | null {
    const product = this.productsById().get(productId);
    if (!product || product.stock === null) return null;
    const wanted = this.quantityByProduct().get(productId) ?? 0;
    return wanted > product.stock ? `Only ${stockText(product.stock)} in stock (${wanted} on this quote)` : null;
  }

  private patchLine(key: number, patch: Partial<Line>): void {
    this.lines.update((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    // The API's message for this line no longer applies once it changes.
    if (this.lineErrors().has(key)) {
      this.lineErrors.update((errors) => new Map([...errors].filter(([k]) => k !== key)));
    }
  }

  protected update(key: number, field: LineField, value: string): void {
    this.patchLine(key, { [field]: value });
  }

  /** Picking a product fills the line's unit price with the product's price; the RM may change it. */
  protected pickProduct(key: number, productId: string): void {
    const product = this.productsById().get(productId);
    this.patchLine(key, {
      productId,
      unitPrice: product ? String(product.unitPrice) : '',
      savedUnitCost: null,
    });
  }

  protected setDiscountType(key: number, discountType: DiscountType): void {
    this.patchLine(key, { discountType });
  }

  protected addLine(): void {
    this.lines.update((ls) => [...ls, newLine()]);
  }

  protected removeLine(key: number): void {
    this.lines.update((ls) => ls.filter((l) => l.key !== key));
    this.lineErrors.update((errors) => new Map([...errors].filter(([k]) => k !== key)));
  }

  private itemInput(l: Line): QuoteItemInput {
    return {
      productId: l.productId,
      ...(l.description.trim() ? { description: l.description } : {}),
      quantity: Number(l.quantity),
      // Blank: the API uses the product's price.
      ...(l.unitPrice.trim() ? { unitPrice: Number(l.unitPrice) } : {}),
      discountType: l.discountType,
      discountValue: Number(l.discountValue || 0),
      taxPercent: Number(l.taxPercent || 0),
    };
  }

  /** Puts each "items[i]..." detail under its line and the rest in the page alert. */
  private showSaveError(err: unknown, keys: number[]): void {
    const body = errorBody(err);
    const perLine = new Map<number, string[]>();
    const rest: string[] = [];
    for (const detail of body?.details ?? []) {
      const match = LINE_DETAIL.exec(detail);
      const key = match ? keys[Number(match[1])] : undefined;
      if (match && key !== undefined) perLine.set(key, [...(perLine.get(key) ?? []), match[2]]);
      else rest.push(detail);
    }
    this.lineErrors.set(perLine);
    if (!body || perLine.size === 0) {
      this.formError.set(errorText(err, 'Could not save quotation'));
      return;
    }
    const lines = perLine.size === 1 ? 'the line marked below' : 'the lines marked below';
    this.formError.set(rest.length ? `${body.message}: ${rest.join('; ')}` : `${body.message}: check ${lines}`);
  }

  protected submit(e: Event): void {
    e.preventDefault();
    this.busy.set(true);
    this.formError.set(null);
    this.lineErrors.set(new Map());
    const lines = this.lines();
    // An empty productId is not a valid UUID, so the API would reject the whole body as malformed.
    const unpicked = lines.filter((l) => !l.productId);
    if (unpicked.length) {
      this.lineErrors.set(new Map(unpicked.map((l) => [l.key, ['Pick a product for this line']])));
      this.formError.set('Every line needs a product from the catalog');
      this.busy.set(false);
      return;
    }
    const keys = lines.map((l) => l.key);
    const body: CreateQuoteRequest = {
      clientId: this.clientId(),
      quoteNumber: this.quoteNumber(),
      expiryDate: this.expiryDate(),
      items: lines.map((l) => this.itemInput(l)),
    };
    const id = this.id();
    const save = id ? this.builderApi.update(id, body) : this.builderApi.create(body);
    save
      .pipe(
        switchMap((data) => from(this.router.navigate(['/quotes', data.id]))),
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({ error: (err: unknown) => this.showSaveError(err, keys) });
  }
}
