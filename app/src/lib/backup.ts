import { TABLES, db, table, type StoredBackup } from './db'
import { newId, pad } from './format'
import { stamp } from './repo'
import { scheduleSync } from './sync'
import type { TableName } from './types'

/** File format of a backup: every row of every synced table, deleted ones included (they matter for merging). */
export interface BackupFile {
  app: 'buh'
  format: 1
  createdAt: number
  appVersion: string
  tables: Record<TableName, Record<string, unknown>[]>
}

const AUTO_KEEP = 3
const AUTO_EVERY = 24 * 60 * 60 * 1000

export function countRows(f: BackupFile) {
  const counts: Record<string, number> = {}
  for (const t of TABLES) counts[t] = (f.tables[t] ?? []).filter((r) => !r.deleted).length
  return counts
}

async function snapshot(): Promise<BackupFile> {
  const tables = {} as BackupFile['tables']
  for (const t of TABLES) tables[t] = (await table(t).toArray()).map(({ dirty: _dirty, ...row }) => row)
  return { app: 'buh', format: 1, createdAt: Date.now(), appVersion: __APP_VERSION__, tables }
}

export async function createBackup(kind: 'auto' | 'manual', label = ''): Promise<StoredBackup> {
  const file = await snapshot()
  const json = JSON.stringify(file)
  const b: StoredBackup = { id: newId(), createdAt: file.createdAt, kind, label, counts: countRows(file), size: json.length, json }
  await db.backups.put(b)
  if (kind === 'auto') {
    const autos = await db.backups.where('kind').equals('auto').sortBy('createdAt')
    await db.backups.bulkDelete(autos.slice(0, Math.max(0, autos.length - AUTO_KEEP)).map((x) => x.id))
  }
  return b
}

/** Called on app start: makes an automatic backup if the last one is older than a day. */
export async function maybeAutoBackup() {
  const autos = await db.backups.where('kind').equals('auto').sortBy('createdAt')
  const last = autos[autos.length - 1]
  if (last && Date.now() - last.createdAt < AUTO_EVERY) return
  if ((await db.struct.count()) === 0) return // nothing to back up yet
  await createBackup('auto')
}

export const deleteBackup = (id: string) => db.backups.delete(id)

export function parseBackup(text: string): BackupFile {
  let f: BackupFile
  try {
    f = JSON.parse(text)
  } catch {
    throw new Error('Файл не похож на резервную копию: это не JSON.')
  }
  if (!f || f.app !== 'buh' || f.format !== 1 || typeof f.tables !== 'object') throw new Error('Это не резервная копия «Семейного бюджета».')
  for (const t of TABLES) {
    const rows = f.tables[t] ?? []
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.id !== 'string' || typeof r.updated_at !== 'number')) throw new Error('Резервная копия повреждена.')
    f.tables[t] = rows
  }
  return f
}

export type RestoreMode = 'merge' | 'replace'

/**
 * merge: adds what is missing and takes rows that are newer in the backup; deletes nothing.
 * replace: makes the whole book exactly like the backup on every device (a safety backup is made first).
 */
export async function restoreBackup(f: BackupFile, mode: RestoreMode) {
  if (mode === 'replace') await createBackup('manual', 'Перед полной заменой')
  let changed = 0
  await db.transaction('rw', TABLES.map(table), async () => {
    for (const t of TABLES) {
      const tb = table(t)
      const rows = f.tables[t] ?? []
      if (mode === 'merge') {
        for (const row of rows) {
          const cur = await tb.get(row.id as string)
          if (!cur || cur.updated_at < (row.updated_at as number)) {
            await tb.put({ ...row, dirty: 1 })
            changed++
          }
        }
      } else {
        const keep = new Set(rows.map((r) => r.id as string))
        for (const cur of await tb.toArray()) {
          if (!keep.has(cur.id) && !cur.deleted) {
            await tb.put({ ...cur, deleted: 1, updated_at: stamp(), dirty: 1 })
            changed++
          }
        }
        for (const row of rows) {
          await tb.put({ ...row, updated_at: stamp(), dirty: 1 })
          changed++
        }
      }
    }
  })
  scheduleSync(200)
  return changed
}

export const backupFileName = (createdAt: number) => {
  const d = new Date(createdAt)
  return `buh-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}

/** Saves text to a file the way the platform allows: a save dialog on Windows, the share sheet on Android, a download in the browser. */
export async function saveTextFile(name: string, text: string): Promise<'saved' | 'shared' | 'downloaded' | 'cancelled'> {
  const { Capacitor } = await import('@capacitor/core')
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const res = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 })
    const { Share } = await import('@capacitor/share')
    try {
      await Share.share({ title: name, files: [res.uri], dialogTitle: 'Сохранить резервную копию' })
    } catch {
      return 'cancelled'
    }
    return 'shared'
  }
  if ('__TAURI_INTERNALS__' in window) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({ defaultPath: name, filters: [{ name: 'Резервная копия', extensions: ['json'] }] })
    if (!path) return 'cancelled'
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(path, text)
    return 'saved'
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return 'downloaded'
}
