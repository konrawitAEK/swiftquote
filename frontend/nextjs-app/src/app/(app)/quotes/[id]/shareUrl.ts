/** Absolute URL of the client portal for a quote's access token. */
export function shareUrl(accessToken: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/p/${accessToken}`
}
