import { describe, expect, it } from 'vitest'
import { filenameFrom } from './http'

describe('filenameFrom', () => {
  it('reads a quoted filename', () => expect(filenameFrom('attachment; filename="Q-1.pdf"')).toBe('Q-1.pdf'))
  it('reads an unquoted filename', () => expect(filenameFrom('attachment; filename=Q-2.pdf')).toBe('Q-2.pdf'))
  it('prefers filename*', () =>
    expect(filenameFrom(`attachment; filename="x.pdf"; filename*=UTF-8''%E0%B8%81-1.pdf`)).toBe('ก-1.pdf'))
  it('returns null without a header', () => expect(filenameFrom(undefined)).toBeNull())
})
