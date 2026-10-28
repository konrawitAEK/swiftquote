import { HttpClient, type HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_URL } from '../core/api';
import { parseBlobError } from '../core/download';
import type { AcceptQuoteRequest, CommentRequest, QuoteDetail } from '../models';

/** Workflow calls that take an optional comment. */
export type CommentAction = 'submit' | 'approve' | 'return' | 'reject';

const quoteUrl = (id: string) => `${API_URL}/quotes/${encodeURIComponent(id)}`;

/** API calls of the quotation detail page: load, the workflow actions and the PDF. */
@Injectable({ providedIn: 'root' })
export class QuoteDetailService {
  private readonly http = inject(HttpClient);

  get(id: string): Observable<QuoteDetail> {
    return this.http.get<QuoteDetail>(quoteUrl(id));
  }

  /** submit / approve / return / reject, each with an optional comment. */
  commentAction(id: string, action: CommentAction, comment: string | null): Observable<QuoteDetail> {
    const body: CommentRequest = { comment };
    return this.http.post<QuoteDetail>(`${quoteUrl(id)}/${action}`, body);
  }

  send(id: string): Observable<QuoteDetail> {
    return this.http.post<QuoteDetail>(`${quoteUrl(id)}/send`, null);
  }

  accept(id: string, body: AcceptQuoteRequest): Observable<QuoteDetail> {
    return this.http.post<QuoteDetail>(`${quoteUrl(id)}/accept`, body);
  }

  /** The quotation as a PDF (no cost figures); approved, sent, viewed, accepted or rejected quotes only. */
  pdf(id: string): Observable<HttpResponse<Blob>> {
    return this.http
      .get(`${quoteUrl(id)}/pdf`, { responseType: 'blob', observe: 'response' })
      .pipe(parseBlobError());
  }
}
