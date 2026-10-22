import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_URL } from '../core/api';
import type { AdminUser, Client, CreateCategoryRequest, CreateUserRequest, ProductCategory, Team, TeamRequest, UpdateCategoryRequest, UpdateUserRequest } from '../models';

type User = AdminUser;
type Category = ProductCategory;

/** Kinds of record the admin page can delete. */
export type DeleteKind = 'user' | 'team' | 'category';

const ADMIN = `${API_URL}/admin`;
const COLLECTIONS: Record<DeleteKind, string> = { user: 'users', team: 'teams', category: 'categories' };
const id = (value: string) => encodeURIComponent(value);

/** API calls of the admin page: users, teams, product categories, and the clients list for user placement. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  // Users
  users(): Observable<User[]> {
    return this.http.get<User[]>(`${ADMIN}/users`);
  }
  createUser(body: CreateUserRequest): Observable<User> {
    return this.http.post<User>(`${ADMIN}/users`, body);
  }
  updateUser(userId: string, body: UpdateUserRequest): Observable<User> {
    return this.http.put<User>(`${ADMIN}/users/${id(userId)}`, body);
  }

  // Teams
  teams(): Observable<Team[]> {
    return this.http.get<Team[]>(`${ADMIN}/teams`);
  }
  createTeam(body: TeamRequest): Observable<Team> {
    return this.http.post<Team>(`${ADMIN}/teams`, body);
  }
  updateTeam(teamId: string, body: TeamRequest): Observable<Team> {
    return this.http.put<Team>(`${ADMIN}/teams/${id(teamId)}`, body);
  }

  // Product categories (the list is the shared one, including retired categories)
  categories(): Observable<Category[]> {
    return this.http.get<Category[]>(`${API_URL}/categories`);
  }
  createCategory(body: CreateCategoryRequest): Observable<Category> {
    return this.http.post<Category>(`${ADMIN}/categories`, body);
  }
  updateCategory(categoryId: string, body: UpdateCategoryRequest): Observable<Category> {
    return this.http.put<Category>(`${ADMIN}/categories/${id(categoryId)}`, body);
  }

  // Clients (read-only here; customers are placed in one)
  clients(): Observable<Client[]> {
    return this.http.get<Client[]>(`${API_URL}/clients`);
  }

  /** Permanent delete: POST /admin/{users|teams|categories}/{id}/delete, no body, 204. */
  delete(kind: DeleteKind, recordId: string): Observable<void> {
    return this.http.post<void>(`${ADMIN}/${COLLECTIONS[kind]}/${id(recordId)}/delete`, null);
  }
}
