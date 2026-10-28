import { HttpErrorResponse, type HttpResponse } from '@angular/common/http';
import { catchError, from, switchMap, throwError, type Observable, type OperatorFunction } from 'rxjs';

/**
 * The file name in a Content-Disposition header (RFC 6266 filename* or filename), or null.
 * Cross-origin, the browser only exposes the header when the API lists it in Access-Control-Expose-Headers.
 */
export function dispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*(?:[\w-]+)?'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // fall through to the plain filename
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const name = plain ? (plain[2] ?? plain[1]).trim() : '';
  return name || null;
}

/** Saves a downloaded file, named by its Content-Disposition, else `fallbackName`. */
export function saveResponse(res: HttpResponse<Blob>, fallbackName: string): void {
  if (!res.body) return;
  const name = dispositionFilename(res.headers.get('Content-Disposition')) ?? fallbackName;
  const url = URL.createObjectURL(res.body);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * With responseType 'blob' an error body arrives as a Blob too; this turns a JSON one back into the
 * ErrorResponse object, so errorText() can show the server's message.
 */
export function parseBlobError<T>(): OperatorFunction<T, T> {
  return catchError((err: unknown): Observable<never> => {
    if (!(err instanceof HttpErrorResponse) || !(err.error instanceof Blob)) return throwError(() => err);
    return from(err.error.text()).pipe(
      switchMap((text) => {
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // not JSON: keep the text
        }
        const parsed = new HttpErrorResponse({
          error: body,
          headers: err.headers,
          status: err.status,
          statusText: err.statusText,
          url: err.url ?? undefined,
        });
        return throwError(() => parsed);
      }),
    );
  });
}
