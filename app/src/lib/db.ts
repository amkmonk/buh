import Dexie, { type Table } from 'dexie'
import type { Book, Check, Expense, Income, Struct, TableName } from './types'

export interface KV {
  k: string
  v: unknown
}

/** A backup stored on this device (never synced). `json` holds the whole BackupFile. */
export interface StoredBackup {
  id: string
  createdAt: number
  kind: 'auto' | 'manual'
  label: string
  counts: Record<string, number>
  size: number
  json: string
}

class BuhDB extends Dexie {
  exp!: Table<Expense, string>
  inc!: Table<Income, string>
  chk!: Table<Check, string>
  struct!: Table<Struct, string>
  book!: Table<Book, string>
  kv!: Table<KV, string>
  backups!: Table<StoredBackup, string>

  constructor() {
    super('buh')
    this.version(1).stores({
      exp: 'id, date, dirty',
      inc: 'id, month, dirty',
      chk: 'id, date, dirty',
      struct: 'id, month, dirty',
      book: 'id, dirty',
      kv: 'k',
    })
    this.version(2).stores({
      backups: 'id, createdAt, kind',
    })
  }
}

export const db = new BuhDB()

export const TABLES: TableName[] = ['exp', 'inc', 'chk', 'struct', 'book']

export function table(name: TableName): Table<any, string> {
  return db[name] as Table<any, string>
}

export async function kvGet<T>(k: string): Promise<T | undefined> {
  return (await db.kv.get(k))?.v as T | undefined
}

export async function kvSet(k: string, v: unknown) {
  await db.kv.put({ k, v })
}
