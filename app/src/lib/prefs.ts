import { useSyncExternalStore } from 'react'

/** How the «Траты» tab looks on a phone: a day at a time, or the month table. Stored per device. */
export type ExpenseView = 'day' | 'table'

const KEY = 'buh-expense-view'
const subs = new Set<() => void>()

function read(): ExpenseView {
  try {
    return localStorage.getItem(KEY) === 'table' ? 'table' : 'day'
  } catch {
    return 'day'
  }
}

let current: ExpenseView = read()

export function setExpenseView(v: ExpenseView) {
  current = v
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // private mode: keep the choice for this session only
  }
  subs.forEach((f) => f())
}

export const useExpenseView = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => current,
  )
