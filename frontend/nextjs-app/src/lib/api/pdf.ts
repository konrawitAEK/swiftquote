import { isAxiosError, type AxiosResponse } from 'axios'

export interface PdfFile {
  blob: Blob
  filename: string
}

/**
 * The filename from a Content-Disposition header (filename* or filename), or null.
 * Cross-origin, the browser only exposes the header if the API lists it in Access-Control-Expose-Headers.
 */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim())
    } catch {
      // fall through to the plain parameter
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header)
  const name = plain ? (plain[2] ?? plain[1]).trim() : ''
  return name || null
}

/** A blob response as a file, named by Content-Disposition or the fallback. */
export function toPdfFile(response: AxiosResponse<Blob>, fallbackName: string): PdfFile {
  const header = response.headers['content-disposition'] as string | undefined
  return { blob: response.data, filename: filenameFromDisposition(header) ?? fallbackName }
}

/**
 * With responseType 'blob' an error body arrives as a Blob too; parse it back to JSON so errorText() can show
 * the API's message (e.g. the 409 for a quote that cannot be downloaded yet). Returns the error for rethrowing.
 */
export async function withJsonErrorBody(err: unknown): Promise<unknown> {
  if (isAxiosError(err) && err.response && err.response.data instanceof Blob) {
    try {
      err.response.data = JSON.parse(await err.response.data.text()) as unknown
    } catch {
      // not JSON: leave it, errorText() falls back to its generic text
    }
  }
  return err
}

/** Saves a file from the browser through a temporary object URL. */
export function saveFile({ blob, filename }: PdfFile): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
