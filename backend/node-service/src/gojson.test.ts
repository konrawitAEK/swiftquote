// Expected messages were captured from the Go service (encoding/json, google/uuid, shopspring/decimal, time.Parse).
import { describe, expect, it } from 'vitest'
import { goQuote, parseDate, parseDecimal, parseUuid, unmarshal, type StructType } from './gojson.js'

const item: StructType = {
  name: 'quoteItemInput',
  fields: { title: { kind: 'string', goType: 'string' }, categoryId: { kind: '*uuid' }, quantity: { kind: '*decimal' } },
}
const createQuote: StructType = {
  name: 'createQuoteRequest',
  fields: {
    clientId: { kind: '*uuid' },
    quoteNumber: { kind: 'string', goType: 'string' },
    expiryDate: { kind: '*date' },
    items: { kind: 'slice', elem: item },
  },
}

const decodeError = (body: string) => {
  const res = unmarshal(Buffer.from(body), createQuote)
  return res.ok ? null : res.error
}

describe('unmarshal reports errors like Go', () => {
  it.each([
    ['', 'unexpected end of JSON input'],
    ['{bad', "invalid character 'b' looking for beginning of object key string"],
    ['{"a":}', "invalid character '}' looking for beginning of value"],
    ['{"a" 1}', "invalid character '1' after object key"],
    ['{"a":1 "b"}', `invalid character '"' after object key:value pair`],
    ['[1 2]', "invalid character '2' after array element"],
    ['{} x', "invalid character 'x' after top-level value"],
    ['tru', "invalid character ' ' in literal true (expecting 'e')"],
    ['trux', "invalid character 'x' in literal true (expecting 'e')"],
    ['{"a":"\\q"}', "invalid character 'q' in string escape code"],
    ['{"a":-x}', "invalid character 'x' in numeric literal"],
    ['{"a":1.}', "invalid character '}' after decimal point in numeric literal"],
    ['{"a":1e}', "invalid character '}' in exponent of numeric literal"],
    ['{"a":01}', "invalid character '1' after object key:value pair"],
    ['"str"', 'json: cannot unmarshal string into Go value of type http.createQuoteRequest'],
    ['{"clientId":5}', 'json: cannot unmarshal number into Go struct field createQuoteRequest.clientId of type *uuid.UUID'],
    ['{"clientId":true}', 'json: cannot unmarshal bool into Go struct field createQuoteRequest.clientId of type *uuid.UUID'],
    ['{"clientId":"abc"}', 'invalid UUID length: 3'],
    ['{"clientId":"","x":1}', 'invalid UUID length: 0'],
    ['{"items":[{"title":5}]}', 'json: cannot unmarshal number into Go struct field quoteItemInput.items.title of type string'],
    ['{"items":[5]}', 'json: cannot unmarshal number into Go struct field createQuoteRequest.items of type http.quoteItemInput'],
    ['{"items":{}}', 'json: cannot unmarshal object into Go struct field createQuoteRequest.items of type []http.quoteItemInput'],
    ['{"items":[{"quantity":"abc"}]}', `error decoding string '"abc"': can't convert abc to decimal`],
    ['{"items":[{"quantity":true}]}', "error decoding string 'true': can't convert true to decimal: exponent is not numeric"],
    ['{"items":[{"quantity":{}}]}', "error decoding string '{}': can't convert {} to decimal"],
    ['{"items":[{"categoryId":5}]}',
      'json: cannot unmarshal number into Go struct field quoteItemInput.items.categoryId of type *uuid.UUID'],
    ['{"expiryDate":5}', 'json: cannot unmarshal number into Go struct field createQuoteRequest.expiryDate of type string'],
    ['{"expiryDate":"01/01/2099"}', 'parsing time "01/01/2099" as "2006-01-02": cannot parse "01/01/2099" as "2006"'],
    ['{"expiryDate":"2026-13-01"}', 'parsing time "2026-13-01": month out of range'],
    ['{"expiryDate":"2026-02-30"}', 'parsing time "2026-02-30": day out of range'],
    ['{"expiryDate":"2026-01-011"}', 'parsing time "2026-01-011": extra text: "1"'],
    ['{"expiryDate":"2026-1-01"}', 'parsing time "2026-1-01" as "2006-01-02": cannot parse "1-01" as "01"'],
    ['{"quoteNumber":5,"clientId":6}', 'json: cannot unmarshal number into Go struct field createQuoteRequest.quoteNumber of type string'],
    // Errors from UnmarshalText/UnmarshalJSON abort and win over earlier type mismatches.
    ['{"quoteNumber":5,"clientId":"x"}', 'invalid UUID length: 1'],
  ])('%s', (body, want) => {
    expect(decodeError(body)).toBe(want)
  })

  it('decodes values, matching keys case-insensitively', () => {
    const res = unmarshal(
      Buffer.from('{"CLIENTID":"{00000000-0000-4000-8000-00000000000A}","Items":[null,{"quantity":"1.50","TITLE":"x"}]}'),
      createQuote,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.clientId).toBe('00000000-0000-4000-8000-00000000000a')
    expect(res.value.quoteNumber).toBe('')
    expect(res.value.expiryDate).toBeNull()
    const items = res.value.items as Record<string, unknown>[]
    expect(items[0]).toEqual({ title: '', categoryId: null, quantity: null })
    expect(String(items[1]!.quantity)).toBe('1.5')
    expect(items[1]!.title).toBe('x')
  })

  it('treats null like Go', () => {
    expect(unmarshal(Buffer.from('null'), createQuote)).toEqual({
      ok: true,
      value: { clientId: null, quoteNumber: '', expiryDate: null, items: null },
    })
  })
})

describe('value parsers', () => {
  it('parses decimals like shopspring', () => {
    expect(parseDecimal('33.33').toFixed()).toBe('33.33')
    expect(parseDecimal('-.5').toFixed()).toBe('-0.5')
    expect(parseDecimal('1e2').toFixed()).toBe('100')
    expect(() => parseDecimal('1.2.3')).toThrow("can't convert 1.2.3 to decimal: too many .s")
    expect(() => parseDecimal('.-5')).toThrow("can't convert .-5 to decimal")
    expect(() => parseDecimal('1e99999')).toThrow("can't convert 1e99999 to decimal: exponent 99999 exceeds MaxDecodeExponent (10000)")
  })

  it('parses uuids like google/uuid', () => {
    expect(parseUuid('urn:uuid:00000000-0000-4000-8000-000000000001')).toBe('00000000-0000-4000-8000-000000000001')
    expect(parseUuid('00000000000040008000000000000001')).toBe('00000000-0000-4000-8000-000000000001')
    expect(() => parseUuid('00000000-0000-4000-8000-00000000000g')).toThrow('invalid UUID format')
  })

  it('parses dates like time.Parse', () => {
    expect(parseDate('2028-02-29')).toBe('2028-02-29')
    expect(() => parseDate('2027-02-29')).toThrow('day out of range')
  })

  it('quotes like %q', () => {
    expect(goQuote('a"b\\c\n\u0001é')).toBe('"a\\"b\\\\c\\n\\x01é"')
  })
})
