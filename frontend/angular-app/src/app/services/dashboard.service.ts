import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_URL, type Schemas } from '../core/api';

/** API calls of the sales dashboard. */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  /** Summary of quotations created in [from, to]; an empty bound is open-ended. */
  summary(from: string, to: string): Observable<Schemas['DashboardSummary']> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<Schemas['DashboardSummary']>(`${API_URL}/dashboard/summary`, { params });
  }
}
