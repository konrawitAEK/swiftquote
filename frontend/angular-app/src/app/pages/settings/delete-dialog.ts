import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { finalize } from 'rxjs';
import { Alert } from '../../components/alert';
import { errorText } from '../../core/api';
import { SettingsService, type DeleteKind } from '../../services/settings.service';

export interface DeleteTarget {
  kind: DeleteKind;
  id: string;
  name: string;
}

const EXPLANATIONS: Record<DeleteTarget['kind'], string> = {
  user: "This permanently removes the account. Users with quote history can't be deleted; deactivate them instead.",
  team: 'Only empty teams can be deleted.',
  category: "Categories used on quotes or by products can't be deleted; retire them instead.",
  product: "Products used on quotes can't be deleted; retire them instead.",
};

/** Confirm a permanent delete of a user, team, category or product. API refusals stay in the dialog; closes with true when deleted. */
@Component({
  selector: 'app-delete-dialog',
  imports: [MatButtonModule, MatDialogModule, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Delete {{ target.name }}?</h2>
    <mat-dialog-content>
      <div class="stack">
        @if (error(); as e) {
          <app-alert severity="error">{{ e }}</app-alert>
        }
        <p class="text">{{ explanation }}</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="busy()" (click)="ref.close(false)">Cancel</button>
      <button mat-flat-button type="button" class="danger" [disabled]="busy()" (click)="confirm()">
        {{ busy() ? 'Deleting…' : 'Delete' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .text {
      margin: 0;
    }
    .danger {
      --mat-button-filled-container-color: var(--sq-error);
      --mat-button-filled-label-text-color: #fff;
    }
  `,
})
export class DeleteDialog {
  private readonly settingsApi = inject(SettingsService);
  protected readonly ref = inject<MatDialogRef<DeleteDialog, boolean>>(MatDialogRef);
  protected readonly target = inject<DeleteTarget>(MAT_DIALOG_DATA);
  protected readonly explanation = EXPLANATIONS[this.target.kind];

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected confirm(): void {
    this.busy.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    this.settingsApi
      .delete(this.target.kind, this.target.id)
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.ref.disableClose = false;
        }),
      )
      .subscribe({
        next: () => this.ref.close(true),
        error: (err: unknown) => this.error.set(errorText(err, `Could not delete ${this.target.name}`)),
      });
  }
}
