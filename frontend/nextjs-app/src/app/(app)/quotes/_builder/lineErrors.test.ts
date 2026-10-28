import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { splitLineErrors } from './lineErrors'

function badRequest(details: string[]) {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('400', 'ERR_BAD_REQUEST', config, null, {
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config,
    data: { code: 'VALIDATION_ERROR', message: 'request validation failed', details },
  })
}

describe('splitLineErrors', () => {
  it('groups item details by line and keeps the rest in the message', () => {
    const got = splitLineErrors(
      badRequest(['items[0].productId is required', 'items[1]: discountValue must not exceed the line amount', 'expiryDate is required']),
      'x',
    )
    expect(got.lines).toEqual({ 0: ['productId is required'], 1: ['discountValue must not exceed the line amount'] })
    expect(got.message).toBe('request validation failed: expiryDate is required')
  })

  it('points at the lines when every detail is about a line', () => {
    const got = splitLineErrors(badRequest(['items[2]: quantity must be at least 1']), 'x')
    expect(got.lines).toEqual({ 2: ['quantity must be at least 1'] })
    expect(got.message).toBe('request validation failed: see the highlighted line')
  })

  it('falls back to the plain error text', () => {
    expect(splitLineErrors(new Error('boom'), 'Could not save')).toEqual({ message: 'Could not save', lines: {} })
  })
})
