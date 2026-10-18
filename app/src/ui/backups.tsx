import { useRef, useState, type ChangeEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../state'
import { ConfirmBox } from './common'
import { db, type StoredBackup } from '../lib/db'
import { backupFileName, countRows, createBackup, deleteBackup, parseBackup, restoreBackup, saveTextFile, type BackupFile, type RestoreMode } from '../lib/backup'
import { newId, pad, plural } from '../lib/format'

const when = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const describe = (c: Record<string, number>) =>
  `${c.exp ?? 0} ${plural(c.exp ?? 0, 'трата', 'траты', 'трат')} · ${c.inc ?? 0} ${plural(c.inc ?? 0, 'доход', 'дохода', 'доходов')} · ${c.chk ?? 0} ${plural(c.chk ?? 0, 'отсечка', 'отсечки', 'отсечек')}`
const kb = (n: number) => (n < 1024 ? n + ' Б' : Math.round(n / 1024) + ' КБ')

interface Pending {
  file: BackupFile
  title: string
  json?: string // set when the backup came from a file, so it can be kept in the list
  name?: string
}

/** Backups on this device: create, delete, save to a file, restore (merge or full replace), import from a file. */
export function BackupsPanel() {
  const { toast } = useApp()
  const list = useLiveQuery(() => db.backups.orderBy('createdAt').reverse().toArray(), []) ?? []
  const [pending, setPending] = useState<Pending | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    try {
      await f()
    } catch (e) {
      toast((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      await createBackup('manual')
      toast('Резервная копия создана')
    })

  const toFile = (b: StoredBackup) =>
    run(async () => {
      const r = await saveTextFile(backupFileName(b.createdAt), b.json)
      if (r === 'saved') toast('Файл сохранён')
      if (r === 'downloaded') toast('Файл скачан в папку загрузок')
    })

  const startRestore = (b: StoredBackup) => {
    setConfirmReplace(false)
    setPending({ file: parseBackup(b.json), title: `копии от ${when(b.createdAt)}` })
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    void run(async () => {
        const text = await f.text()
        setConfirmReplace(false)
        setPending({ file: parseBackup(text), title: `файла ${f.name}`, json: text, name: f.name })
      })
  }

  const restore = (mode: RestoreMode) =>
    run(async () => {
      if (!pending) return
      const n = await restoreBackup(pending.file, mode)
      toast(mode === 'merge' ? `Готово: обновлено записей ${n}` : 'Книга заменена данными из копии')
      setPending(null)
      setConfirmReplace(false)
    })

  const keepImported = () =>
    run(async () => {
      if (!pending?.json) return
      await db.backups.put({
        id: newId(),
        createdAt: pending.file.createdAt,
        kind: 'manual',
        label: 'Из файла ' + (pending.name ?? ''),
        counts: countRows(pending.file),
        size: pending.json.length,
        json: pending.json,
      })
      setPending({ ...pending, json: undefined })
      toast('Копия добавлена в список')
    })

  return (
    <div className="bk">
      <p className="set-note">
        Копии хранятся на этом устройстве. Автоматическая создаётся при открытии приложения, не чаще раза в сутки, хранятся три последние. Ручные остаются, пока вы их не удалите. Чтобы
        копия пережила потерю устройства, сохраните её в файл.
      </p>
      <div className="bk-actions">
        <button className="btn" disabled={busy} onClick={() => void create()}>
          Создать копию
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          Импорт из файла
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
      </div>

      {pending && (
        <div className="bk-restore">
          <b>Восстановление из {pending.title}</b>
          <small>
            {when(pending.file.createdAt)} · {describe(countRows(pending.file))}
          </small>
          <div className="bk-mode">
            <button className="btn" disabled={busy} onClick={() => void restore('merge')}>
              Синхронизировать
            </button>
            <span>Добавит недостающее и обновит то, что в копии новее. Ничего не удалит.</span>
          </div>
          <div className="bk-mode">
            <button className="btn danger" disabled={busy} onClick={() => setConfirmReplace(true)}>
              Полная замена
            </button>
            <span>Книга станет ровно как в копии на всех устройствах: всё, чего в копии нет, удалится.</span>
          </div>
          {confirmReplace && (
            <ConfirmBox
              text="Заменить всю книгу данными из копии? Перед заменой будет создана копия текущего состояния."
              yes="Заменить"
              onYes={() => void restore('replace')}
              onNo={() => setConfirmReplace(false)}
            />
          )}
          <div className="bk-mode">
            {pending.json && (
              <button className="btn ghost sm" disabled={busy} onClick={() => void keepImported()}>
                Сохранить в список копий
              </button>
            )}
            <button className="btn ghost sm" onClick={() => setPending(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {list.length ? (
        <ul className="bk-list">
          {list.map((b) => (
            <li key={b.id}>
              <div className="bk-main">
                <span>
                  <b>{when(b.createdAt)}</b> <span className={'bk-kind ' + b.kind}>{b.kind === 'auto' ? 'авто' : 'вручную'}</span>
                </span>
                {b.label && <small>{b.label}</small>}
                <small>
                  {describe(b.counts)} · {kb(b.size)}
                </small>
              </div>
              <div className="bk-btns">
                <button className="btn ghost sm" disabled={busy} onClick={() => startRestore(b)}>
                  Восстановить
                </button>
                <button className="btn ghost sm" disabled={busy} onClick={() => void toFile(b)}>
                  В файл
                </button>
                <button className="x" disabled={busy} onClick={() => setConfirmDel(b.id)} aria-label="Удалить копию">
                  ×
                </button>
              </div>
              {confirmDel === b.id && (
                <div style={{ flexBasis: '100%' }}>
                  <ConfirmBox
                    text={`Удалить копию от ${when(b.createdAt)}?`}
                    onYes={() => {
                      setConfirmDel(null)
                      void deleteBackup(b.id).then(() => toast('Копия удалена'))
                    }}
                    onNo={() => setConfirmDel(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Копий пока нет. Первая автоматическая появится при следующем открытии приложения.</p>
      )}
    </div>
  )
}
