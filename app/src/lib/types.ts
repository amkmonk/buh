/** Fields every synced row carries locally. `dirty` marks rows not yet accepted by the server. */
export interface SyncMeta {
  id: string
  updated_at: number
  deleted: 0 | 1
  dirty: 0 | 1
}

export interface Expense extends SyncMeta {
  date: string // YYYY-MM-DD
  c: string // category id
  amt: number
  who: string // user id
  note: string
}

export interface Income extends SyncMeta {
  date: string // date the money arrived
  month: string // YYYY-MM the income belongs to
  g: string // group id
  amt: number
  who: string
  note: string
}

export interface Check extends SyncMeta {
  date: string // everything up to and including this day is reconciled
  who: string
  note: string
}

export interface Group {
  id: string
  name: string
}
export interface Cat {
  id: string
  name: string
  g: string
}

/** Groups and categories effective from `month` until the next snapshot. id = "s:" + month. */
export interface Struct extends SyncMeta {
  month: string
  groups: Group[]
  cats: Cat[]
}

/** Book settings. id = "book". */
export interface Book extends SyncMeta {
  start: string // first month of the book
  opening: Record<string, number> // group balances carried into the start month
}

export interface User {
  id: string
  login: string
  name: string
}

export interface Session {
  server: string // '' means same origin
  token: string
  user: User
}

export type TableName = 'exp' | 'inc' | 'chk' | 'struct' | 'book'
