import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { finalize } from 'rxjs';
import { Alert } from '../../components/alert';
import { errorText, type Schemas } from '../../core/api';
import { AdminService } from '../../services/admin.service';

type Category = Schemas['ProductCategory'];

/** Add a product category, or rename / retire one. Retired categories stay on existing quotes. Closes with true when saved. */
@Component({
  selector: 'app-category-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ category ? 'Edit ' + category.name : 'Add product category' }}</h2>
    <mat-dialog-content>
      <div class="stack fields">
        @if (error(); as e) {
          <app-alert severity="error">{{ e }}</app-alert>
        }
        <mat-form-field>
          <mat-label>Name</mat-label>
          <input matInput required cdkFocusInitial [(ngModel)]="name" [ngModelOptions]="{ standalone: true }" />
        </mat-form-field>
        @if (category) {
          <mat-slide-toggle [(ngModel)]="active" [ngModelOptions]="{ standalone: true }">
            {{ active() ? 'Active' : 'Retired (kept on existing quotes, hidden from new lines)' }}
          </mat-slide-toggle>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="busy()" (click)="ref.close(false)">Cancel</button>
      <button mat-flat-button type="button" [disabled]="busy() || name().trim() === ''" (click)="save()">
        {{ category ? 'Save' : 'Add category' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .fields {
      padding-top: 8px;
    }
  `,
})
export class CategoryDialog {
  private readonly adminApi = inject(AdminService);
  protected readonly ref = inject<MatDialogRef<CategoryDialog, boolean>>(MatDialogRef);
  protected readonly category = inject<Category | null>(MAT_DIALOG_DATA);

  protected readonly name = signal(this.category?.name ?? '');
  protected readonly active = signal(this.category?.active ?? true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected save(): void {
    this.busy.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    const save = this.category
      ? this.adminApi.updateCategory(this.category.id, { name: this.name(), active: this.active() })
      : this.adminApi.createCategory({ name: this.name() });
    save
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.ref.disableClose = false;
        }),
      )
      .subscribe({
        next: () => this.ref.close(true),
        error: (err: unknown) => this.error.set(errorText(err, 'Could not save category')),
      });
  }
}
