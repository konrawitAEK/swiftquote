import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { finalize } from 'rxjs';
import { Alert } from '../../components/alert';
import { errorText } from '../../core/api';
import { AuthService } from '../../services/auth.service';
import { ROLE_LABELS, ROLES } from '../../core/roles';
import { SettingsService } from '../../services/settings.service';
import type { AdminUser, Client, Role, Team } from '../../models';

type User = AdminUser;

export interface UserDialogData {
  user: User | null;
  teams: Team[];
  clients: Client[];
}

/** Add a user, or edit name, role, placement, active flag and password. Closes with true when saved. */
@Component({
  selector: 'app-user-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    Alert,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ user ? 'Edit ' + user.name : 'Add user' }}</h2>
    <mat-dialog-content>
      <div class="stack fields">
        @if (error(); as e) {
          <app-alert severity="error">{{ e }}</app-alert>
        }
        <mat-form-field>
          <mat-label>Email</mat-label>
          <input matInput type="email" required [disabled]="!!user" [(ngModel)]="email" [ngModelOptions]="{ standalone: true }" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Full name</mat-label>
          <input matInput required [(ngModel)]="name" [ngModelOptions]="{ standalone: true }" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Role</mat-label>
          <mat-select [(value)]="role" [disabled]="self">
            @for (r of roles; track r) {
              <mat-option [value]="r">{{ roleLabels[r] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (role() === 'rm') {
          <mat-form-field>
            <mat-label>Team</mat-label>
            <mat-select [(value)]="teamId">
              <mat-option value=""><em>No team</em></mat-option>
              @for (t of data.teams; track t.id) {
                <mat-option [value]="t.id">{{ t.name }}</mat-option>
              }
            </mat-select>
            <mat-hint>An RM needs a team with a WO to submit for approval</mat-hint>
          </mat-form-field>
        }
        @if (role() === 'customer') {
          <mat-form-field>
            <mat-label>Client company</mat-label>
            <mat-select required [(value)]="clientId">
              @for (c of data.clients; track c.id) {
                <mat-option [value]="c.id">{{ c.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field>
          <mat-label>{{ user ? 'New password (leave blank to keep)' : 'Password' }}</mat-label>
          <input
            matInput
            type="password"
            autocomplete="new-password"
            [required]="!user"
            [(ngModel)]="password"
            [ngModelOptions]="{ standalone: true }"
          />
          <mat-hint>At least 8 characters</mat-hint>
        </mat-form-field>
        @if (user) {
          <mat-slide-toggle [disabled]="self" [(ngModel)]="active" [ngModelOptions]="{ standalone: true }">
            {{ active() ? 'Active' : 'Inactive (cannot sign in; history is kept)' }}
          </mat-slide-toggle>
        }
        @if (self) {
          <span class="caption">You cannot change your own role or deactivate yourself.</span>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="busy()" (click)="ref.close(false)">Cancel</button>
      <button mat-flat-button type="button" [disabled]="busy()" (click)="save()">{{ user ? 'Save' : 'Add user' }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .fields {
      padding-top: 8px;
    }
  `,
})
export class UserDialog {
  private readonly settingsApi = inject(SettingsService);
  protected readonly ref = inject<MatDialogRef<UserDialog, boolean>>(MatDialogRef);
  protected readonly data = inject<UserDialogData>(MAT_DIALOG_DATA);
  protected readonly user = this.data.user;
  protected readonly self = inject(AuthService).user()?.id === this.user?.id;
  protected readonly roles = ROLES;
  protected readonly roleLabels = ROLE_LABELS;

  protected readonly email = signal(this.user?.email ?? '');
  protected readonly name = signal(this.user?.name ?? '');
  protected readonly role = signal<Role>(this.user?.role ?? 'rm');
  protected readonly teamId = signal(this.user?.team?.id ?? '');
  protected readonly clientId = signal(this.user?.client?.id ?? '');
  protected readonly active = signal(this.user?.active ?? true);
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected save(): void {
    this.busy.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    const role = this.role();
    const placement = {
      teamId: role === 'rm' && this.teamId() ? this.teamId() : null,
      clientId: role === 'customer' && this.clientId() ? this.clientId() : null,
    };
    const save = this.user
      ? this.settingsApi.updateUser(this.user.id, {
          name: this.name(),
          role,
          active: this.active(),
          ...placement,
          password: this.password() || null,
        })
      : this.settingsApi.createUser({ email: this.email(), name: this.name(), password: this.password(), role, ...placement });
    save
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.ref.disableClose = false;
        }),
      )
      .subscribe({
        next: () => this.ref.close(true),
        error: (err: unknown) => this.error.set(errorText(err, 'Could not save user')),
      });
  }
}
