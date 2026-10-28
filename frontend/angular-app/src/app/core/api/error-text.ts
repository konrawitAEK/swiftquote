import { HttpErrorResponse } from '@angular/common/http';
import type { ErrorResponse } from '../../models';

function isErrorResponse(value: unknown): value is ErrorResponse {
  return typeof value === 'object' && value !== null && typeof (value as ErrorResponse).message === 'string';
}

/** The HttpErrorResponse behind `err`, also when a resource wrapped it as an Error's cause. */
function httpError(err: unknown): HttpErrorResponse | null {
  if (err instanceof HttpErrorResponse) return err;
  if (err instanceof Error && err.cause instanceof HttpErrorResponse) return err.cause;
  return null;
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
  const res = httpError(err);
  if (!res || res.status === 0) return network;
  const body: unknown = res.error;
  if (!isErrorResponse(body)) return fallback;
  return body.details?.length ? `${body.message}: ${body.details.join('; ')}` : body.message;
}

/** The server's ErrorResponse behind `err`, or null (network failure, or a body that is not one). */
export function errorBody(err: unknown): ErrorResponse | null {
  const body: unknown = httpError(err)?.error;
  return isErrorResponse(body) ? body : null;
}
