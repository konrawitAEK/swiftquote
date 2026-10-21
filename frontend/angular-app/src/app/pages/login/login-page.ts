import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { Alert } from '../../components/alert';
import { AuthService } from '../../core/auth.service';
import { homePath } from '../../core/roles';

// Seeded by db/migrations/V6__seed_dev_roles.sql; all use the password "password".
const DEV_ACCOUNTS = [
  { label: 'Admin', email: 'demo@swiftquote.dev' },
  { label: 'WOC', email: 'woc@swiftquote.dev' },
  { label: 'WO', email: 'wo@swiftquote.dev' },
  { label: 'RM', email: 'rm1@swiftquote.dev' },
  { label: 'Customer', email: 'buyer@acme.example' },
];

@Component({
  selector: 'app-login-page',
  imports: [FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card class="card">
      <mat-card-content class="content">
        <h1 class="title">SwiftQuote</h1>
        <p class="muted body2 sub">Sign in to manage your quotations</p>
        <form class="stack" ngNativeValidate (ngSubmit)="submit()">
          @if (error(); as e) {
            <app-alert severity="error">{{ e }}</app-alert>
          }
          <mat-form-field>
            <mat-label>Email</mat-label>
            <input matInput type="email" name="email" autocomplete="username" [(ngModel)]="email" required />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Password</mat-label>
            <input
              matInput
              type="password"
              name="password"
              autocomplete="current-password"
              [(ngModel)]="password"
              required
              #passwordInput
            />
          </mat-form-field>
          <button mat-flat-button class="submit" type="submit" [disabled]="busy()">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
        <p class="caption dev">Dev accounts (password: password)</p>
        <div class="row chips">
          @for (a of accounts; track a.email) {
            <button type="button" class="chip" [class.selected]="email() === a.email" (click)="email.set(a.email)">
              {{ a.label }}
            </button>
          }
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    :host {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 16px;
      box-sizing: border-box;
    }
    .card {
      width: 100%;
      max-width: 420px;
    }
    .content {
      padding: 32px !important;
    }
    .title {
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      margin: 0;
    }
    .sub {
      margin: 0 0 24px;
    }
    .submit {
      height: 44px;
    }
    .dev {
      margin: 24px 0 8px;
    }
    .chip {
      height: 32px;
      padding: 0 12px;
      border-radius: 16px;
      border: 1px solid var(--mat-sys-outline);
      background: transparent;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
      cursor: pointer;
    }
    .chip:hover {
      background: var(--mat-sys-surface-container-high);
    }
    .chip.selected {
      background: var(--mat-sys-primary);
      border-color: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly accounts = DEV_ACCOUNTS;
  protected readonly email = signal('rm1@swiftquote.dev');
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly passwordInput = viewChild.required<ElementRef<HTMLInputElement>>('passwordInput');

  constructor() {
    // The email is prefilled, so start in the password field.
    afterNextRender(() => this.passwordInput().nativeElement.focus());
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    const err = await this.auth.login(this.email(), this.password());
    this.busy.set(false);
    if (err) {
      this.error.set(err);
      return;
    }
    // Always start on the role's home page, never on the page that was open before.
    await this.router.navigateByUrl(homePath(this.auth.user()?.role), { replaceUrl: true });
  }
}
