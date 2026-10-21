/** Absolute URL of the client portal for a quote's access token. */
export function shareUrl(accessToken: string): string {
  return `${window.location.origin}/p/${accessToken}`;
}
