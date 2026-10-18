import { useSyncExternalStore } from 'react'
import { ApiError, OfflineError, authed } from './api'
import { TABLES, db, kvGet, kvSet, table } from './db'
import type { Session, TableName, User } from './types'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'
export interface SyncState {
  status: SyncStatus
  last: number // time of the last successful sync, ms
  pending: number // local changes not yet on the server
  error: string
}

interface WireRecord {
  id: string
  type: TableName
  data: Record<string, unknown>
  deleted: boolean
  updated_at: number
}
interface SyncResponse {
  cursor: number
  changes: WireRecord[]
  more: boolean
  book?: string // id of the server's database
  top?: number // the server's latest sequence number
}

let state: SyncState = { status: 'idle', last: 0, pending: 0, error: '' }
const subs = new Set<() => void>()
function setState(p: Partial<SyncState>) {
  state = { ...state, ...p }
  subs.forEach((f) => f())
}
export const useSyncState = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => state,
  )

let onAuthLost: () => void = () => {}
export const setAuthLostHandler = (f: () => void) => {
  onAuthLost = f
}

export async function countDirty() {
  let n = 0
  for (const t of TABLES) n += await table(t).where('dirty').equals(1).count()
  return n
}

let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let again = false

export function scheduleSync(delay = 700) {
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delay)
  void countDirty().then((pending) => setState({ pending }))
}

/** Push local changes, pull everything newer than our cursor. Safe to call any time. */
export async function syncNow(): Promise<boolean> {
  if (running) {
    again = true
    return false
  }
  const s = await kvGet<Session>('session')
  if (!s) return false
  running = true
  setState({ status: 'syncing' })
  try {
    let cursor = (await kvGet<number>('cursor')) ?? 0
    for (let round = 0; round < 100; round++) {
      const pushed: { t: TableName; id: string; updated_at: number }[] = []
      const changes: WireRecord[] = []
      for (const t of TABLES) {
        const rows = await table(t).where('dirty').equals(1).limit(400).toArray()
        for (const r of rows) {
          const { id, updated_at, deleted, dirty: _dirty, ...data } = r
          changes.push({ id, type: t, data, deleted: !!deleted, updated_at })
          pushed.push({ t, id, updated_at })
        }
      }
      const res = await authed<SyncResponse>(s, '/api/sync', { body: { since: cursor, changes } })
      // A new or reinstalled server (another book id, or fewer records than we have already seen):
      // upload our whole copy so no history is lost.
      const knownBook = await kvGet<string>('serverBook')
      const serverReset = (!!knownBook && !!res.book && knownBook !== res.book) || (res.top !== undefined && res.top < cursor)
      if (serverReset || (res.book && !knownBook)) {
        await db.transaction('rw', [db.exp, db.inc, db.chk, db.struct, db.book, db.kv], async () => {
          if (serverReset) {
            for (const t of TABLES) await table(t).toCollection().modify({ dirty: 1 })
            await kvSet('cursor', 0)
          }
          if (res.book) await kvSet('serverBook', res.book)
        })
        if (serverReset) {
          cursor = 0
          continue
        }
      }
      await db.transaction('rw', [db.exp, db.inc, db.chk, db.struct, db.book, db.kv], async () => {
        for (const p of pushed) {
          const cur = await table(p.t).get(p.id)
          if (cur && cur.dirty && cur.updated_at === p.updated_at) await table(p.t).update(p.id, { dirty: 0 })
        }
        for (const rec of res.changes) {
          if (!TABLES.includes(rec.type)) continue
          const tb = table(rec.type)
          const cur = await tb.get(rec.id)
          if (cur && cur.dirty && cur.updated_at > rec.updated_at) continue // our newer local edit wins; it goes up next round
          await tb.put({ ...rec.data, id: rec.id, updated_at: rec.updated_at, deleted: rec.deleted ? 1 : 0, dirty: 0 })
        }
        await kvSet('cursor', res.cursor)
      })
      cursor = res.cursor
      if (!res.more && (await countDirty()) === 0) break
    }
    try {
      await kvSet('users', await authed<User[]>(s, '/api/users'))
    } catch {
      // the user list is cosmetic; keep the cached one
    }
    setState({ status: 'idle', last: Date.now(), error: '', pending: await countDirty() })
    return true
  } catch (e) {
    const pending = await countDirty()
    if (e instanceof OfflineError) setState({ status: 'offline', pending })
    else if (e instanceof ApiError && e.status === 401) {
      setState({ status: 'error', error: e.message, pending })
      onAuthLost()
    } else setState({ status: 'error', error: (e as Error).message, pending })
    return false
  } finally {
    running = false
    if (again) {
      again = false
      scheduleSync(200)
    }
  }
}

/** Background sync: on start, every 15 s while visible, when the network returns and when the app is shown. */
export function startSyncLoop() {
  void syncNow()
  const tick = setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow()
  }, 15000)
  const onOnline = () => void syncNow()
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(tick)
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
