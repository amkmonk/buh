import type { Book, Cat, Check, Expense, Group, Income, Struct, User } from './types'
import { shiftYM } from './format'

export interface Data {
  exps: Expense[]
  incs: Income[]
  chks: Check[]
  structs: Struct[]
  book: Book | null
  users: User[]
}

export const structId = (month: string) => 's:' + month

function sortedStructs(structs: Struct[]) {
  return [...structs].sort((a, b) => a.month.localeCompare(b.month))
}

/** The snapshot of groups and categories in effect for month M. */
export function structAt(structs: Struct[], M: string): Struct | undefined {
  const list = sortedStructs(structs)
  let pick = list[0]
  for (const s of list) if (s.month <= M) pick = s
  return pick
}
export const groupsAt = (d: Data, M: string): Group[] => structAt(d.structs, M)?.groups ?? []
export const catsAt = (d: Data, M: string): Cat[] => structAt(d.structs, M)?.cats ?? []

export interface MonthStats {
  cats: Cat[]
  ex: Expense[]
  byDay: Record<number, number>
  byCatDay: Map<string, Expense[]>
}

export const cellKey = (c: string, day: number) => c + '|' + day

export function monthStats(d: Data, M: string): MonthStats {
  const cats = catsAt(d, M)
  const known = new Set(cats.map((c) => c.id))
  const ex = d.exps.filter((e) => e.date.startsWith(M) && known.has(e.c))
  const byDay: Record<number, number> = {}
  const byCatDay = new Map<string, Expense[]>()
  for (const e of ex) {
    const day = +e.date.slice(8)
    byDay[day] = (byDay[day] || 0) + e.amt
    const k = cellKey(e.c, day)
    const list = byCatDay.get(k)
    if (list) list.push(e)
    else byCatDay.set(k, [e])
  }
  for (const list of byCatDay.values()) list.sort((a, b) => a.updated_at - b.updated_at)
  return { cats, ex, byDay, byCatDay }
}

export interface Balances {
  carry: Record<string, number>
  inc: Record<string, number>
  sp: Record<string, number>
  end: Record<string, number>
}

/** Group balance = carry-over from the previous month + incomes − expenses, starting from the book's opening balances. */
export function balances(d: Data, M: string): Balances {
  const start = d.book?.start
  if (!start || M < start) return { carry: {}, inc: {}, sp: {}, end: {} }
  const expByMonth = new Map<string, Expense[]>()
  for (const e of d.exps) {
    const k = e.date.slice(0, 7)
    const l = expByMonth.get(k)
    if (l) l.push(e)
    else expByMonth.set(k, [e])
  }
  let carry: Record<string, number> = { ...(d.book?.opening ?? {}) }
  for (let x = start; ; x = shiftYM(x, 1)) {
    const cg = new Map(catsAt(d, x).map((c) => [c.id, c.g]))
    const sp: Record<string, number> = {}
    const inc: Record<string, number> = {}
    for (const e of expByMonth.get(x) ?? []) {
      const g = cg.get(e.c)
      if (g) sp[g] = (sp[g] || 0) + e.amt
    }
    for (const i of d.incs) if (i.month === x) inc[i.g] = (inc[i.g] || 0) + i.amt
    const end: Record<string, number> = {}
    const ids = new Set([...groupsAt(d, x).map((g) => g.id), ...Object.keys(carry)])
    for (const id of ids) end[id] = (carry[id] || 0) + (inc[id] || 0) - (sp[id] || 0)
    if (x === M) return { carry, inc, sp, end }
    carry = end
  }
}

export function tileState(b: Balances, g: string) {
  const carry = b.carry[g] || 0
  const inc = b.inc[g] || 0
  const sp = b.sp[g] || 0
  const end = b.end[g] || 0
  const avail = Math.max(carry, 0) + inc
  const tone: 'ok' | 'warn' | 'bad' = end < 0 ? 'bad' : avail && end / avail < 0.1 ? 'warn' : 'ok'
  const pct = avail ? Math.min(100, (sp / avail) * 100) : sp ? 100 : 0
  return { carry, inc, sp, end, tone, pct }
}

export function lastCheck(d: Data): Check | null {
  let best: Check | null = null
  for (const c of d.chks) if (!best || c.date > best.date) best = c
  return best
}

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))

/**
 * Applies a structure edit from month M onward: copies the effective snapshot into M if M has none,
 * then runs `op` on M and every later snapshot. Earlier months stay untouched.
 * Returns the snapshots to save.
 */
export function changeFrom(structs: Struct[], M: string, op: (s: { groups: Group[]; cats: Cat[] }) => void): Struct[] {
  const out: Struct[] = []
  const base = structAt(structs, M)
  if (!structs.some((s) => s.month === M)) {
    const s: Struct = { ...clone(base ?? ({ groups: [], cats: [] } as unknown as Struct)), id: structId(M), month: M, deleted: 0, dirty: 1, updated_at: 0 }
    op(s)
    out.push(s)
  }
  for (const s of sortedStructs(structs)) {
    if (s.month < M) continue
    const c = clone(s)
    op(c)
    out.push(c)
  }
  return out
}

/** Human-readable list of what changed in month M compared to the previous month. */
export function diffStruct(structs: Struct[], M: string): string[] {
  const cur = structs.find((s) => s.month === M)
  const prev = structAt(structs, shiftYM(M, -1))
  if (!cur || !prev || cur === prev || prev.month >= M) return []
  const out: string[] = []
  const gn = (id: string) => (cur.groups.find((g) => g.id === id) || prev.groups.find((g) => g.id === id))?.name ?? '?'
  for (const g of cur.groups) {
    const p = prev.groups.find((x) => x.id === g.id)
    if (!p) out.push(`добавлена группа «${g.name}»`)
    else if (p.name !== g.name) out.push(`группа «${p.name}» переименована в «${g.name}»`)
  }
  for (const p of prev.groups) if (!cur.groups.some((g) => g.id === p.id)) out.push(`удалена группа «${p.name}»`)
  for (const c of cur.cats) {
    const p = prev.cats.find((x) => x.id === c.id)
    if (!p) out.push(`добавлена статья «${c.name}» в «${gn(c.g)}»`)
    else {
      if (p.name !== c.name) out.push(`статья «${p.name}» переименована в «${c.name}»`)
      if (p.g !== c.g) out.push(`«${c.name}» перенесена из «${gn(p.g)}» в «${gn(c.g)}»`)
    }
  }
  for (const p of prev.cats) if (!cur.cats.some((c) => c.id === p.id)) out.push(`удалена статья «${p.name}»`)
  return out
}

/** Starting structure for a brand-new book. Fixed ids so two devices creating it offline agree. */
export function defaultStruct(month: string) {
  const groups: Group[] = [
    { id: 'g-life', name: 'Жизнь' },
    { id: 'g-duty', name: 'Обязашки' },
    { id: 'g-rep', name: 'Ремонт' },
  ]
  const names: [string, string[]][] = [
    ['g-life', ['Продукты', 'Кафе', 'Бытовая химия', 'Бензин', 'Такси', 'Аптека', 'Одежда', 'Развлечения']],
    ['g-duty', ['Коммуналка', 'Интернет и связь', 'Садик', 'Кружки', 'Кредит']],
    ['g-rep', ['Материалы', 'Инструмент', 'Мастера']],
  ]
  const cats: Cat[] = names.flatMap(([g, list]) => list.map((name, i) => ({ id: `c-${g.slice(2)}-${i + 1}`, name, g })))
  return { id: structId(month), month, groups, cats }
}
