import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, errorText, type Schemas } from './api.service';
import { ROLE_LABELS } from './roles';
import { getToken, setToken } from './token';

export type AuthUser = Schemas['AuthResponse']['user'];

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
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  private readonly currentUser = signal<AuthUser | null>(loadUser());
  // A token without a usable stored user (e.g. saved by an older version) is discarded.
  private readonly token = signal<string | null>(this.currentUser() ? getToken() : null);

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.token() !== null && this.currentUser() !== null);

  /** Resolves to an error message, or null on success. */
  async login(email: string, password: string): Promise<string | null> {
    try {
      const data = await this.api.login({ email, password });
      setToken(data.accessToken);
      saveUser(data.user);
      this.token.set(data.accessToken);
      this.currentUser.set(data.user);
      return null;
    } catch (err) {
      return errorText(err, 'Login failed', 'Cannot reach the API. Is the backend running on :8080?');
    }
  }

  logout(): void {
    setToken(null);
    saveUser(null);
    this.token.set(null);
    this.currentUser.set(null);
    void this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
