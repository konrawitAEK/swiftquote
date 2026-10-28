// Quote PDF (A4) for the customer: vendor, client, dates, lines, totals and, once accepted, the signer.
// Never shows cost or profit. Text is set in embedded Noto Sans Thai (Thai) and Noto Sans (everything else),
// both SIL OFL (assets/fonts/OFL.txt); pdfkit shapes it with fontkit so Thai marks sit correctly.
import { readFileSync } from 'node:fs'
import PDFDocument from 'pdfkit'
import type { Decimal } from 'decimal.js'
import type { Quote } from './domain.js'
import { Money } from './pricing.js'
import { itemDiscount } from './views.js'

const FONT_DIR = new URL('../assets/fonts/', import.meta.url)
const FONTS = {
  thai: readFileSync(new URL('NotoSansThai-Regular.ttf', FONT_DIR)),
  thaiBold: readFileSync(new URL('NotoSansThai-Bold.ttf', FONT_DIR)),
  latin: readFileSync(new URL('NotoSans-Regular.ttf', FONT_DIR)),
  latinBold: readFileSync(new URL('NotoSans-Bold.ttf', FONT_DIR)),
}
type FontName = keyof typeof FONTS

const PAGE = { width: 595.28, height: 841.89, margin: 48 }
const RIGHT = PAGE.width - PAGE.margin
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin
const BOTTOM = PAGE.height - PAGE.margin
const INK = '#1f2933'
const MUTED = '#616e7c'
const RULE = '#cbd2d9'
const ACCENT = '#0b4f8a'
const HEADER_FILL = '#eef2f6'

// Table columns: x offsets from the left margin and widths.
const COLS = [
  { key: 'no', label: '#', width: 22, align: 'left' },
  { key: 'item', label: 'Item', width: 199, align: 'left' },
  { key: 'qty', label: 'Qty', width: 50, align: 'right' },
  { key: 'price', label: 'Unit price', width: 78, align: 'right' },
  { key: 'discount', label: 'Discount', width: 72, align: 'right' },
  { key: 'amount', label: 'Amount', width: 78, align: 'right' },
] as const
const CELL_PAD = 4

/** Thai script (incl. its combining marks) uses the Thai font; everything else the Latin one. */
const isThai = (cp: number) => cp >= 0x0e00 && cp <= 0x0e7f

/** Splits text into runs by font; whitespace stays with the run it follows so words are not broken apart. */
function runs(text: string, bold: boolean): { font: FontName; text: string }[] {
  const out: { font: FontName; text: string }[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const last = out.at(-1)
    const thai = isThai(cp)
    const font: FontName = thai ? (bold ? 'thaiBold' : 'thai') : bold ? 'latinBold' : 'latin'
    if (last && (last.font === font || (/\s/u.test(ch) && !thai))) last.text += ch
    else out.push({ font, text: ch })
  }
  return out
}

interface TextStyle {
  width: number
  size?: number
  bold?: boolean
  color?: string
  align?: 'left' | 'right' | 'center'
}

/** Writes text at (x, y) with font fallback; doc.y ends below it. */
function write(doc: PDFKit.PDFDocument, text: string, x: number, y: number, s: TextStyle): void {
  const parts = runs(text, s.bold ?? false)
  doc.fontSize(s.size ?? 10).fillColor(s.color ?? INK)
  if (parts.length === 0) {
    doc.y = y
    return
  }
  parts.forEach((r, i) => {
    doc.font(r.font)
    const opts = { width: s.width, align: s.align ?? 'left', continued: i < parts.length - 1 }
    if (i === 0) doc.text(r.text, x, y, opts)
    else doc.text(r.text, opts)
  })
}

/** Rough height of wrapped text, measured in the Latin font with some slack for Thai line height. */
function heightOf(doc: PDFKit.PDFDocument, text: string, width: number, size: number): number {
  if (text === '') return 0
  return doc.font('latin').fontSize(size).heightOfString(text, { width }) * 1.15
}

/** 1,234.50 */
function amount(d: Decimal): string {
  const [int, frac] = d.toFixed(2).split('.')
  const neg = int!.startsWith('-')
  const digits = neg ? int!.slice(1) : int!
  return `${neg ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`
}

/** 2, 2.5 */
const plain = (d: Decimal) => new Money(d).toDecimalPlaces(2, Money.ROUND_HALF_UP).toFixed()

const day = (rfc3339: string) => rfc3339.slice(0, 10)

function tableHeader(doc: PDFKit.PDFDocument, y: number): number {
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 20).fill(HEADER_FILL)
  let x = PAGE.margin
  for (const c of COLS) {
    write(doc, c.label, x + CELL_PAD, y + 5, { width: c.width - 2 * CELL_PAD, size: 8.5, bold: true, color: MUTED, align: c.align })
    x += c.width
  }
  return y + 24
}

/** Renders the quote; resolves with the PDF bytes. */
export function renderQuotePdf(q: Quote, vendorName: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    info: { Title: `Quotation ${q.quoteNumber}`, Author: vendorName, Subject: `Quotation for ${q.clientName}` },
  })
  for (const [name, data] of Object.entries(FONTS)) doc.registerFont(name, data)
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  // Header: vendor on the left, title and number on the right.
  const top = PAGE.margin
  write(doc, vendorName, PAGE.margin, top, { width: CONTENT_WIDTH * 0.6, size: 18, bold: true, color: ACCENT })
  const vendorBottom = doc.y
  write(doc, 'QUOTATION', PAGE.margin + CONTENT_WIDTH * 0.6, top, { width: CONTENT_WIDTH * 0.4, size: 20, bold: true, align: 'right' })
  write(doc, q.quoteNumber, PAGE.margin + CONTENT_WIDTH * 0.6, doc.y, { width: CONTENT_WIDTH * 0.4, size: 10, color: MUTED, align: 'right' })
  let y = Math.max(vendorBottom, doc.y) + 14
  doc.moveTo(PAGE.margin, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(ACCENT).stroke()
  y += 14

  // Client on the left; quote facts on the right.
  write(doc, 'BILL TO', PAGE.margin, y, { width: 240, size: 8, bold: true, color: MUTED })
  write(doc, q.clientName, PAGE.margin, doc.y + 2, { width: 260, size: 12, bold: true })
  const clientBottom = doc.y
  const facts: [string, string][] = [
    ['Quote number', q.quoteNumber],
    ['Issue date', day(q.createdAt)],
    ['Valid until', q.expiryDate],
  ]
  let fy = y
  const labelX = RIGHT - 220
  for (const [label, value] of facts) {
    write(doc, label, labelX, fy, { width: 100, size: 9, color: MUTED })
    write(doc, value, labelX + 100, fy, { width: 120, size: 9, align: 'right' })
    fy = doc.y + 3
  }
  y = Math.max(clientBottom, fy) + 20

  // Lines.
  y = tableHeader(doc, y)
  q.items.forEach((it, i) => {
    const itemWidth = COLS[1].width - 2 * CELL_PAD
    const desc = it.description.trim()
    const discountNote = it.discountType === 'percent' && !it.discountValue.isZero() ? `${plain(it.discountValue)}%` : ''
    const estimate = Math.max(heightOf(doc, it.title, itemWidth, 10) + heightOf(doc, desc, itemWidth, 8.5) + 2, discountNote ? 28 : 14) + 10
    if (y + estimate > BOTTOM) {
      doc.addPage()
      y = tableHeader(doc, PAGE.margin)
    }
    const cells: Record<(typeof COLS)[number]['key'], string> = {
      no: String(i + 1),
      item: '',
      qty: plain(it.quantity),
      price: amount(it.unitPrice),
      discount: it.discountValue.isZero() ? '-' : amount(itemDiscount(it)),
      amount: amount(it.lineTotal),
    }
    let x = PAGE.margin
    let bottom = y
    for (const c of COLS) {
      const w = c.width - 2 * CELL_PAD
      if (c.key === 'item') {
        write(doc, it.title, x + CELL_PAD, y, { width: w, size: 10, bold: true })
        if (desc !== '') write(doc, desc, x + CELL_PAD, doc.y + 1, { width: w, size: 8.5, color: MUTED })
      } else {
        write(doc, cells[c.key], x + CELL_PAD, y, { width: w, size: 10, align: c.align })
        if (c.key === 'discount' && discountNote) write(doc, discountNote, x + CELL_PAD, doc.y, { width: w, size: 8, color: MUTED, align: 'right' })
      }
      bottom = Math.max(bottom, doc.y)
      x += c.width
    }
    y = bottom + 5
    doc.moveTo(PAGE.margin, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor(RULE).stroke()
    y += 6
  })

  // Totals.
  const totals: [string, string, boolean][] = [
    ['Subtotal', amount(q.subtotal), false],
    ['Discount', q.discountAmount.isZero() ? amount(q.discountAmount) : `-${amount(q.discountAmount)}`, false],
    ['VAT', amount(q.taxAmount), false],
    ['Grand total', amount(q.grandTotal), true],
  ]
  if (y + 110 > BOTTOM) {
    doc.addPage()
    y = PAGE.margin
  }
  y += 6
  const tx = RIGHT - 230
  for (const [label, value, strong] of totals) {
    if (strong) {
      doc.moveTo(tx, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(INK).stroke()
      y += 6
    }
    write(doc, label, tx, y, { width: 120, size: strong ? 12 : 10, bold: strong, color: strong ? INK : MUTED })
    write(doc, value, tx + 110, y, { width: 120, size: strong ? 12 : 10, bold: strong, align: 'right' })
    y = doc.y + 4
  }

  // Signature, once accepted.
  if (q.status === 'accepted' && q.signedBy !== null) {
    if (y + 70 > BOTTOM) {
      doc.addPage()
      y = PAGE.margin
    }
    y += 24
    write(doc, 'ACCEPTED BY', PAGE.margin, y, { width: 240, size: 8, bold: true, color: MUTED })
    write(doc, q.signedBy, PAGE.margin, doc.y + 2, { width: 300, size: 12, bold: true })
    if (q.signedAt !== null) write(doc, `Signed on ${day(q.signedAt)}`, PAGE.margin, doc.y + 2, { width: 300, size: 9, color: MUTED })
  }

  doc.end()
  return done
}

/** The attachment file name: the quote number with characters outside [A-Za-z0-9._-] replaced by "_". */
export function pdfFileName(quoteNumber: string): string {
  return `${quoteNumber.replace(/[^A-Za-z0-9._-]/gu, '_')}.pdf`
}
