import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { homePath, ROLE_LABELS } from '../../core/roles';
import type { Role } from '../../models';

const NAV: Record<Role, { to: string; label: string }[]> = {
  admin: [{ to: '/admin', label: 'Users & teams' }],
  woc: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/quotes', label: 'All quotations' },
  ],
  wo: [{ to: '/quotes', label: 'Team quotations' }],
  rm: [
    { to: '/quotes', label: 'My quotations' },
    { to: '/quotes/new', label: 'New quote' },
  ],
  customer: [{ to: '/quotes', label: 'My quotations' }],
};

/** Shell for signed-in pages. Access is enforced by the route guards in app.routes.ts. */
@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (user(); as u) {
      <mat-toolbar class="bar">
        <a class="brand" [routerLink]="home()">SwiftQuote</a>
        <nav class="nav">
          @for (item of nav(); track item.to) {
            <a
              mat-button
              [routerLink]="item.to"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: true }"
              >{{ item.label }}</a
            >
          }
        </nav>
        <span class="who">
          <span class="name">{{ u.name }}</span>
          <span class="role">{{ roleLabel() }}</span>
        </span>
        <button mat-button type="button" (click)="auth.logout()">Log out</button>
      </mat-toolbar>
    }
    <main class="container">
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }
    .bar {
      position: sticky;
      top: 0;
      z-index: 10;
      gap: 8px;
      flex-wrap: wrap;
      height: auto;
      min-height: 64px;
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }
    .bar a[mat-button],
    .bar button[mat-button] {
      color: inherit;
    }
    .brand {
      font: var(--mat-sys-title-large);
      font-weight: 700;
      color: inherit;
      text-decoration: none;
      margin-right: 16px;
    }
    .nav {
      display: flex;
      gap: 4px;
      flex: 1;
    }
    .nav a.active {
      background: rgba(255, 255, 255, 0.16);
    }
    .who {
      display: flex;
      align-items: center;
      gap: 8px;
      font: var(--mat-sys-body-medium);
    }
    .role {
      border: 1px solid currentcolor;
      border-radius: 16px;
      padding: 1px 10px;
      font: var(--mat-sys-label-medium);
    }
    @media (max-width: 599px) {
      .who {
        display: none;
      }
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 24px;
      box-sizing: border-box;
    }
    @media (max-width: 599px) {
      .container {
        padding: 16px;
      }
    }
  `,
})
export class AppLayout {
  protected readonly auth = inject(AuthService);
  protected readonly user = this.auth.user;
  protected readonly nav = computed(() => {
    const role = this.user()?.role;
    return role ? NAV[role] : [];
  });
  protected readonly home = computed(() => homePath(this.user()?.role));
  protected readonly roleLabel = computed(() => {
    const role = this.user()?.role;
    return role ? ROLE_LABELS[role] : '';
  });
}
