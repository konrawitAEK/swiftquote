// User, team, category, client and dashboard use cases; rules and messages mirror
// backend/go-service/internal/{admin,catalog,client,dashboard}. Check order: 403 role, 404 target, 400 input, 409 conflicts.
import { randomUUID } from 'node:crypto'
import {
  conflict,
  invalid,
  isRole,
  notFound,
  Problems,
  QUOTE_STATUSES,
  roleForbidden,
  type Actor,
  type Category,
  type Client,
  type QuoteStatus,
} from './domain.js'
import { goQuote } from './gojson.js'
import { Money } from './pricing.js'
import {
  DuplicateError,
  type AdminUser,
  type CategoryRow,
  type Measure,
  type MonthRow,
  type Range,
  type Repository,
  type RmRow,
  type StatusRow,
  type Team,
  type TeamRow,
  type UserInput,
} from './repository.js'
import { hashPassword } from './services.js'

const MIN_PASSWORD_LENGTH = 8
const passwordTooShort = `password must be at least ${MIN_PASSWORD_LENGTH} characters`
/** Go measures strings in bytes. */
const byteLength = (s: string) => Buffer.byteLength(s)

function guard(a: Actor): void {
  if (a.role !== 'admin') throw roleForbidden()
}

async function onDuplicate<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw err instanceof DuplicateError ? conflict(message) : err
  }
}

export class AdminService {
  constructor(private readonly repo: Repository) {}

  listUsers(a: Actor): Promise<AdminUser[]> {
    guard(a)
    return this.repo.listUsers(a.tenantId)
  }

  async createUser(a: Actor, input: UserInput): Promise<AdminUser> {
    guard(a)
    const in_: UserInput = { ...input, email: input.email.trim().toLowerCase(), name: input.name.trim(), active: true }
    const p = new Problems()
    if (in_.email === '') p.add('email is required')
    else if (!in_.email.includes('@')) p.add('email is not valid')
    if (in_.password === null || byteLength(in_.password) < MIN_PASSWORD_LENGTH) p.add(passwordTooShort)
    await this.checkUser(a, in_, p)
    const hash = await hashPassword(in_.password!)
    const id = randomUUID()
    await onDuplicate(() => this.repo.createUser(a.tenantId, id, in_, hash), `email ${goQuote(in_.email)} already exists`)
    return (await this.repo.getUser(a.tenantId, id))!
  }

  async updateUser(a: Actor, id: string, input: UserInput): Promise<AdminUser> {
    guard(a)
    const current = await this.repo.getUser(a.tenantId, id)
    if (!current) throw notFound('user not found')
    const in_: UserInput = { ...input, email: current.email, name: input.name.trim() }
    const p = new Problems()
    if (in_.active === null) p.add('active is required')
    const active = in_.active === true
    if (in_.password !== null && byteLength(in_.password) < MIN_PASSWORD_LENGTH) p.add(passwordTooShort)
    if (id === a.userId && (in_.role !== 'admin' || !active)) p.add('you cannot change your own role or deactivate yourself')
    await this.checkUser(a, in_, p)
    if (current.role === 'wo' && (in_.role !== 'wo' || !active) && (await this.repo.leadsTeam(a.tenantId, id))) {
      throw conflict('user leads a team; assign another WO first')
    }
    const hash = in_.password === null ? null : await hashPassword(in_.password)
    await this.repo.updateUser(a.tenantId, id, in_, hash)
    return (await this.repo.getUser(a.tenantId, id))!
  }

  /** Validates name, role and placement (team for RMs, client for customers), after the caller's own checks. */
  private async checkUser(a: Actor, in_: UserInput, p: Problems): Promise<void> {
    if (in_.name === '') p.add('name is required')
    if (!isRole(in_.role)) p.add(`role ${goQuote(in_.role)} is not a valid Role`)
    if (in_.teamId !== null && in_.role !== 'rm') p.add('teamId is only allowed for rm')
    if (in_.role === 'customer' && in_.clientId === null) p.add('clientId is required for customer')
    if (in_.clientId !== null && in_.role !== 'customer') p.add('clientId is only allowed for customer')
    p.check()
    if (in_.teamId !== null && !(await this.repo.teamExists(a.tenantId, in_.teamId))) throw invalid('teamId does not exist')
    if (in_.clientId !== null && !(await this.repo.clientExists(a.tenantId, in_.clientId))) {
      throw invalid('clientId does not exist')
    }
  }

  listTeams(a: Actor): Promise<Team[]> {
    guard(a)
    return this.repo.listTeams(a.tenantId)
  }

  async createTeam(a: Actor, name: string, woUserId: string | null): Promise<Team> {
    guard(a)
    const n = await this.checkTeam(a, name, woUserId)
    const id = randomUUID()
    await onDuplicate(() => this.repo.createTeam(a.tenantId, id, n, woUserId!), `team ${goQuote(n)} already exists`)
    return (await this.repo.getTeam(a.tenantId, id))!
  }

  async updateTeam(a: Actor, id: string, name: string, woUserId: string | null): Promise<Team> {
    guard(a)
    if (!(await this.repo.getTeam(a.tenantId, id))) throw notFound('team not found')
    const n = await this.checkTeam(a, name, woUserId)
    await onDuplicate(() => this.repo.updateTeam(a.tenantId, id, n, woUserId!), `team ${goQuote(n)} already exists`)
    return (await this.repo.getTeam(a.tenantId, id))!
  }

  private async checkTeam(a: Actor, name: string, woUserId: string | null): Promise<string> {
    const n = name.trim()
    const p = new Problems()
    if (n === '') p.add('name is required')
    if (woUserId === null) p.add('woUserId is required')
    p.check()
    if (!(await this.repo.isActiveWo(a.tenantId, woUserId!))) throw invalid('woUserId must be an active WO')
    return n
  }
}

/** Product categories used to classify quote lines. */
export class CatalogService {
  constructor(private readonly repo: Repository) {}

  /** For RMs picking a category, WOC reading the dashboard and admins managing the list. */
  list(a: Actor): Promise<Category[]> {
    if (a.role !== 'rm' && a.role !== 'woc' && a.role !== 'admin') throw roleForbidden()
    return this.repo.listCategories(a.tenantId)
  }

  async create(a: Actor, name: string): Promise<Category> {
    guard(a)
    const n = name.trim()
    if (n === '') throw invalid('name is required')
    const id = randomUUID()
    await onDuplicate(() => this.repo.createCategory(a.tenantId, id, n), `category ${goQuote(n)} already exists`)
    return (await this.repo.getCategory(a.tenantId, id))!
  }

  async update(a: Actor, id: string, name: string, active: boolean | null): Promise<Category> {
    guard(a)
    if (!(await this.repo.getCategory(a.tenantId, id))) throw notFound('category not found')
    const n = name.trim()
    const p = new Problems()
    if (n === '') p.add('name is required')
    if (active === null) p.add('active is required')
    p.check()
    await onDuplicate(() => this.repo.updateCategory(a.tenantId, id, n, active!), `category ${goQuote(n)} already exists`)
    return (await this.repo.getCategory(a.tenantId, id))!
  }
}

/** The tenant's client directory, for RMs picking a client and admins linking customers to one. */
export class ClientService {
  constructor(private readonly repo: Repository) {}

  list(a: Actor): Promise<Client[]> {
    if (a.role !== 'rm' && a.role !== 'admin') throw roleForbidden()
    return this.repo.listClients(a.tenantId)
  }
}

// Dashboard measures, reported side by side so the client can switch views without refetching:
//   - won: accepted
//   - pending: sent or viewed and not yet expired (waiting on the customer)
//   - inApproval: pending_approval or approved (not yet with the customer)
// Amounts are grand totals incl. VAT; category amounts are line total plus that line's VAT.

export interface DashboardSummary {
  range: Range
  won: Measure
  pending: Measure
  inApproval: Measure
  sentCount: number
  conversionRate: Money
  byStatus: StatusRow[]
  byMonth: MonthRow[]
  byRm: RmRow[]
  byTeam: TeamRow[]
  byCategory: CategoryRow[]
}

const SENT_STATUSES: QuoteStatus[] = ['sent', 'viewed', 'accepted', 'rejected']
const IN_APPROVAL_STATUSES: QuoteStatus[] = ['pending_approval', 'approved']

export class DashboardService {
  constructor(private readonly repo: Repository) {}

  async summary(a: Actor, r: Range): Promise<DashboardSummary> {
    if (a.role !== 'woc') throw roleForbidden()
    if (r.from !== null && r.to !== null && r.from > r.to) throw invalid('from must not be after to')
    const counts = await this.repo.countByStatus(a.tenantId, r)
    const zero = (): Measure => ({ count: 0, amount: new Money(0) })
    let won = zero()
    const inApproval = zero()
    let sentCount = 0
    const byStatus = QUOTE_STATUSES.map((status) => {
      const row = counts.find((c) => c.status === status) ?? { status, count: 0, amount: new Money(0) }
      if (status === 'accepted') won = { count: row.count, amount: row.amount }
      if (IN_APPROVAL_STATUSES.includes(status)) {
        inApproval.count += row.count
        inApproval.amount = inApproval.amount.add(row.amount)
      }
      if (SENT_STATUSES.includes(status)) sentCount += row.count
      return row
    })
    const conversionRate =
      sentCount > 0 ? new Money(won.count).div(sentCount).toDecimalPlaces(4, Money.ROUND_HALF_UP) : new Money(0)
    return {
      range: r,
      won,
      pending: await this.repo.pendingTotal(a.tenantId, r),
      inApproval,
      sentCount,
      conversionRate,
      byStatus,
      byMonth: await this.repo.byMonth(a.tenantId, r),
      byRm: await this.repo.byRm(a.tenantId, r),
      byTeam: await this.repo.byTeam(a.tenantId, r),
      byCategory: await this.repo.byCategory(a.tenantId, r),
    }
  }
}
