/** Locale date-time, like the React app's `new Date(x).toLocaleString()`. */
export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

/** YYYY-MM-DD in the user's local time zone. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
