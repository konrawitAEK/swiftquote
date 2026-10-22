import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_URL } from '../core/api';
import type { QuoteStatus, QuoteSummary } from '../models';

/** API calls of the quotations list. */
@Injectable({ providedIn: 'root' })
export class QuotesService {
  private readonly http = inject(HttpClient);

  /** Quotes the signed-in user may see, optionally filtered by status. */
  list(status?: QuoteStatus): Observable<QuoteSummary[]> {
    const params = status ? new HttpParams().set('status', status) : undefined;
    return this.http.get<QuoteSummary[]>(`${API_URL}/quotes`, { params });
  }
}
