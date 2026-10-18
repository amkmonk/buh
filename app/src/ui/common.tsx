import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../state'
import { syncNow, useSyncState } from '../lib/sync'
import { pad } from '../lib/format'
import { setTheme, useTheme, type Theme } from '../lib/theme'

/** Colour slot of a user: first user blue, second orange, the rest grey. */
export function useUserSlot() {
  const { users, me } = useApp()
  const list = users.length ? users : [me]
  return (id: string) => {
    const i = list.findIndex((u) => u.id === id)
    return i < 0 ? 2 : Math.min(i, 2)
  }
}

export function Avatar({ who }: { who: string }) {
  const { users, me } = useApp()
  const slot = useUserSlot()(who)
  const u = (users.length ? users : [me]).find((x) => x.id === who)
  const name = u?.name ?? 'Удалённый пользователь'
  return (
    <span className={'av' + (slot ? ' c' + slot : '')} title={name}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function useFlashClass() {
  const { flashed } = useApp()
  const slot = useUserSlot()
  return (id: string, who: string) => (flashed.has(id) ? ' flash-' + slot(who) : '')
}

interface InlineEditProps {
  value: string
  display: ReactNode
  onCommit: (v: string) => boolean | void
  text?: boolean
  placeholder?: string
  className?: string
  title?: string
  label?: string
}

/** Click-to-edit text. Enter saves, Esc cancels, blur saves (or cancels if invalid). */
export function InlineEdit({ value, display, onCommit, text, placeholder, className, title, label }: InlineEditProps) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState('')
  const [err, setErr] = useState(false)
  const done = useRef(false)
  const open = () => {
    setV(value)
    setErr(false)
    done.current = false
    setEdit(true)
  }
  if (!edit)
    return (
      <span
        className={className}
        role="button"
        tabIndex={0}
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          open()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
      >
        {display}
      </span>
    )
  const finish = (ok: boolean, blur = false) => {
    if (done.current) return
    if (ok && onCommit(v) === false && !blur) {
      setErr(true)
      return
    }
    done.current = true
    setEdit(false)
  }
  return (
    <input
      autoFocus
      className={'inl' + (text ? ' txt' : '') + (err ? ' err' : '')}
      value={v}
      inputMode={text ? 'text' : 'decimal'}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => {
        setV(e.target.value)
        setErr(false)
      }}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      }}
      onBlur={() => finish(true, true)}
    />
  )
}

export function SyncBadge() {
  const s = useSyncState()
  const t = s.last ? new Date(s.last) : null
  const time = t ? pad(t.getHours()) + ':' + pad(t.getMinutes()) : ''
  let label = time ? 'синхр. ' + time : 'не синхр.'
  let title = 'Синхронизировано' + (time ? ' в ' + time : '') + '. Нажмите, чтобы синхронизировать сейчас.'
  if (s.status === 'syncing') label = 'синхронизация…'
  if (s.status === 'offline') {
    label = 'офлайн' + (s.pending ? ' · ' + s.pending : '')
    title = `Нет связи с сервером. Изменения сохранены на устройстве${s.pending ? ` (${s.pending})` : ''} и отправятся, когда появится интернет.`
  }
  if (s.status === 'error') {
    label = 'ошибка синхр.'
    title = s.error
  }
  if (s.status === 'idle' && s.pending) label = 'ждут отправки: ' + s.pending
  return (
    <button className={'sync ' + s.status} onClick={() => void syncNow()} title={title}>
      <i aria-hidden="true" />
      {label}
    </button>
  )
}

export function ConfirmBox({ text, onYes, onNo, yes = 'Удалить' }: { text: ReactNode; onYes: () => void; onNo: () => void; yes?: string }) {
  return (
    <div className="confirm">
      <span>{text}</span>
      <button className="btn sm danger" onClick={onYes}>
        {yes}
      </button>
      <button className="btn ghost sm" onClick={onNo}>
        Отмена
      </button>
    </div>
  )
}

/** Native <dialog> shown modally; closes on Esc, backdrop click or the × button. */
export function Modal({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    const onCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    d?.addEventListener('cancel', onCancel)
    return () => d?.removeEventListener('cancel', onCancel)
  }, [onClose])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={label}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="m-in">{children}</div>
    </dialog>
  )
}

export const GearIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export function ThemeSwitch() {
  const theme = useTheme()
  const opts: [Theme, string][] = [
    ['system', 'Как в системе'],
    ['light', 'Светлая'],
    ['dark', 'Тёмная'],
  ]
  return (
    <div className="seg" role="group" aria-label="Тема оформления">
      {opts.map(([t, label]) => (
        <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
          {label}
        </button>
      ))}
    </div>
  )
}
