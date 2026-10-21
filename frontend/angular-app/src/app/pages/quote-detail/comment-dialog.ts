import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Alert } from '../../components/alert';
import type { CommentAction } from '../../core/api.service';

export interface DialogSpec {
  action: CommentAction;
  title: string;
  confirm: string;
  commentRequired: boolean;
  help: string;
}

export const DIALOGS: Record<CommentAction, DialogSpec> = {
  submit: { action: 'submit', title: 'Submit for approval', confirm: 'Submit', commentRequired: false, help: 'Optional note for your WO.' },
  approve: { action: 'approve', title: 'Approve quotation', confirm: 'Approve', commentRequired: false, help: 'Optional note for the RM.' },
  return: { action: 'return', title: 'Return for changes', confirm: 'Return to RM', commentRequired: true, help: 'Tell the RM what to change.' },
  reject: { action: 'reject', title: 'Decline quotation', confirm: 'Decline', commentRequired: false, help: 'Optional reason.' },
};

export interface CommentDialogData {
  spec: DialogSpec;
  /** Runs the workflow call; resolves to an error message, or null when done. */
  run: (comment: string | null) => Promise<string | null>;
}

/** Comment prompt for submit / approve / return / decline. Closes only when the call succeeds. */
@Component({
  selector: 'app-comment-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.spec.title }}</h2>
    <mat-dialog-content>
      <mat-form-field class="full-width field">
        <mat-label>{{ data.spec.commentRequired ? 'Comment (required)' : 'Comment' }}</mat-label>
        <textarea
          matInput
          cdkFocusInitial
          rows="3"
          [(ngModel)]="comment"
          [ngModelOptions]="{ standalone: true }"
        ></textarea>
        <mat-hint>{{ data.spec.help }}</mat-hint>
      </mat-form-field>
      @if (error(); as e) {
        <app-alert severity="error" class="err">{{ e }}</app-alert>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="busy()" (click)="ref.close()">Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="busy() || (data.spec.commentRequired && comment().trim() === '')"
        (click)="confirm()"
      >
        {{ data.spec.confirm }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .field {
      margin-top: 8px;
    }
    .err {
      margin-top: 16px;
    }
  `,
})
export class CommentDialog {
  protected readonly data = inject<CommentDialogData>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<CommentDialog>>(MatDialogRef);
  protected readonly comment = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async confirm(): Promise<void> {
    this.busy.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    const err = await this.data.run(this.comment().trim() || null);
    this.busy.set(false);
    this.ref.disableClose = false;
    if (err) this.error.set(err);
    else this.ref.close();
  }
}
