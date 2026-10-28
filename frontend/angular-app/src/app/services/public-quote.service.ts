import { HttpClient, type HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_URL } from '../core/api';
import { parseBlobError } from '../core/download';
import type { AcceptQuoteRequest, CommentRequest, PublicQuoteView, QuoteDetail } from '../models';

const publicUrl = (accessToken: string) => `${API_URL}/public/quotes/${encodeURIComponent(accessToken)}`;

/** API calls of the client portal (no login; addressed by the quote's access token). */
@Injectable({ providedIn: 'root' })
export class PublicQuoteService {
  private readonly http = inject(HttpClient);

  get(accessToken: string): Observable<PublicQuoteView> {
    return this.http.get<PublicQuoteView>(publicUrl(accessToken));
  }

  accept(accessToken: string, body: AcceptQuoteRequest): Observable<QuoteDetail> {
    return this.http.post<QuoteDetail>(`${publicUrl(accessToken)}/accept`, body);
  }

  reject(accessToken: string, comment: string | null): Observable<QuoteDetail> {
    const body: CommentRequest = { comment };
    return this.http.post<QuoteDetail>(`${publicUrl(accessToken)}/reject`, body);
  }

  /** The quotation as a PDF, for the customer to keep. */
  pdf(accessToken: string): Observable<HttpResponse<Blob>> {
    return this.http
      .get(`${publicUrl(accessToken)}/pdf`, { responseType: 'blob', observe: 'response' })
      .pipe(parseBlobError());
  }
}
