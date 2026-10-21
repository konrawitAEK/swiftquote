import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { components } from '../api/schema';

// Types generated from contracts/openapi.yaml (`make gen-types`).
export type Schemas = components['schemas'];
export type QuoteStatus = Schemas['QuoteStatus'];
export type Role = Schemas['Role'];
export type ErrorResponse = Schemas['ErrorResponse'];
export type QuoteDetail = Schemas['QuoteDetail'];

export const API_URL: string = environment.apiUrl;

/** Workflow calls that take an optional comment. */
export type CommentAction = 'submit' | 'approve' | 'return' | 'reject';

const id = (value: string) => encodeURIComponent(value);

/** Typed wrapper over the SwiftQuote REST API. Every call resolves with the body or rejects with an HttpErrorResponse. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private call<T>(request: Observable<T>): Promise<T> {
    return firstValueFrom(request);
  }

  private get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.call(this.http.get<T>(API_URL + path, { params: new HttpParams({ fromObject: params ?? {} }) }));
  }

  private post<T>(path: string, body: unknown = null): Promise<T> {
    return this.call(this.http.post<T>(API_URL + path, body));
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.call(this.http.put<T>(API_URL + path, body));
  }

  // Auth
  login(body: Schemas['LoginRequest']) {
    return this.post<Schemas['AuthResponse']>('/auth/login', body);
  }

  // Reference data
  listClients() {
    return this.get<Schemas['Client'][]>('/clients');
  }
  listCategories() {
    return this.get<Schemas['ProductCategory'][]>('/categories');
  }

  // Quotes
  listQuotes(status?: QuoteStatus) {
    return this.get<Schemas['QuoteSummary'][]>('/quotes', status ? { status } : undefined);
  }
  getQuote(quoteId: string) {
    return this.get<QuoteDetail>(`/quotes/${id(quoteId)}`);
  }
  createQuote(body: Schemas['CreateQuoteRequest']) {
    return this.post<QuoteDetail>('/quotes', body);
  }
  updateQuote(quoteId: string, body: Schemas['CreateQuoteRequest']) {
    return this.put<QuoteDetail>(`/quotes/${id(quoteId)}`, body);
  }
  commentAction(quoteId: string, action: CommentAction, body: Schemas['CommentRequest']) {
    return this.post<QuoteDetail>(`/quotes/${id(quoteId)}/${action}`, body);
  }
  sendQuote(quoteId: string) {
    return this.post<QuoteDetail>(`/quotes/${id(quoteId)}/send`);
  }
  acceptQuote(quoteId: string, body: Schemas['AcceptQuoteRequest']) {
    return this.post<QuoteDetail>(`/quotes/${id(quoteId)}/accept`, body);
  }

  // Dashboard
  dashboardSummary(from: string, to: string) {
    return this.get<Schemas['DashboardSummary']>('/dashboard/summary', {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }

  // Admin
  listUsers() {
    return this.get<Schemas['AdminUser'][]>('/admin/users');
  }
  createUser(body: Schemas['CreateUserRequest']) {
    return this.post<Schemas['AdminUser']>('/admin/users', body);
  }
  updateUser(userId: string, body: Schemas['UpdateUserRequest']) {
    return this.put<Schemas['AdminUser']>(`/admin/users/${id(userId)}`, body);
  }
  listTeams() {
    return this.get<Schemas['Team'][]>('/admin/teams');
  }
  createTeam(body: Schemas['TeamRequest']) {
    return this.post<Schemas['Team']>('/admin/teams', body);
  }
  updateTeam(teamId: string, body: Schemas['TeamRequest']) {
    return this.put<Schemas['Team']>(`/admin/teams/${id(teamId)}`, body);
  }
  createCategory(body: Schemas['CreateCategoryRequest']) {
    return this.post<Schemas['ProductCategory']>('/admin/categories', body);
  }
  updateCategory(categoryId: string, body: Schemas['UpdateCategoryRequest']) {
    return this.put<Schemas['ProductCategory']>(`/admin/categories/${id(categoryId)}`, body);
  }

  // Client portal (no login)
  getPublicQuote(accessToken: string) {
    return this.get<Schemas['PublicQuoteView']>(`/public/quotes/${id(accessToken)}`);
  }
  acceptPublicQuote(accessToken: string, body: Schemas['AcceptQuoteRequest']) {
    return this.post<QuoteDetail>(`/public/quotes/${id(accessToken)}/accept`, body);
  }
  rejectPublicQuote(accessToken: string, body: Schemas['CommentRequest']) {
    return this.post<QuoteDetail>(`/public/quotes/${id(accessToken)}/reject`, body);
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return typeof value === 'object' && value !== null && typeof (value as ErrorResponse).message === 'string';
}

/**
 * Human-readable text for a failed call: the server's ErrorResponse, `network` when the API
 * could not be reached, otherwise `fallback`.
 */
export function errorText(
  err: unknown,
  fallback = 'Something went wrong',
  network = 'Cannot reach the API',
): string {
  if (!(err instanceof HttpErrorResponse)) return network;
  if (err.status === 0) return network;
  const body: unknown = err.error;
  if (!isErrorResponse(body)) return fallback;
  return body.details?.length ? `${body.message}: ${body.details.join('; ')}` : body.message;
}
