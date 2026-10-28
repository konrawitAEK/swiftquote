import { describe, expect, it } from 'vitest'
import { filenameFromDisposition } from './pdf'

describe('filenameFromDisposition', () => {
  it('reads quoted, bare and RFC 5987 filenames', () => {
    expect(filenameFromDisposition('attachment; filename="Q-20261028-001.pdf"')).toBe('Q-20261028-001.pdf')
    expect(filenameFromDisposition('attachment; filename=Q-1.pdf')).toBe('Q-1.pdf')
    expect(filenameFromDisposition("attachment; filename=\"a.pdf\"; filename*=UTF-8''%E0%B8%81.pdf")).toBe('ก.pdf')
  })
  it('returns null when there is no filename', () => {
    expect(filenameFromDisposition(undefined)).toBeNull()
    expect(filenameFromDisposition('attachment')).toBeNull()
  })
})
