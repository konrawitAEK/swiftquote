import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_URL } from '../core/api';
import type { Client, CreateQuoteRequest, ProductCategory, QuoteDetail } from '../models';

const quoteUrl = (id: string) => `${API_URL}/quotes/${encodeURIComponent(id)}`;

/** API calls of the quotation builder: reference data, the draft being edited, and save. */
@Injectable({ providedIn: 'root' })
export class QuoteBuilderService {
  private readonly http = inject(HttpClient);

  categories(): Observable<ProductCategory[]> {
    return this.http.get<ProductCategory[]>(`${API_URL}/categories`);
  }

  clients(): Observable<Client[]> {
    return this.http.get<Client[]>(`${API_URL}/clients`);
  }

  get(id: string): Observable<QuoteDetail> {
    return this.http.get<QuoteDetail>(quoteUrl(id));
  }

  create(body: CreateQuoteRequest): Observable<QuoteDetail> {
    return this.http.post<QuoteDetail>(`${API_URL}/quotes`, body);
  }

  update(id: string, body: CreateQuoteRequest): Observable<QuoteDetail> {
    return this.http.put<QuoteDetail>(quoteUrl(id), body);
  }
}
