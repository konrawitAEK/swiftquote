import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { map, type Observable } from 'rxjs';
import { API_URL } from '../core/api';
import { ROLE_LABELS } from '../core/roles';
import { getToken, setToken } from '../core/token';
import type { AuthResponse, LoginRequest } from '../models';

export type AuthUser = AuthResponse['user'];

const USER_KEY = 'swiftquote.user';

/** The stored user, or null if missing or from an older app version (unknown role). */
function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const user = raw ? (JSON.parse(raw) as AuthUser) : null;
    return user && user.role in ROLE_LABELS ? user : null;
  } catch {
    return null;
  }
}

function saveUser(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // non-essential: the session still works for this tab
  }
}

/** Session state as signals; the token itself lives in token.ts so the HTTP interceptor can read it. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly currentUser = signal<AuthUser | null>(loadUser());
  // A token without a usable stored user (e.g. saved by an older version) is discarded.
  private readonly token = signal<string | null>(this.currentUser() ? getToken() : null);

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.token() !== null && this.currentUser() !== null);

  /** Signs in and stores the session; emits the signed-in user, or errors with the HttpErrorResponse. */
  login(email: string, password: string): Observable<AuthUser> {
    const body: LoginRequest = { email, password };
    return this.http.post<AuthResponse>(`${API_URL}/auth/login`, body).pipe(
      map((data) => {
        setToken(data.accessToken);
        saveUser(data.user);
        this.token.set(data.accessToken);
        this.currentUser.set(data.user);
        return data.user;
      }),
    );
  }

  logout(): void {
    setToken(null);
    saveUser(null);
    this.token.set(null);
    this.currentUser.set(null);
    void this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
