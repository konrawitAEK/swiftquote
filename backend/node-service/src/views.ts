// Wire shapes, field for field with contracts/openapi.yaml and the Go service's dto.go (including null vs absent).
import type { AdminUser, CategoryRow, Measure, PublicView, QuoteSummary, Team } from './repository.js'
import type { DashboardSummary } from './admin.js'
import type { Category, Client, Product, Quote, QuoteItem, Ref } from './domain.js'
import { fixed, money } from './json.js'
import { grossOf, lineCost, quoteCost, type LineCost } from './pricing.js'
import type { Money } from './pricing.js'

const refView = (r: Ref | null) => (r === null ? null : { id: r.id, name: r.name })
const optMoney = (d: Money | null) => (d === null ? null : money(d))

/**
 * Who a quote is rendered for. Cost and profit are omitted (absent, not null) for customers and the share link.
 */
export type Audience = 'internal' | 'customer'

export function audienceOf(role: string): Audience {
  return role === 'customer' ? 'customer' : 'internal'
}

const costFields = (c: LineCost) => ({ costTotal: optMoney(c.costTotal), profit: optMoney(c.profit) })

/** A line's cost and profit. */
export const itemCost = (it: QuoteItem): LineCost => lineCost(it.quantity, it.unitCost, it.lineTotal)

/** The line's discount in money: the gross amount less the stored line total. */
export const itemDiscount = (it: QuoteItem): Money => grossOf(it.quantity, it.unitPrice).sub(it.lineTotal)

export function productView(p: Product) {
  return {
    id: p.id,
    name: p.name,
    category: refView(p.category),
    unitPrice: money(p.unitPrice),
    unitCost: money(p.unitCost),
    stock: optMoney(p.stock),
    active: p.active,
  }
}

export function clientView(c: Client) {
  return { id: c.id, name: c.name, email: c.email === '' ? null : c.email }
}

export function categoryView(c: Category) {
  return { id: c.id, name: c.name, active: c.active }
}

export function quoteSummary(s: QuoteSummary) {
  return {
    id: s.id,
    quoteNumber: s.quoteNumber,
    clientName: s.clientName,
    status: s.status,
    grandTotal: money(s.grandTotal),
    expiryDate: s.expiryDate,
    createdBy: refView(s.createdBy),
  }
}

function itemViews(items: QuoteItem[], audience: Audience) {
  return items.map((it) => ({
    product: refView(it.product),
    title: it.title,
    category: refView(it.category),
    description: it.description === '' ? null : it.description,
    quantity: money(it.quantity),
    unitPrice: money(it.unitPrice),
    discountType: it.discountType,
    discountValue: money(it.discountValue),
    discountAmount: money(itemDiscount(it)),
    taxPercent: money(it.taxPercent),
    lineTotal: money(it.lineTotal),
    ...(audience === 'internal' ? { unitCost: optMoney(it.unitCost), ...costFields(itemCost(it)) } : {}),
  }))
}

export function quoteDetail(q: Quote, audience: Audience) {
  return {
    id: q.id,
    quoteNumber: q.quoteNumber,
    status: q.status,
    clientId: q.clientId,
    clientName: q.clientName,
    createdBy: refView(q.createdBy),
    expiryDate: q.expiryDate,
    subtotal: money(q.subtotal),
    discountAmount: money(q.discountAmount),
    taxAmount: money(q.taxAmount),
    grandTotal: money(q.grandTotal),
    ...(audience === 'internal' ? costFields(quoteCost(q.items.map(itemCost))) : {}),
    accessToken: q.accessToken,
    signedBy: q.signedBy,
    signedAt: q.signedAt,
    items: itemViews(q.items, audience),
    history: q.history.map((e) => ({ action: e.action, actor: refView(e.actor), comment: e.comment, at: e.at })),
  }
}

export function publicView(v: PublicView) {
  const q = v.quote
  return {
    quoteNumber: q.quoteNumber,
    status: q.status,
    expiryDate: q.expiryDate,
    signedBy: q.signedBy,
    signedAt: q.signedAt,
    vendorName: v.vendorName,
    vendorLogo: null,
    grandTotal: money(q.grandTotal),
    items: itemViews(q.items, 'customer'),
  }
}

export function adminUserView(u: AdminUser) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, team: refView(u.team), client: refView(u.client) }
}

export function teamView(t: Team) {
  return { id: t.id, name: t.name, wo: refView(t.wo), members: t.members.map((m) => ({ id: m.id, name: m.name })) }
}

const measureView = (m: Measure) => ({ count: m.count, amount: money(m.amount), cost: money(m.cost), profit: money(m.profit) })

const categoryRowView = (r: CategoryRow) => ({
  category: refView(r.category),
  won: measureView(r.won),
  pending: measureView(r.pending),
})

export function dashboardView(s: DashboardSummary) {
  return {
    from: s.range.from,
    to: s.range.to,
    won: measureView(s.won),
    pending: measureView(s.pending),
    inApproval: measureView(s.inApproval),
    sentCount: s.sentCount,
    conversionRate: fixed(s.conversionRate, 4),
    byStatus: s.byStatus.map((r) => ({ status: r.status, count: r.count, amount: money(r.amount) })),
    byMonth: s.byMonth.map((r) => ({ month: r.month, won: measureView(r.won), pending: measureView(r.pending) })),
    byRm: s.byRm.map((r) => ({
      user: { id: r.user.id, name: r.user.name },
      team: r.team,
      quoteCount: r.quoteCount,
      sentCount: r.sentCount,
      won: measureView(r.won),
      pending: measureView(r.pending),
    })),
    byTeam: s.byTeam.map((r) => ({ id: r.id, name: r.name, won: measureView(r.won), pending: measureView(r.pending) })),
    byCategory: s.byCategory.map(categoryRowView),
  }
}
