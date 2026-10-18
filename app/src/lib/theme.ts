import { useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'buh-theme'
const subs = new Set<() => void>()

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let current: Theme = read()

/** Puts the chosen theme on <html>; "system" leaves it to prefers-color-scheme. */
export function applyTheme(t: Theme = current) {
  const root = document.documentElement
  if (t === 'system') delete root.dataset.theme
  else root.dataset.theme = t
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove())
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = dark ? '#161c19' : '#ffffff'
  document.head.appendChild(meta)
}

export function setTheme(t: Theme) {
  current = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // private mode: the choice lasts for this session only
  }
  applyTheme(t)
  subs.forEach((f) => f())
}

export const useTheme = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => current,
  )

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (current === 'system') applyTheme()
})
