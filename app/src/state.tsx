import { createContext, useContext, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, kvGet } from './lib/db'
import type { Data } from './lib/model'
import type { Session, User } from './lib/types'

export function useSession(): Session | null | undefined {
  return useLiveQuery(async () => (await kvGet<Session>('session')) ?? null)
}

/** Whole book from the local database; re-runs whenever any table changes. */
export function useBookData(): Data | undefined {
  return useLiveQuery(async () => {
    const [exps, incs, chks, structs, book, users] = await Promise.all([
      db.exp.filter((r) => !r.deleted).toArray(),
      db.inc.filter((r) => !r.deleted).toArray(),
      db.chk.filter((r) => !r.deleted).toArray(),
      db.struct.filter((r) => !r.deleted).toArray(),
      db.book.get('book'),
      kvGet<User[]>('users'),
    ])
    return { exps, incs, chks, structs, book: book && !book.deleted ? book : null, users: users ?? [] }
  })
}

export interface AppCtx {
  data: Data
  session: Session
  me: User
  users: User[]
  toast: (msg: string) => void
  flash: (ids: string[]) => void
  flashed: Set<string>
  logout: () => Promise<void>
}

export const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

export function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}
