// Request decoding that behaves like the Go service: encoding/json into its request structs, with
// google/uuid, shopspring/decimal and a YYYY-MM-DD date type. Malformed bodies therefore produce the same
// "malformed JSON body: ..." details, and the same values are accepted and rejected.
import { Money } from './pricing.js'

// ---------------------------------------------------------------------------------------------------------
// strconv.Quote / fmt %q

const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]$/u
const SHORT_ESCAPES: Record<number, string> = { 7: '\\a', 8: '\\b', 12: '\\f', 10: '\\n', 13: '\\r', 9: '\\t', 11: '\\v' }

/** Go's strconv.Quote, as used by fmt's %q. */
export function goQuote(s: string): string {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '"' || ch === '\\') out += '\\' + ch
    else if (PRINTABLE.test(ch)) out += ch
    else if (SHORT_ESCAPES[c] !== undefined) out += SHORT_ESCAPES[c]
    else if (c < 0x20 || c === 0x7f) out += '\\x' + c.toString(16).padStart(2, '0')
    else if (c < 0x10000) out += '\\u' + c.toString(16).padStart(4, '0')
    else out += '\\U' + c.toString(16).padStart(8, '0')
  }
  return out + '"'
}

// ---------------------------------------------------------------------------------------------------------
// encoding/json scanner (scanner.go), byte for byte, so syntax errors read exactly like Go's.

const enum Parse {
  ObjectKey,
  ObjectValue,
  ArrayValue,
}

const MAX_NESTING_DEPTH = 10000

type Step = (s: Scanner, c: number) => boolean // false = error (s.err set)

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a
const isDigit = (c: number) => c >= 0x30 && c <= 0x39
const isHex = (c: number) => isDigit(c) || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46)

function quoteChar(c: number): string {
  if (c === 0x27) return `'\\''`
  if (c === 0x22) return `'"'`
  const s = goQuote(String.fromCharCode(c))
  return `'${s.slice(1, -1)}'`
}

class Scanner {
  step: Step = beginValue
  parseState: Parse[] = []
  endTop = false
  err: string | null = null

  fail(c: number, context: string): false {
    this.step = () => false
    this.err = `invalid character ${quoteChar(c)} ${context}`
    return false
  }

  push(c: number, next: Step, p: Parse): boolean {
    this.step = next
    this.parseState.push(p)
    return this.parseState.length <= MAX_NESTING_DEPTH ? true : this.fail(c, 'exceeded max depth')
  }

  pop(): void {
    this.parseState.pop()
    if (this.parseState.length === 0) {
      this.step = endTop
      this.endTop = true
    } else {
      this.step = endValue
    }
  }
}

function beginValueOrEmpty(s: Scanner, c: number): boolean {
  if (isSpace(c)) return true
  if (c === 0x5d) return endValue(s, c)
  return beginValue(s, c)
}

function beginValue(s: Scanner, c: number): boolean {
  if (isSpace(c)) return true
  switch (c) {
    case 0x7b: return s.push(c, beginStringOrEmpty, Parse.ObjectKey)
    case 0x5b: return s.push(c, beginValueOrEmpty, Parse.ArrayValue)
    case 0x22: s.step = inString; return true
    case 0x2d: s.step = neg; return true
    case 0x30: s.step = zero; return true
    case 0x74: s.step = literal('true', 1); return true
    case 0x66: s.step = literal('false', 1); return true
    case 0x6e: s.step = literal('null', 1); return true
  }
  if (c >= 0x31 && c <= 0x39) {
    s.step = one
    return true
  }
  return s.fail(c, 'looking for beginning of value')
}

function beginStringOrEmpty(s: Scanner, c: number): boolean {
  if (isSpace(c)) return true
  if (c === 0x7d) {
    s.parseState[s.parseState.length - 1] = Parse.ObjectValue
    return endValue(s, c)
  }
  return beginString(s, c)
}

function beginString(s: Scanner, c: number): boolean {
  if (isSpace(c)) return true
  if (c === 0x22) {
    s.step = inString
    return true
  }
  return s.fail(c, 'looking for beginning of object key string')
}

function endValue(s: Scanner, c: number): boolean {
  const n = s.parseState.length
  if (n === 0) {
    s.step = endTop
    s.endTop = true
    return endTop(s, c)
  }
  if (isSpace(c)) {
    s.step = endValue
    return true
  }
  switch (s.parseState[n - 1]) {
    case Parse.ObjectKey:
      if (c === 0x3a) {
        s.parseState[n - 1] = Parse.ObjectValue
        s.step = beginValue
        return true
      }
      return s.fail(c, 'after object key')
    case Parse.ObjectValue:
      if (c === 0x2c) {
        s.parseState[n - 1] = Parse.ObjectKey
        s.step = beginString
        return true
      }
      if (c === 0x7d) {
        s.pop()
        return true
      }
      return s.fail(c, 'after object key:value pair')
    default:
      if (c === 0x2c) {
        s.step = beginValue
        return true
      }
      if (c === 0x5d) {
        s.pop()
        return true
      }
      return s.fail(c, 'after array element')
  }
}

function endTop(s: Scanner, c: number): boolean {
  return isSpace(c) ? true : s.fail(c, 'after top-level value')
}

function inString(s: Scanner, c: number): boolean {
  if (c === 0x22) s.step = endValue
  else if (c === 0x5c) s.step = inStringEsc
  else if (c < 0x20) return s.fail(c, 'in string literal')
  return true
}

function inStringEsc(s: Scanner, c: number): boolean {
  if ([0x62, 0x66, 0x6e, 0x72, 0x74, 0x5c, 0x2f, 0x22].includes(c)) {
    s.step = inString
    return true
  }
  if (c === 0x75) {
    s.step = inStringEscU(4)
    return true
  }
  return s.fail(c, 'in string escape code')
}

function inStringEscU(left: number): Step {
  return (s, c) => {
    if (!isHex(c)) return s.fail(c, 'in \\u hexadecimal character escape')
    s.step = left === 1 ? inString : inStringEscU(left - 1)
    return true
  }
}

function neg(s: Scanner, c: number): boolean {
  if (c === 0x30) s.step = zero
  else if (c >= 0x31 && c <= 0x39) s.step = one
  else return s.fail(c, 'in numeric literal')
  return true
}

function one(s: Scanner, c: number): boolean {
  if (isDigit(c)) return true
  return zero(s, c)
}

function zero(s: Scanner, c: number): boolean {
  if (c === 0x2e) {
    s.step = dot
    return true
  }
  if (c === 0x65 || c === 0x45) {
    s.step = exp
    return true
  }
  return endValue(s, c)
}

function dot(s: Scanner, c: number): boolean {
  if (isDigit(c)) {
    s.step = dot0
    return true
  }
  return s.fail(c, 'after decimal point in numeric literal')
}

function dot0(s: Scanner, c: number): boolean {
  if (isDigit(c)) return true
  if (c === 0x65 || c === 0x45) {
    s.step = exp
    return true
  }
  return endValue(s, c)
}

function exp(s: Scanner, c: number): boolean {
  if (c === 0x2b || c === 0x2d) {
    s.step = expSign
    return true
  }
  return expSign(s, c)
}

function expSign(s: Scanner, c: number): boolean {
  if (isDigit(c)) {
    s.step = exp0
    return true
  }
  return s.fail(c, 'in exponent of numeric literal')
}

function exp0(s: Scanner, c: number): boolean {
  return isDigit(c) ? true : endValue(s, c)
}

function literal(word: string, i: number): Step {
  return (s, c) => {
    const want = word.charCodeAt(i)
    if (c !== want) return s.fail(c, `in literal ${word} (expecting ${quoteChar(want)})`)
    s.step = i === word.length - 1 ? endValue : literal(word, i + 1)
    return true
  }
}

/** checkValid: returns Go's syntax error message, or null. */
function checkValid(data: Buffer): string | null {
  const s = new Scanner()
  for (const c of data) {
    if (!s.step(s, c)) return s.err
  }
  if (s.endTop) return null
  if (!s.step(s, 0x20)) return s.err
  return s.endTop ? null : 'unexpected end of JSON input'
}

// ---------------------------------------------------------------------------------------------------------
// A syntax tree of already-valid JSON that keeps each value's raw text (shopspring/decimal reads raw bytes).

type Node =
  | { t: 'null'; raw: string }
  | { t: 'bool'; raw: string; v: boolean }
  | { t: 'number'; raw: string }
  | { t: 'string'; raw: string; v: string }
  | { t: 'array'; raw: string; items: Node[] }
  | { t: 'object'; raw: string; entries: [string, Node][] }

class TreeParser {
  i = 0

  constructor(private readonly d: Buffer) {}

  ws(): void {
    while (this.i < this.d.length && isSpace(this.d[this.i]!)) this.i++
  }

  value(): Node {
    this.ws()
    const start = this.i
    const c = this.d[this.i]!
    const raw = () => this.d.toString('utf8', start, this.i)
    if (c === 0x7b) {
      this.i++
      const entries: [string, Node][] = []
      this.ws()
      if (this.d[this.i] === 0x7d) this.i++
      else {
        for (;;) {
          this.ws()
          const key = this.string()
          this.ws()
          this.i++ // ':'
          entries.push([key, this.value()])
          this.ws()
          if (this.d[this.i++] === 0x7d) break // else ','
        }
      }
      return { t: 'object', raw: raw(), entries }
    }
    if (c === 0x5b) {
      this.i++
      const items: Node[] = []
      this.ws()
      if (this.d[this.i] === 0x5d) this.i++
      else {
        for (;;) {
          items.push(this.value())
          this.ws()
          if (this.d[this.i++] === 0x5d) break
        }
      }
      return { t: 'array', raw: raw(), items }
    }
    if (c === 0x22) {
      const v = this.string()
      return { t: 'string', raw: raw(), v }
    }
    if (c === 0x74 || c === 0x66 || c === 0x6e) {
      this.i += c === 0x66 ? 5 : 4
      return c === 0x6e ? { t: 'null', raw: 'null' } : { t: 'bool', raw: raw(), v: c === 0x74 }
    }
    while (this.i < this.d.length && /[-+.eE0-9]/.test(String.fromCharCode(this.d[this.i]!))) this.i++
    return { t: 'number', raw: raw() }
  }

  string(): string {
    const start = this.i
    this.i++
    while (this.d[this.i] !== 0x22) this.i += this.d[this.i] === 0x5c ? 2 : 1
    this.i++
    return JSON.parse(this.d.toString('utf8', start, this.i)) as string
  }
}

// ---------------------------------------------------------------------------------------------------------
// google/uuid, shopspring/decimal and time.Parse("2006-01-02"), with their error messages.

const UUID_HEX_AT = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34]

/** uuid.Parse: returns the canonical lowercase form, or throws Error with Go's message. */
export function parseUuid(s: string): string {
  let b = Buffer.from(s, 'utf8')
  const hex = (i: number) => isHex(b[i]!) && isHex(b[i + 1]!)
  const bad = () => new Error('invalid UUID format')
  switch (b.length) {
    case 36:
      break
    case 45:
      if (b.subarray(0, 9).toString('latin1').toLowerCase() !== 'urn:uuid:') {
        throw new Error(`invalid urn prefix: ${goQuote(b.subarray(0, 9).toString('utf8'))}`)
      }
      b = b.subarray(9)
      break
    case 38:
      b = b.subarray(1)
      break
    case 32: {
      for (let i = 0; i < 32; i += 2) if (!hex(i)) throw bad()
      const h = b.toString('latin1').toLowerCase()
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    }
    default:
      throw new Error(`invalid UUID length: ${b.length}`)
  }
  if (b[8] !== 0x2d || b[13] !== 0x2d || b[18] !== 0x2d || b[23] !== 0x2d) throw bad()
  for (const i of UUID_HEX_AT) if (!hex(i)) throw bad()
  return b.subarray(0, 36).toString('latin1').toLowerCase()
}

/** A path id: malformed ids become the nil UUID, which no row has, so they read as "not found". */
export function pathUuid(s: string): string {
  try {
    return parseUuid(s)
  } catch {
    return '00000000-0000-0000-0000-000000000000'
  }
}

const MAX_DECODE_EXPONENT = 10000
const INT32 = 2 ** 31

/** strconv.ParseInt(s, 10, bits) */
function parseGoInt(s: string, bits: number): { ok: true; v: bigint } | { ok: false; range: boolean } {
  if (!/^[+-]?\d+$/.test(s)) return { ok: false, range: false }
  const v = BigInt(s)
  const lim = 2n ** BigInt(bits - 1)
  return v < -lim || v >= lim ? { ok: false, range: true } : { ok: true, v }
}

/** decimal.NewFromString (shopspring v1.6.0). */
export function parseDecimal(input: string): Money {
  let value = input.replaceAll('−', '-')
  let eIndex = -1
  let pIndex = -1
  for (let i = 0; i < value.length; i++) {
    const r = value[i]
    if (r === 'E' || r === 'e') {
      if (eIndex > -1) throw new Error(`can't convert ${value} to decimal: multiple 'E' characters found`)
      eIndex = i
      continue
    }
    if (r === '.') {
      if (pIndex > -1) throw new Error(`can't convert ${value} to decimal: too many .s`)
      pIndex = i
    }
  }
  let exponent = 0n
  if (eIndex !== -1) {
    const e = parseGoInt(value.slice(eIndex + 1), 32)
    if (!e.ok) {
      throw new Error(`can't convert ${value} to decimal: ${e.range ? 'fractional part too long' : 'exponent is not numeric'}`)
    }
    value = value.slice(0, eIndex)
    exponent = e.v
  }
  let digits = value
  if (pIndex !== -1) {
    const next = value[pIndex + 1]
    if (next === '-' || next === '+') throw new Error(`can't convert ${value} to decimal`)
    exponent -= BigInt(value.length - pIndex - 1)
    digits = value.slice(0, pIndex) + value.slice(pIndex + 1)
  }
  if (!/^[+-]?\d+$/.test(digits)) throw new Error(`can't convert ${value} to decimal`)
  if (exponent < -BigInt(INT32) || exponent >= BigInt(INT32)) {
    throw new Error(`can't convert ${input} to decimal: fractional part too long`)
  }
  if (exponent > MAX_DECODE_EXPONENT || exponent < -MAX_DECODE_EXPONENT) {
    throw new Error(`can't convert ${input} to decimal: exponent ${exponent} exceeds MaxDecodeExponent (${MAX_DECODE_EXPONENT})`)
  }
  return new Money(`${digits}e${exponent}`)
}

/** time's own quote(): non-ASCII and control bytes become \xNN. */
function timeQuote(s: string): string {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c >= 0x80 || c < 0x20) {
      for (const byte of Buffer.from(ch, 'utf8')) out += '\\x' + byte.toString(16).padStart(2, '0')
    } else {
      out += ch === '"' || ch === '\\' ? '\\' + ch : ch
    }
  }
  return out + '"'
}

const DATE_LAYOUT = '2006-01-02'

function daysIn(month: number, year: number): number {
  if (month === 2) return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** time.Parse("2006-01-02", s): returns s (always canonical when valid), or throws Error with Go's message. */
export function parseDate(s: string): string {
  const cannot = (valueElem: string, layoutElem: string) =>
    new Error(`parsing time ${timeQuote(s)} as ${timeQuote(DATE_LAYOUT)}: cannot parse ${timeQuote(valueElem)} as ${timeQuote(layoutElem)}`)
  const message = (msg: string) => new Error(`parsing time ${timeQuote(s)}${msg}`)
  const digitAt = (v: string, i: number) => i < v.length && v[i]! >= '0' && v[i]! <= '9'
  // getnum(value, fixed=true)
  const twoDigits = (v: string): number | null => (digitAt(v, 0) && digitAt(v, 1) ? Number(v.slice(0, 2)) : null)
  const skipDash = (v: string) => {
    if (v[0] !== '-') throw cannot(v, '-')
    return v.slice(1)
  }

  let v = s
  if (v.length < 4 || !digitAt(v, 0) || !/^[+-]?\d+$/.test(v.slice(0, 4))) throw cannot(v, '2006')
  const year = Number(v.slice(0, 4))
  v = skipDash(v.slice(4))
  const month = twoDigits(v)
  if (month === null) throw cannot(v, '01')
  v = v.slice(2)
  if (month <= 0 || month > 12) throw message(': month out of range')
  v = skipDash(v)
  const day = twoDigits(v)
  if (day === null) throw cannot(v, '02')
  v = v.slice(2)
  if (v.length > 0) throw message(`: extra text: ${timeQuote(v)}`)
  if (day < 1 || day > daysIn(month, year)) throw message(': day out of range')
  return s
}

// ---------------------------------------------------------------------------------------------------------
// Struct decoding (decode.go): type mismatches are recorded and decoding continues; errors from
// UnmarshalJSON/UnmarshalText (uuid, decimal, date) abort. The first applies only if nothing aborted.

export type FieldType =
  | { kind: 'string'; goType: string } // a non-pointer string kind: string, domain.Role
  | { kind: '*string' }
  | { kind: '*bool' }
  | { kind: '*uuid' }
  | { kind: '*decimal' }
  | { kind: '*date' }
  | { kind: 'slice'; elem: StructType }

export interface StructType {
  name: string
  fields: Record<string, FieldType>
}

type Decoded = Record<string, unknown>

class Abort extends Error {}

const kindName = (n: Node) => n.t

class StructDecoder {
  saved: string | null = null
  structName: string | null = null
  stack: string[] = []

  typeError(value: string, goType: string): string {
    return this.structName !== null || this.stack.length > 0
      ? `json: cannot unmarshal ${value} into Go struct field ${this.structName}.${this.stack.join('.')} of type ${goType}`
      : `json: cannot unmarshal ${value} into Go value of type ${goType}`
  }

  save(value: string, goType: string): void {
    this.saved ??= this.typeError(value, goType)
  }

  zero(t: StructType): Decoded {
    const out: Decoded = {}
    for (const [name, f] of Object.entries(t.fields)) out[name] = f.kind === 'string' ? '' : null
    return out
  }

  struct(node: Node, t: StructType, out: Decoded): void {
    if (node.t !== 'object') throw new Error('unreachable')
    const names = Object.keys(t.fields)
    for (const [key, value] of node.entries) {
      const name = names.find((n) => n === key) ?? names.find((n) => n.toLowerCase() === key.toLowerCase())
      if (name === undefined) continue
      const outer = { structName: this.structName, depth: this.stack.length }
      this.structName = t.name
      this.stack.push(name)
      this.field(value, t.fields[name]!, out, name)
      this.stack.length = outer.depth
      this.structName = outer.structName
    }
  }

  field(n: Node, f: FieldType, out: Decoded, name: string): void {
    if (n.t === 'null') {
      if (f.kind !== 'string') out[name] = null
      return
    }
    switch (f.kind) {
      case 'string':
      case '*string':
        if (n.t === 'string') out[name] = n.v
        else this.save(kindName(n), f.kind === 'string' ? f.goType : 'string')
        return
      case '*bool':
        if (n.t === 'bool') out[name] = n.v
        else this.save(kindName(n), 'bool')
        return
      case '*uuid':
        if (n.t !== 'string') return this.save(kindName(n), '*uuid.UUID')
        out[name] = this.abortOn(() => parseUuid(n.v))
        return
      case '*decimal':
        out[name] = this.abortOn(() => {
          try {
            const raw = n.raw
            return parseDecimal(raw.length > 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw)
          } catch (err) {
            throw new Error(`error decoding string '${n.raw}': ${(err as Error).message}`)
          }
        })
        return
      case '*date':
        // date.UnmarshalJSON decodes into a string first; its type error gets this field's context.
        if (n.t !== 'string') throw new Abort(this.typeError(kindName(n), 'string'))
        out[name] = this.abortOn(() => parseDate(n.v))
        return
      case 'slice': {
        const goType = `[]http.${f.elem.name}`
        if (n.t !== 'array') return this.save(kindName(n), goType)
        out[name] = n.items.map((item) => {
          const elem = this.zero(f.elem)
          if (item.t === 'object') this.struct(item, f.elem, elem)
          else if (item.t !== 'null') this.save(kindName(item), `http.${f.elem.name}`)
          return elem
        })
        return
      }
    }
  }

  abortOn<T>(fn: () => T): T {
    try {
      return fn()
    } catch (err) {
      throw new Abort((err as Error).message)
    }
  }
}

/** The outcome of decoding: the struct's fields, or Go's error text. */
export type DecodeResult = { ok: true; value: Decoded } | { ok: false; error: string }

/** json.Unmarshal(body, &t). An empty body is "unexpected end of JSON input", as in Go. */
export function unmarshal(body: Buffer, t: StructType): DecodeResult {
  const syntax = checkValid(body)
  if (syntax !== null) return { ok: false, error: syntax }
  const node = new TreeParser(body).value()
  const d = new StructDecoder()
  const out = d.zero(t)
  try {
    if (node.t === 'object') d.struct(node, t, out)
    else if (node.t !== 'null') d.save(kindName(node), `http.${t.name}`)
  } catch (err) {
    if (err instanceof Abort) return { ok: false, error: err.message }
    throw err
  }
  return d.saved !== null ? { ok: false, error: d.saved } : { ok: true, value: out }
}
