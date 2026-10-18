import type { Session } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
export class OfflineError extends Error {}

export const isNative = import.meta.env.VITE_NATIVE === '1'
export const defaultServer: string = import.meta.env.VITE_SERVER_URL || ''

/** Adds a scheme when it is missing: http for localhost and LAN IPs, https for everything else. */
export function normalizeServer(s: string) {
  s = s.trim().replace(/\/+$/, '')
  if (s && !/^https?:\/\//i.test(s)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(s)
    s = (local ? 'http://' : 'https://') + s
  }
  return s
}

export async function api<T>(server: string, path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token
  let res: Response
  try {
    res = await fetch(server + path, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new OfflineError('нет связи с сервером')
  }
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // non-JSON answer, e.g. a proxy error page
  }
  if (!res.ok) throw new ApiError(res.status, json?.error || `ошибка сервера (${res.status})`)
  return json as T
}

export const authed = <T,>(s: Session, path: string, opts: { method?: string; body?: unknown } = {}) =>
  api<T>(s.server, path, { ...opts, token: s.token })
