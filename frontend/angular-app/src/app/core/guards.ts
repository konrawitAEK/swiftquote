import { inject } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import type { Role } from './api.service';
import { AuthService } from './auth.service';
import { homePath } from './roles';

/** Requires a session; with `roles`, other roles are sent to their own home page. */
export function roleGuard(roles?: Role[]): CanActivateFn {
  return (): boolean | UrlTree => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const user = auth.user();
    if (!auth.isAuthenticated() || !user) return router.parseUrl('/login');
    if (roles && !roles.includes(user.role)) return router.parseUrl(homePath(user.role));
    return true;
  };
}

/** The login page is only for signed-out visitors; a session always starts on the role's home page. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const user = auth.user();
  return auth.isAuthenticated() && user ? inject(Router).parseUrl(homePath(user.role)) : true;
};

/** Unknown paths go to the role's landing page, or to login. */
export function homeRedirect(): string {
  const auth = inject(AuthService);
  const user = auth.user();
  return auth.isAuthenticated() && user ? homePath(user.role) : '/login';
}
