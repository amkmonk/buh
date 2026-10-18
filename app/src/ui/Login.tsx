import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, OfflineError, api, defaultServer, isNative, normalizeServer } from '../lib/api'
import { db, kvGet, kvSet } from '../lib/db'
import { syncNow } from '../lib/sync'
import { ensureDefaults } from '../lib/repo'
import type { Session, User } from '../lib/types'

export function Login() {
  const [server, setServer] = useState(defaultServer)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void (async () => {
      const last = await kvGet<string>('lastServer')
      if (last) setServer(last)
      const lastLogin = await kvGet<string>('lastLogin')
      if (lastLogin) setLogin(lastLogin)
      if (await kvGet<boolean>('authLost')) setNotice('Сессия закончилась: пароль сменили или пользователя удалили. Войдите снова, ваши несохранённые на сервере изменения сохранены на устройстве.')
    })()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const srv = isNative ? normalizeServer(server) : ''
    if (isNative && !srv) return setError('Укажите адрес сервера')
    setBusy(true)
    setError('')
    try {
      const res = await api<{ token: string; user: User }>(srv, '/api/login', { body: { login, password } })
      // A different server address keeps the local book: after login it is merged into that server
      // (an empty new server gets the whole history from this device).
      if ((await kvGet<string>('lastServer')) !== srv) await db.kv.delete('cursor')
      await kvSet('lastServer', srv)
      await kvSet('lastLogin', login.trim().toLowerCase())
      await db.kv.delete('authLost')
      const session: Session = { server: srv, token: res.token, user: res.user }
      await kvSet('session', session)
      if (await syncNow()) await ensureDefaults()
    } catch (err) {
      setBusy(false)
      if (err instanceof OfflineError) setError(`Нет связи с сервером${srv ? ' ' + srv : ''}. Проверьте интернет и адрес.`)
      else if (err instanceof ApiError) setError(err.message)
      else setError(String(err))
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>Семейный бюджет</h1>
        <p>Войдите, чтобы открыть общую книгу. Дальше приложение работает и без интернета.</p>
        {notice && <p className="pop-warn">{notice}</p>}
        {isNative && (
          <label className="fld">
            Адрес сервера
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://budget.example.ru" autoComplete="url" inputMode="url" />
          </label>
        )}
        <label className="fld">
          Логин
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus={!login} />
        </label>
        <label className="fld">
          Пароль
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus={!!login} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn" disabled={busy || !login || !password}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
