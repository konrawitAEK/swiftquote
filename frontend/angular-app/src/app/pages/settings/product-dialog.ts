import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { finalize } from 'rxjs';
import { Alert } from '../../components/alert';
import { errorText } from '../../core/api';
import { SettingsService } from '../../services/settings.service';
import type { Product, ProductCategory } from '../../models';

export interface ProductDialogData {
  product: Product | null;
  /** Every category; only active ones can be picked. */
  categories: ProductCategory[];
}

/** A number input's model: ngModel gives a number, or null once the field is cleared. */
type NumberField = number | null;
const filled = (value: NumberField) => value !== null && !Number.isNaN(value);

/**
 * Add a product, or edit its name, category, price, cost, stock and active flag. Retired products stay on
 * existing quotes but RMs can no longer pick them. Closes with true when saved.
 */
@Component({
  selector: 'app-product-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    Alert,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ product ? 'Edit ' + product.name : 'Add product' }}</h2>
    <mat-dialog-content>
      <div class="stack fields">
        @if (error(); as e) {
          <app-alert severity="error">{{ e }}</app-alert>
        }
        <mat-form-field>
          <mat-label>Name</mat-label>
          <input matInput required cdkFocusInitial [(ngModel)]="name" [ngModelOptions]="{ standalone: true }" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Category</mat-label>
          <mat-select required [(value)]="categoryId">
            @for (c of categoryOptions; track c.id) {
              <mat-option [value]="c.id" [disabled]="!c.active">
                {{ c.active ? c.name : c.name + ' (retired)' }}
              </mat-option>
            }
          </mat-select>
          @if (categoryRetired()) {
            <mat-hint>This category is retired; pick an active one to save.</mat-hint>
          }
        </mat-form-field>
        <div class="pair">
          <mat-form-field>
            <mat-label>Unit price</mat-label>
            <input
              matInput
              type="number"
              min="0"
              step="0.01"
              required
              [(ngModel)]="unitPrice"
              [ngModelOptions]="{ standalone: true }"
            />
            <span matTextSuffix>฿</span>
            <mat-hint>Default selling price</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Unit cost</mat-label>
            <input
              matInput
              type="number"
              min="0"
              step="0.01"
              required
              [(ngModel)]="unitCost"
              [ngModelOptions]="{ standalone: true }"
            />
            <span matTextSuffix>฿</span>
            <mat-hint>Hidden from customers</mat-hint>
          </mat-form-field>
        </div>
        <mat-checkbox [(ngModel)]="trackStock" [ngModelOptions]="{ standalone: true }">Track stock</mat-checkbox>
        @if (trackStock()) {
          <mat-form-field>
            <mat-label>Stock</mat-label>
            <input
              matInput
              type="number"
              min="0"
              step="any"
              required
              [(ngModel)]="stock"
              [ngModelOptions]="{ standalone: true }"
            />
            <mat-hint>Deducted when a customer accepts a quote</mat-hint>
          </mat-form-field>
        } @else {
          <span class="caption">Not tracked (services, licences): any quantity can be quoted.</span>
        }
        @if (product) {
          <mat-slide-toggle [(ngModel)]="active" [ngModelOptions]="{ standalone: true }">
            {{ active() ? 'Active' : 'Retired (kept on existing quotes, hidden from new lines)' }}
          </mat-slide-toggle>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="busy()" (click)="ref.close(false)">Cancel</button>
      <button mat-flat-button type="button" [disabled]="busy() || !complete()" (click)="save()">
        {{ product ? 'Save' : 'Add product' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .fields {
      padding-top: 8px;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 599px) {
      .pair {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ProductDialog {
  private readonly settingsApi = inject(SettingsService);
  protected readonly ref = inject<MatDialogRef<ProductDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<ProductDialogData>(MAT_DIALOG_DATA);
  protected readonly product = this.data.product;
  /** Active categories, plus the product's current one if it has been retired since. */
  protected readonly categoryOptions = this.data.categories.filter(
    (c) => c.active || c.id === this.product?.category.id,
  );

  protected readonly name = signal(this.product?.name ?? '');
  protected readonly categoryId = signal(this.product?.category.id ?? '');
  protected readonly unitPrice = signal<NumberField>(this.product?.unitPrice ?? null);
  protected readonly unitCost = signal<NumberField>(this.product?.unitCost ?? null);
  protected readonly trackStock = signal(this.product ? this.product.stock !== null : false);
  protected readonly stock = signal<NumberField>(this.product?.stock ?? null);
  protected readonly active = signal(this.product?.active ?? true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly categoryRetired = computed(
    () => !!this.categoryId() && !this.data.categories.find((c) => c.id === this.categoryId())?.active,
  );
  /** Required fields are filled in; the API checks the values themselves. */
  protected readonly complete = computed(
    () =>
      this.name().trim() !== '' &&
      this.categoryId() !== '' &&
      filled(this.unitPrice()) &&
      filled(this.unitCost()) &&
      (!this.trackStock() || filled(this.stock())),
  );

  protected save(): void {
    this.busy.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    const fields = {
      name: this.name(),
      categoryId: this.categoryId(),
      unitPrice: Number(this.unitPrice()),
      unitCost: Number(this.unitCost()),
      // Unchecked "Track stock" sends null: the product's stock is not tracked.
      stock: this.trackStock() ? Number(this.stock()) : null,
    };
    const save = this.product
      ? this.settingsApi.updateProduct(this.product.id, { ...fields, active: this.active() })
      : this.settingsApi.createProduct(fields);
    save
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.ref.disableClose = false;
        }),
      )
      .subscribe({
        next: () => this.ref.close(true),
        error: (err: unknown) => this.error.set(errorText(err, 'Could not save product')),
      });
  }
}
