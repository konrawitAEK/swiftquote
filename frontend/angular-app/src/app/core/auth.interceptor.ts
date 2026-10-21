import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { API_URL } from './api.service';
import { AuthService } from './auth.service';
import { getToken } from './token';

/** Adds the bearer token to API calls and logs out when an authenticated call comes back 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = req.url.startsWith(API_URL) ? getToken() : null;
  const auth = inject(AuthService);
  const request = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(request).pipe(
    catchError((err: unknown) => {
      if (token && err instanceof HttpErrorResponse && err.status === 401) auth.logout();
      return throwError(() => err);
    }),
  );
};
