import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { API_URL } from './api';
import { AuthService } from '../services/auth.service';
import { getToken } from './token';

/** Adds the bearer token to API calls and logs out when an authenticated call comes back 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Exact origin + path prefix, so a look-alike host (api.example.com.evil.net) never gets the token.
  const toApi = req.url === API_URL || req.url.startsWith(API_URL + '/');
  const token = toApi ? getToken() : null;
  const auth = inject(AuthService);
  const request = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(request).pipe(
    catchError((err: unknown) => {
      if (token && err instanceof HttpErrorResponse && err.status === 401) auth.logout();
      return throwError(() => err);
    }),
  );
};
