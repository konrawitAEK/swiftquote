import { describe, expect, it } from 'vitest'
import { homePath } from './roles'
import { encodeUser, parseUser } from './session'

describe('homePath', () => {
  it('sends each role to its landing page', () => {
    expect(homePath('admin')).toBe('/settings')
    expect(homePath('woc')).toBe('/dashboard')
    expect(homePath('wo')).toBe('/quotes')
    expect(homePath('rm')).toBe('/quotes')
    expect(homePath('customer')).toBe('/quotes')
  })
})

describe('user cookie', () => {
  it('round-trips a user', () => {
    const user = { id: 'u1', name: 'Rin M. "RM"', role: 'rm' as const }
    expect(parseUser(encodeUser(user))).toEqual(user)
  })
  it('rejects missing, malformed and unknown-role values', () => {
    expect(parseUser(undefined)).toBeNull()
    expect(parseUser('%7Bnot-json')).toBeNull()
    expect(parseUser(encodeURIComponent(JSON.stringify({ id: 'u1', name: 'x', role: 'owner' })))).toBeNull()
  })
})
