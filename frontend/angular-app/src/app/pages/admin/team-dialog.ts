import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs';
import { Alert } from '../../components/alert';
import { errorText, type Schemas } from '../../core/api';
import { AdminService } from '../../services/admin.service';

type User = Schemas['AdminUser'];
type Team = Schemas['Team'];

export interface TeamDialogData {
  team: Team | null;
  wos: User[];
}

/** Add a team or change its name and WO. Closes with true when saved. */
@Component({
  selector: 'app-team-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ team ? 'Edit ' + team.name : 'Add team' }}</h2>
    <mat-dialog-content>
      <div class="stack fields">
        @if (error(); as e) {
          <app-alert severity="error">{{ e }}</app-alert>
        }
        <mat-form-field>
          <mat-label>Team name</mat-label>
          <input matInput required [(ngModel)]="name" [ngModelOptions]="{ standalone: true }" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>WO (approver)</mat-label>
          <mat-select required [(value)]="woUserId">
            @for (w of data.wos; track w.id) {
              <mat-option [value]="w.id">{{ w.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (data.wos.length === 0) {
          <app-alert severity="info">Add a user with the WO role first.</app-alert>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" [disabled]="busy()" (click)="ref.close(false)">Cancel</button>
      <span class="grow"></span>
      <button mat-flat-button type="button" [disabled]="busy() || !woUserId()" (click)="save()">
        {{ team ? 'Save' : 'Add team' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .fields {
      padding-top: 8px;
    }
  `,
})
export class TeamDialog {
  private readonly adminApi = inject(AdminService);
  protected readonly ref = inject<MatDialogRef<TeamDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<TeamDialogData>(MAT_DIALOG_DATA);
  protected readonly team = this.data.team;

  protected readonly name = signal(this.team?.name ?? '');
  protected readonly woUserId = signal(this.team?.wo?.id ?? '');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected save(): void {
    this.busy.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    const body = { name: this.name(), woUserId: this.woUserId() };
    const save = this.team ? this.adminApi.updateTeam(this.team.id, body) : this.adminApi.createTeam(body);
    save
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.ref.disableClose = false;
        }),
      )
      .subscribe({
        next: () => this.ref.close(true),
        error: (err: unknown) => this.error.set(errorText(err, 'Could not save team')),
      });
  }
}
