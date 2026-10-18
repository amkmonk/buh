import { db, table } from './db'
import { defaultStruct } from './model'
import { curMonth, newId } from './format'
import { scheduleSync } from './sync'
import type { Book, Check, Expense, Income, Struct, TableName } from './types'

let lastStamp = 0
/** Strictly increasing timestamp so two edits in the same millisecond still order correctly. */
export const stamp = () => {
  const n = Date.now()
  lastStamp = n > lastStamp ? n : lastStamp + 1
  return lastStamp
}

async function save<T extends { id: string }>(t: TableName, rows: T[]): Promise<string[]> {
  if (!rows.length) return []
  await table(t).bulkPut(rows.map((r) => ({ deleted: 0, ...r, updated_at: stamp(), dirty: 1 })))
  scheduleSync()
  return rows.map((r) => r.id)
}

export const addExpenses = (who: string, date: string, c: string, amounts: number[], note: string) =>
  save<Partial<Expense> & { id: string }>('exp', amounts.map((amt) => ({ id: newId(), date, c, amt, who, note })))

export const patchExpense = (e: Expense, patch: Partial<Expense>) => save('exp', [{ ...e, ...patch }])

/** Moves expenses to another category and/or day; the author stays the same. */
export const moveExpenses = (rows: Expense[], c: string, date: string) => save('exp', rows.map((e) => ({ ...e, c, date })))

export const addIncome = (i: Omit<Income, 'id' | 'updated_at' | 'deleted' | 'dirty'>) => save('inc', [{ ...i, id: newId() }])
export const patchIncome = (i: Income, patch: Partial<Income>) => save('inc', [{ ...i, ...patch }])

export const addCheck = (who: string, date: string, note: string) => save<Partial<Check> & { id: string }>('chk', [{ id: newId(), date, who, note }])

export const saveStructs = (list: Struct[]) => save('struct', list)
export const saveBook = (b: Book) => save('book', [b])

export const removeRow = <T extends { id: string }>(t: TableName, row: T) => save(t, [{ ...row, deleted: 1 }])

/** Soft-deletes many rows at once (e.g. a category's expenses from some month on). */
export const removeRows = <T extends { id: string }>(t: TableName, rows: T[]) => save(t, rows.map((r) => ({ ...r, deleted: 1 })))

/** Creates the book settings and the default groups if the (already synced) database has none. */
export async function ensureDefaults() {
  const month = curMonth()
  if (!(await db.book.get('book'))) {
    await save('book', [{ id: 'book', start: month, opening: {} }])
  }
  if ((await db.struct.filter((s) => !s.deleted).count()) === 0) {
    await save('struct', [defaultStruct(month)])
  }
}
