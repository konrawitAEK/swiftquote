import type { Routes } from '@angular/router';
import { AppLayout } from './components/app-layout/app-layout';
import { guestGuard, homeRedirect, roleGuard } from './core/guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'p/:accessToken',
    loadComponent: () => import('./pages/public-quote/public-quote-page').then((m) => m.PublicQuotePage),
  },
  {
    path: '',
    component: AppLayout,
    canActivate: [roleGuard()],
    children: [
      // "/" itself goes to the role's home page instead of an empty layout.
      { path: '', pathMatch: 'full', redirectTo: homeRedirect },
      {
        path: 'quotes',
        pathMatch: 'full',
        canActivate: [roleGuard(['rm', 'wo', 'woc', 'customer'])],
        loadComponent: () => import('./pages/quotes/quotes-page').then((m) => m.QuotesPage),
      },
      {
        path: 'quotes/new',
        canActivate: [roleGuard(['rm'])],
        loadComponent: () => import('./pages/quote-builder/quote-builder-page').then((m) => m.QuoteBuilderPage),
      },
      {
        path: 'quotes/:id/edit',
        canActivate: [roleGuard(['rm'])],
        loadComponent: () => import('./pages/quote-builder/quote-builder-page').then((m) => m.QuoteBuilderPage),
      },
      {
        path: 'quotes/:id',
        canActivate: [roleGuard(['rm', 'wo', 'woc', 'customer'])],
        loadComponent: () => import('./pages/quote-detail/quote-detail-page').then((m) => m.QuoteDetailPage),
      },
      {
        path: 'dashboard',
        canActivate: [roleGuard(['woc'])],
        loadComponent: () => import('./pages/dashboard/dashboard-page').then((m) => m.DashboardPage),
      },
      {
        path: 'settings',
        canActivate: [roleGuard(['admin'])],
        loadComponent: () => import('./pages/settings/settings-page').then((m) => m.SettingsPage),
      },
      // The Back Office page used to live at /admin.
      { path: 'admin', pathMatch: 'full', redirectTo: 'settings' },
    ],
  },
  { path: '**', redirectTo: homeRedirect },
];
