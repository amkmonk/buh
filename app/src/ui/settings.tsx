import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useApp } from '../state'
import { Avatar, ConfirmBox, InlineEdit } from './common'
import { catsAt, changeFrom, diffStruct, groupsAt } from '../lib/model'
import { curMonth, monGen, monName, monthTitle, newId, parseYM, plural, rub, shiftYM, sum, trats } from '../lib/format'
import { removeRows, saveBook, saveStructs } from '../lib/repo'
import { ApiError, OfflineError, authed } from '../lib/api'
import { kvSet } from '../lib/db'
import type { Cat, Group, Struct, User } from '../lib/types'
import { ROW_TINTS, rowTint } from '../lib/tints'

const swap = <T,>(a: T[], i: number, j: number) => {
  const t = a[i]
  a[i] = a[j]
  a[j] = t
}

/** Structure edits that apply from month M onward. */
export function useStructOps(M: string) {
  const { data, toast } = useApp()
  const apply = (op: (s: { groups: Group[]; cats: Cat[] }) => void) => saveStructs(changeFrom(data.structs, M, op))
  return {
    renameGroup: (id: string, name: string) =>
      apply((s) => {
        const g = s.groups.find((x) => x.id === id)
        if (g) g.name = name
      }),
    renameCat: (id: string, name: string) =>
      apply((s) => {
        const c = s.cats.find((x) => x.id === id)
        if (c) c.name = name
      }),
    moveGroup: (id: string, dir: number) =>
      apply((s) => {
        const i = s.groups.findIndex((g) => g.id === id)
        const j = i + dir
        if (i >= 0 && j >= 0 && j < s.groups.length) swap(s.groups, i, j)
      }),
    moveCat: (id: string, dir: number) =>
      apply((s) => {
        const c = s.cats.find((x) => x.id === id)
        if (!c) return
        const idx = s.cats.map((x, i) => (x.g === c.g ? i : -1)).filter((i) => i >= 0)
        const p = idx.indexOf(s.cats.indexOf(c))
        const q = p + dir
        if (q >= 0 && q < idx.length) swap(s.cats, idx[p], idx[q])
      }),
    setCatGroup: (id: string, g: string) =>
      apply((s) => {
        const c = s.cats.find((x) => x.id === id)
        if (!c) return
        s.cats = s.cats.filter((x) => x !== c)
        c.g = g
        s.cats.push(c)
      }),
    addCat: (g: string, name: string) => {
      const id = 'c-' + newId()
      return apply((s) => {
        if (s.groups.some((x) => x.id === g)) s.cats.push({ id, name, g })
      })
    },
    addGroup: (name: string) => {
      const id = 'g-' + newId()
      return apply((s) => {
        s.groups.push({ id, name })
      })
    },
    /** Removes a category from M on, together with its expenses in those months. */
    deleteCat: async (id: string) => {
      await removeRows(
        'exp',
        data.exps.filter((e) => e.c === id && e.date >= M),
      )
      await apply((s) => {
        s.cats = s.cats.filter((c) => c.id !== id)
      })
      toast(`Статья удалена с ${monGen(M)}`)
    },
    /** Row tint belongs to the category itself, so it applies in every month. */
    setCatTint: (id: string, bg: string) =>
      saveStructs(
        data.structs
          .filter((s) => s.cats.some((c) => c.id === id))
          .map((s) => {
            const copy: Struct = JSON.parse(JSON.stringify(s))
            const c = copy.cats.find((x) => x.id === id)!
            if (bg) c.bg = bg
            else delete c.bg
            return copy
          }),
      ),
    deleteGroup: async (id: string) => {
      await removeRows(
        'inc',
        data.incs.filter((i) => i.g === id && i.month >= M),
      )
      await apply((s) => {
        s.groups = s.groups.filter((g) => g.id !== id)
      })
      toast(`Группа удалена с ${monGen(M)}`)
    },
  }
}

function AddByName({ placeholder, button, onAdd, className, ghost }: { placeholder: string; button: string; onAdd: (name: string) => void; className: string; ghost?: boolean }) {
  const [v, setV] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!v.trim()) return
    onAdd(v.trim())
    setV('')
  }
  return (
    <form className={className} onSubmit={submit}>
      <input className="inp" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <button className={'btn sm' + (ghost ? ' ghost' : '')}>{button}</button>
    </form>
  )
}

/** Desktop settings: groups and categories effective from month M. */
export function StructSettings({ M }: { M: string }) {
  const { data, toast } = useApp()
  const ops = useStructOps(M)
  const [confirm, setConfirm] = useState<string | null>(null)
  const groups = groupsAt(data, M)
  const cats = catsAt(data, M)
  const diff = diffStruct(data.structs, M)
  const cnt = new Map<string, number>()
  for (const e of data.exps) if (e.date.startsWith(M)) cnt.set(e.c, (cnt.get(e.c) || 0) + 1)
  const later = (id: string) => data.exps.filter((e) => e.c === id && e.date >= M)
  const book = data.book
  const startOptions = Array.from({ length: 36 }, (_, i) => shiftYM(curMonth(), -i))

  return (
    <>
      <p className="set-note">
        Изменения действуют с <b>{monGen(M)} {parseYM(M).y}</b> и дальше. В прошлых месяцах статьи и группы остаются как были. Месяц выбирается стрелками вверху.
      </p>
      {book && (
        <label className="fld" style={{ maxWidth: 260 }}>
          Первый месяц учёта
          <select value={book.start} onChange={(e) => void saveBook({ ...book, start: e.target.value }).then(() => toast('Первый месяц учёта изменён'))}>
            {startOptions.map((m) => (
              <option key={m} value={m}>
                {monthTitle(m)}
              </option>
            ))}
          </select>
        </label>
      )}
      {diff.length > 0 && (
        <div className="diff">
          <b>Изменено с {monGen(M)}:</b>
          <ul>
            {diff.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {groups.map((g, gi) => {
        const list = cats.filter((c) => c.g === g.id)
        return (
          <section className="cg" key={g.id}>
            <div className="cg-h">
              <InlineEdit className="lnk" value={g.name} display={g.name} text label="Название группы" onCommit={(v) => (v.trim() ? void ops.renameGroup(g.id, v.trim()) : false)} />
              <small>
                {list.length} {plural(list.length, 'статья', 'статьи', 'статей')}
              </small>
              <span className="tools">
                <button className="x nav" disabled={gi === 0} onClick={() => void ops.moveGroup(g.id, -1)} aria-label="Поднять группу">
                  ↑
                </button>
                <button className="x nav" disabled={gi === groups.length - 1} onClick={() => void ops.moveGroup(g.id, 1)} aria-label="Опустить группу">
                  ↓
                </button>
                <button
                  className="x"
                  aria-label="Удалить группу"
                  onClick={() => {
                    if (list.length) return toast('Сначала перенесите статьи в другую группу или удалите их')
                    if (data.incs.some((i) => i.g === g.id && i.month >= M)) setConfirm('g:' + g.id)
                    else void ops.deleteGroup(g.id)
                  }}
                >
                  ×
                </button>
              </span>
            </div>
            {confirm === 'g:' + g.id && (
              <ConfirmBox
                text={`С ${monGen(M)} в группу записано доходов: ${data.incs.filter((i) => i.g === g.id && i.month >= M).length}. Удалить группу с ${monGen(M)} вместе с ними?`}
                onYes={() => {
                  setConfirm(null)
                  void ops.deleteGroup(g.id)
                }}
                onNo={() => setConfirm(null)}
              />
            )}
            <ul className="cl">
              {list.map((c, ci) => (
                <li key={c.id}>
                  <span className="nm">
                    <InlineEdit className="lnk" value={c.name} display={c.name} text label="Название статьи" onCommit={(v) => (v.trim() ? void ops.renameCat(c.id, v.trim()) : false)} />
                  </span>
                  <TintPicker value={c.bg} label={c.name} onPick={(k) => void ops.setCatTint(c.id, k)} />
                  <small>{cnt.get(c.id) ? `${trats(cnt.get(c.id)!)} в ${monName(M)}` : `трат в ${monName(M)} нет`}</small>
                  <select className="inp mv" value={g.id} onChange={(e) => void ops.setCatGroup(c.id, e.target.value)} aria-label={`Группа статьи ${c.name}`}>
                    {groups.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  <span className="tools">
                    <button className="x nav" disabled={ci === 0} onClick={() => void ops.moveCat(c.id, -1)} aria-label="Поднять статью">
                      ↑
                    </button>
                    <button className="x nav" disabled={ci === list.length - 1} onClick={() => void ops.moveCat(c.id, 1)} aria-label="Опустить статью">
                      ↓
                    </button>
                    <button className="x" aria-label="Удалить статью" onClick={() => (later(c.id).length ? setConfirm('c:' + c.id) : void ops.deleteCat(c.id))}>
                      ×
                    </button>
                  </span>
                  {confirm === 'c:' + c.id && (
                    <div style={{ flexBasis: '100%' }}>
                      <ConfirmBox
                        text={`С ${monGen(M)} у статьи ${trats(later(c.id).length)} на ${rub(sum(later(c.id), (e) => e.amt))}. Удалить статью с ${monGen(M)} вместе с ними? Прошлые месяцы не изменятся.`}
                        onYes={() => {
                          setConfirm(null)
                          void ops.deleteCat(c.id)
                        }}
                        onNo={() => setConfirm(null)}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <AddByName className="cg-add" placeholder="Новая статья" button="Добавить статью" ghost onAdd={(name) => void ops.addCat(g.id, name).then(() => toast(`Статья «${name}» добавлена с ${monGen(M)}`))} />
          </section>
        )
      })}
      <AddByName className="cg-add cg-new" placeholder="Название новой группы" button="Добавить группу" onAdd={(name) => void ops.addGroup(name).then(() => toast(`Группа «${name}» добавлена с ${monGen(M)}`))} />
    </>
  )
}

const errText = (e: unknown) => (e instanceof OfflineError ? 'Нет связи с сервером. Пользователями можно управлять только онлайн.' : (e as Error).message)

/** Server-side user list; refreshes the local cache used for names and avatars. */
export function useServerUsers() {
  const { session } = useApp()
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      const list = await authed<User[]>(session, '/api/users')
      setUsers(list)
      setError('')
      await kvSet('users', list)
    } catch (e) {
      setError(errText(e))
    }
  }, [session])
  useEffect(() => {
    void reload()
  }, [reload])
  return { users, error, reload }
}

/** Desktop settings: users with logins and passwords (online only). */
export function UsersSettings() {
  const { session, me, toast } = useApp()
  const { users, error, reload } = useServerUsers()
  const [pwd, setPwd] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [nu, setNu] = useState({ name: '', login: '', password: '' })

  const run = async (f: () => Promise<unknown>, ok: string) => {
    try {
      await f()
      toast(ok)
      await reload()
      return true
    } catch (e) {
      toast(e instanceof ApiError || e instanceof OfflineError ? errText(e) : String(e))
      return false
    }
  }
  const patch = (id: string, body: Record<string, string>, ok: string) => run(() => authed(session, '/api/users/' + id, { method: 'PATCH', body }), ok)

  return (
    <>
      <p className="set-note">Каждый входит по своему логину и паролю. Книга одна: все видят и правят одни и те же траты и доходы.</p>
      {error && <p className="pop-warn">{error}</p>}
      {users && (
        <div className="tblwrap">
          <table className="list">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Логин</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  isMe={u.id === me.id}
                  pwdOpen={pwd === u.id}
                  confirm={confirm === u.id}
                  onRename={(name) => void patch(u.id, { name }, 'Имя изменено')}
                  onLogin={(login) => void patch(u.id, { login }, 'Логин изменён')}
                  onPwdToggle={() => setPwd(pwd === u.id ? null : u.id)}
                  onPwd={async (password) => {
                    if (await patch(u.id, { password }, `Пароль для «${u.login}» изменён`)) setPwd(null)
                  }}
                  onDelete={() => setConfirm(u.id)}
                  onConfirm={(yes) => {
                    setConfirm(null)
                    if (yes) void run(() => authed(session, '/api/users/' + u.id, { method: 'DELETE' }), `Пользователь «${u.name}» удалён`)
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Новый пользователь</h3>
      <form
        className="incf"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => authed(session, '/api/users', { body: nu }), `Пользователь «${nu.name}» добавлен`).then((ok) => ok && setNu({ name: '', login: '', password: '' }))
        }}
      >
        <label className="fld">
          Имя
          <input value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} placeholder="Например, Мама" />
        </label>
        <label className="fld">
          Логин
          <input value={nu.login} onChange={(e) => setNu({ ...nu, login: e.target.value })} autoComplete="off" placeholder="латиницей, от 3 символов" />
        </label>
        <label className="fld">
          Пароль
          <input type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} autoComplete="new-password" placeholder="от 6 символов" />
        </label>
        <button className="btn">Добавить пользователя</button>
      </form>
    </>
  )
}

function UserRow(props: {
  u: User
  isMe: boolean
  pwdOpen: boolean
  confirm: boolean
  onRename: (v: string) => void
  onLogin: (v: string) => void
  onPwdToggle: () => void
  onPwd: (p: string) => void
  onDelete: () => void
  onConfirm: (yes: boolean) => void
}) {
  const { u, isMe } = props
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [err, setErr] = useState('')
  return (
    <>
      <tr>
        <td>
          <span className="uname">
            <Avatar who={u.id} />
            <InlineEdit className="lnk" value={u.name} display={u.name} text label="Имя" onCommit={(v) => (v.trim() ? props.onRename(v.trim()) : false)} />
            {isMe && <small>это вы</small>}
          </span>
        </td>
        <td className="num">
          <InlineEdit className="lnk" value={u.login} display={u.login} text label="Логин" onCommit={(v) => (/^[a-z0-9._-]{3,32}$/i.test(v.trim()) ? props.onLogin(v.trim()) : false)} />
        </td>
        <td className="r">
          <span className="utools">
            <button className="btn ghost sm" onClick={props.onPwdToggle}>
              Сменить пароль
            </button>
            <button className="x" disabled={isMe} title={isMe ? 'Себя удалить нельзя' : undefined} onClick={props.onDelete} aria-label={`Удалить пользователя ${u.name}`}>
              ×
            </button>
          </span>
        </td>
      </tr>
      {props.pwdOpen && (
        <tr>
          <td colSpan={3}>
            <form
              className="pwdf"
              onSubmit={(e) => {
                e.preventDefault()
                if (p1.length < 6) return setErr('Пароль должен быть не короче 6 символов')
                if (p1 !== p2) return setErr('Пароли не совпадают')
                setErr('')
                props.onPwd(p1)
              }}
            >
              <label className="fld">
                Новый пароль для «{u.login}»
                <input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" autoFocus />
              </label>
              <label className="fld">
                Ещё раз
                <input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" />
              </label>
              <button className="btn sm">Сохранить пароль</button>
              <button type="button" className="btn ghost sm" onClick={props.onPwdToggle}>
                Отмена
              </button>
              {err && <span className="bad">{err}</span>}
            </form>
          </td>
        </tr>
      )}
      {props.confirm && (
        <tr>
          <td colSpan={3}>
            <ConfirmBox text={`Удалить пользователя «${u.name}»? Его записи останутся, войти он больше не сможет.`} onYes={() => props.onConfirm(true)} onNo={() => props.onConfirm(false)} />
          </td>
        </tr>
      )}
    </>
  )
}

/** Mobile settings: rename groups and categories, add categories (structure changes beyond that live on desktop). */
export function MobileStructSettings({ M }: { M: string }) {
  const { data, toast } = useApp()
  const ops = useStructOps(M)
  return (
    <>
      <p className="ph-note">Изменения действуют с {monGen(M)} и дальше. Название меняется нажатием. Перенос статей, порядок и удаление — в версии для компьютера.</p>
      {groupsAt(data, M).map((g) => (
        <div className="ph-g" key={g.id}>
          <div className="ph-gh">
            <InlineEdit className="lnk" value={g.name} display={g.name} text label="Название группы" onCommit={(v) => (v.trim() ? void ops.renameGroup(g.id, v.trim()) : false)} />
          </div>
          {catsAt(data, M)
            .filter((c) => c.g === g.id)
            .map((c) => (
              <div className="ph-row static wrap" key={c.id} style={rowTint(c.bg)}>
                <span>
                  <InlineEdit className="lnk" value={c.name} display={c.name} text label="Название статьи" onCommit={(v) => (v.trim() ? void ops.renameCat(c.id, v.trim()) : false)} />
                </span>
                <TintPicker value={c.bg} label={c.name} onPick={(k) => void ops.setCatTint(c.id, k)} />
              </div>
            ))}
          <AddByName className="cg-add" placeholder="Новая статья" button="Добавить" ghost onAdd={(name) => void ops.addCat(g.id, name).then(() => toast(`Статья «${name}» добавлена`))} />
        </div>
      ))}
    </>
  )
}

const swatch = (key: string) => (key ? ({ ['--sw' as string]: `var(--tint-${key})` } as React.CSSProperties) : undefined)

/** Small swatch showing a category's row tint; opens the palette on click. */
function TintPicker({ value, label, onPick }: { value?: string; label: string; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const cur = ROW_TINTS.find((t) => t.key === (value ?? '')) ?? ROW_TINTS[0]
  return (
    <>
      <button
        className={'tint' + (cur.key ? '' : ' none')}
        style={swatch(cur.key)}
        aria-expanded={open}
        title="Фон строки"
        aria-label={`Фон строки «${label}»: ${cur.name.toLowerCase()}. Изменить`}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="tint-row" role="group" aria-label={`Фон строки «${label}»`}>
          {ROW_TINTS.map((t) => (
            <button
              key={t.key}
              className={'tint' + (t.key ? '' : ' none')}
              style={swatch(t.key)}
              aria-pressed={t.key === cur.key}
              title={t.name}
              aria-label={t.name}
              onClick={() => {
                onPick(t.key)
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </>
  )
}
