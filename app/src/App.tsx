import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ctx, useBookData, useMedia, useSession, type AppCtx } from './state'
import { Login } from './ui/Login'
import { Desktop } from './ui/Desktop'
import { Mobile } from './ui/Mobile'
import { authed } from './lib/api'
import { db, kvSet } from './lib/db'
import { ensureDefaults } from './lib/repo'
import { setAuthLostHandler, startSyncLoop, useSyncState } from './lib/sync'
import { maybeAutoBackup } from './lib/backup'

export default function App() {
  const session = useSession()
  const data = useBookData()
  const narrow = useMedia('(max-width: 760px)')
  const sync = useSyncState()
  const [toastMsg, setToastMsg] = useState('')
  const [toastOn, setToastOn] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [flashed, setFlashed] = useState<Set<string>>(() => new Set())

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    setToastOn(true)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastOn(false), 2800)
  }, [])
  const flash = useCallback((ids: string[]) => {
    setFlashed(new Set(ids))
    setTimeout(() => setFlashed(new Set()), 2700)
  }, [])

  const token = session?.token
  useEffect(() => {
    if (!token) return
    setAuthLostHandler(() => {
      void (async () => {
        await kvSet('authLost', true)
        await db.kv.delete('session')
      })()
    })
    const stopSync = startSyncLoop()
    // Daily automatic backup, a little after start so the first sync can finish.
    const auto = setTimeout(() => void maybeAutoBackup().catch(() => undefined), 8000)
    return () => {
      stopSync()
      clearTimeout(auto)
    }
  }, [token])

  // A brand-new book gets its settings and default groups after the first successful sync.
  useEffect(() => {
    if (session && data && !data.book && sync.last > 0) void ensureDefaults()
  }, [session, data, sync.last])

  const ctx = useMemo<AppCtx | null>(() => {
    if (!session || !data) return null
    const me = data.users.find((u) => u.id === session.user.id) ?? session.user
    return {
      data,
      session,
      me,
      users: data.users,
      toast,
      flash,
      flashed,
      logout: async () => {
        await authed(session, '/api/logout', { method: 'POST' }).catch(() => undefined)
        await db.kv.delete('session')
      },
    }
  }, [session, data, toast, flash, flashed])

  if (session === undefined || data === undefined) return null
  return (
    <>
      {ctx ? <Ctx.Provider value={ctx}>{narrow ? <Mobile /> : <Desktop />}</Ctx.Provider> : <Login />}
      <div id="toast" className={toastOn ? 'show' : ''} role="status" aria-live="polite">
        {toastMsg}
      </div>
    </>
  )
}
