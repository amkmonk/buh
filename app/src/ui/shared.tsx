import { useRef, useState, type FormEvent } from 'react'
import { useApp } from '../state'
import { Avatar, InlineEdit, useFlashClass } from './common'
import { catsAt, groupsAt, balances, lastCheck } from '../lib/model'
import { dayLabel, dim, fmt, monGen, monName, nextDay, pad, parseSigned, parseTerms, plural, rub, shiftYM, shortDay, sum, todayStr } from '../lib/format'
import { addCheck, addExpenses, addIncome, patchExpense, patchIncome, removeRow, saveBook } from '../lib/repo'
import type { Income } from '../lib/types'

export const defaultDate = (M: string) => (todayStr().startsWith(M) ? todayStr() : M + '-01')

/** Body of the expense card for one category and day: list, edit, delete, add. Used by the desktop popover and the mobile sheet. */
export function ExpenseCard({ M, c, day, onDay, onClose, variant }: { M: string; c: string; day: number; onDay: (d: number) => void; onClose: () => void; variant: 'pop' | 'sheet' }) {
  const { data, me, toast, flash } = useApp()
  const flashCls = useFlashClass()
  const n = dim(M)
  const date = M + '-' + pad(day)
  const cat = catsAt(data, M).find((x) => x.id === c)
  const group = groupsAt(data, M).find((g) => g.id === cat?.g)
  const es = data.exps.filter((e) => e.c === c && e.date === date).sort((a, b) => a.updated_at - b.updated_at)
  const lc = lastCheck(data)
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  const [bad, setBad] = useState(false)
  const amtRef = useRef<HTMLInputElement>(null)

  if (!cat) return null

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    const terms = parseTerms(amt)
    if (!terms || !terms.length) {
      setBad(true)
      amtRef.current?.focus()
      return
    }
    const ids = await addExpenses(me.id, date, c, terms, note.trim())
    flash(ids)
    setAmt('')
    setNote('')
    amtRef.current?.focus()
    toast(`Записано ${rub(sum(terms, (x) => x))} · ${cat.name}, ${shortDay(date)}`)
  }

  return (
    <>
      <div className="pop-h">
        <button className="x nav" onClick={() => onDay(day - 1)} disabled={day <= 1} aria-label="Предыдущий день">
          ‹
        </button>
        <div className="pop-t">
          <b>{cat.name}</b>
          <small>
            {dayLabel(date)} · {group?.name}
          </small>
        </div>
        <button className="x nav" onClick={() => onDay(day + 1)} disabled={day >= n} aria-label="Следующий день">
          ›
        </button>
        <button className="x" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      {lc && date <= lc.date && <p className="pop-warn">День уже сверен (отсечка по {shortDay(lc.date)}). Если что-то меняете, сверьте заново.</p>}
      {es.length ? (
        <ul className="pop-l">
          {es.map((e) => (
            <li key={e.id} className={flashCls(e.id, e.who)}>
              <Avatar who={e.who} />
              <InlineEdit
                className={'pop-n' + (e.note ? '' : ' none')}
                value={e.note}
                display={e.note || 'добавить комментарий'}
                text
                placeholder="Что купили"
                label="Комментарий"
                title="Изменить комментарий"
                onCommit={(v) => {
                  if (v.trim() !== e.note) void patchExpense(e, { note: v.trim(), who: me.id })
                }}
              />
              <InlineEdit
                className="num lnk"
                value={String(e.amt)}
                display={fmt(e.amt)}
                label="Сумма"
                title="Изменить сумму"
                onCommit={(v) => {
                  const t = parseTerms(v)
                  if (!t || !t.length) return false
                  const a = sum(t, (x) => x)
                  if (a !== e.amt) void patchExpense(e, { amt: a, who: me.id })
                }}
              />
              <button className="x" onClick={() => void removeRow('exp', e).then(() => toast('Трата удалена'))} aria-label={`Удалить трату ${fmt(e.amt)} ₽`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty" style={{ padding: '4px 0' }}>
          В этот день по статье трат нет.
        </p>
      )}
      <form className="pop-f" onSubmit={submit}>
        <input
          ref={amtRef}
          autoFocus={variant === 'pop'}
          className={'inp' + (bad ? ' err' : '')}
          value={amt}
          onChange={(e) => {
            setAmt(e.target.value)
            setBad(false)
          }}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Сумма"
          aria-label="Сумма"
        />
        <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Что купили" aria-label="Комментарий" />
        <button className={'btn' + (variant === 'pop' ? ' sm' : '')}>Добавить</button>
      </form>
      <div className="pop-s">
        <span>
          Итого <b>{rub(sum(es, (e) => e.amt))}</b>
        </span>
        {variant === 'pop' && <span>Enter — добавить · Esc — закрыть</span>}
      </div>
    </>
  )
}

/** Carry-over / income / spent / balance of one group in month M. The opening balance is editable in the book's first month. */
export function GroupSummary({ M, g, className }: { M: string; g: string; className: string }) {
  const { data } = useApp()
  const b = balances(data, M)
  const first = M === data.book?.start
  const carry = b.carry[g] || 0
  const end = b.end[g] || 0
  return (
    <dl className={className}>
      <div>
        <dt>{first ? 'На начало' : 'С ' + monGen(shiftYM(M, -1))}</dt>
        <dd className={carry < 0 ? 'bad' : ''}>
          {first && data.book ? (
            <InlineEdit
              className="lnk"
              value={String(carry)}
              display={fmt(carry)}
              label="Начальный остаток"
              title="Изменить начальный остаток"
              onCommit={(v) => {
                const n = parseSigned(v)
                if (n === null) return false
                void saveBook({ ...data.book!, opening: { ...data.book!.opening, [g]: n } })
              }}
            />
          ) : (
            fmt(carry)
          )}
        </dd>
      </div>
      <div>
        <dt>Пришло</dt>
        <dd className="pos">{fmt(b.inc[g] || 0)}</dd>
      </div>
      <div>
        <dt>Потрачено</dt>
        <dd>{fmt(b.sp[g] || 0)}</dd>
      </div>
      <div>
        <dt>Остаток</dt>
        <dd className={end < 0 ? 'bad' : 'ok'}>{fmt(end)}</dd>
      </div>
    </dl>
  )
}

/** Inline form that edits one income. */
export function IncomeEditForm({ inc, withGroup, className, onDone }: { inc: Income; withGroup: boolean; className: string; onDone: () => void }) {
  const { data, me, toast } = useApp()
  const [amt, setAmt] = useState(String(inc.amt))
  const [date, setDate] = useState(inc.date)
  const [g, setG] = useState(inc.g)
  const [note, setNote] = useState(inc.note)
  const [bad, setBad] = useState(false)
  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    const t = parseTerms(amt)
    if (!t || !t.length) return setBad(true)
    void patchIncome(inc, { amt: sum(t, (x) => x), date: date || inc.date, g, note: note.trim(), who: me.id })
    toast('Доход изменён')
    onDone()
  }
  return (
    <form className={className} onSubmit={submit}>
      <label className="fld">
        Сумма, ₽
        <input autoFocus className={bad ? 'err' : ''} value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" autoComplete="off" />
      </label>
      <label className="fld">
        Дата поступления
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {withGroup && (
        <label className="fld">
          Группа
          <select value={g} onChange={(e) => setG(e.target.value)}>
            {groupsAt(data, inc.month).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="fld">
        Комментарий
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="m-ea">
        <button className="btn sm">Сохранить</button>
        <button type="button" className="btn ghost sm" onClick={onDone}>
          Отмена
        </button>
      </div>
    </form>
  )
}

/** Form that adds an income to month M; the group is either fixed or chosen. */
export function IncomeAddForm({ M, group, className, title, wideClass = '' }: { M: string; group?: string; className: string; title?: string; wideClass?: string }) {
  const { data, me, toast, flash } = useApp()
  const groups = groupsAt(data, M)
  const [amt, setAmt] = useState('')
  const [date, setDate] = useState(defaultDate(M))
  const [g, setG] = useState(group ?? groups[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [bad, setBad] = useState(false)
  const gid = group ?? (groups.some((x) => x.id === g) ? g : groups[0]?.id)
  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    const t = parseTerms(amt)
    if (!t || !t.length || !gid) return setBad(true)
    const total = sum(t, (x) => x)
    const ids = await addIncome({ date: date || defaultDate(M), month: M, g: gid, amt: total, who: me.id, note: note.trim() })
    flash(ids)
    setAmt('')
    setNote('')
    toast(`Доход ${rub(total)} записан в «${groups.find((x) => x.id === gid)?.name}» на ${monName(M)}`)
  }
  return (
    <form className={className} onSubmit={submit}>
      {title && <h4>{title}</h4>}
      <label className="fld">
        Сумма, ₽
        <input
          className={bad ? 'err' : ''}
          value={amt}
          onChange={(e) => {
            setAmt(e.target.value)
            setBad(false)
          }}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
        />
      </label>
      <label className="fld">
        Дата поступления
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {!group && (
        <label className={'fld ' + wideClass}>
          В группу
          <select value={gid} onChange={(e) => setG(e.target.value)}>
            {groups.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={'fld ' + wideClass}>
        Комментарий
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Зарплата, аванс…" />
      </label>
      <button className="btn">Записать доход</button>
    </form>
  )
}

export function useCheckSummary() {
  const { data } = useApp()
  const lc = lastCheck(data)
  const from = lc?.date ?? ''
  const after = data.exps.filter((e) => e.date > from)
  const incAfter = data.incs.filter((i) => i.date > from)
  const byWho = new Map<string, number>()
  for (const e of after) byWho.set(e.who, (byWho.get(e.who) || 0) + 1)
  const hist = [...data.chks].sort((a, b) => b.date.localeCompare(a.date))
  return { lc, next: lc ? nextDay(lc.date) : '', after, incAfter, byWho, hist }
}

/** Form that sets a reconciliation checkpoint. */
export function CheckForm({ className, wideClass = '' }: { className: string; wideClass?: string }) {
  const { me, toast, flash } = useApp()
  const { lc, next } = useCheckSummary()
  const [date, setDate] = useState(todayStr())
  const [note, setNote] = useState('')
  const [bad, setBad] = useState(false)
  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!date || (lc && date <= lc.date)) {
      setBad(true)
      toast(lc ? `Дата должна быть позже последней отсечки (${shortDay(lc.date)})` : 'Укажите дату')
      return
    }
    flash(await addCheck(me.id, date, note.trim()))
    setNote('')
    toast(`Отсечка поставлена: сверено по ${shortDay(date)}`)
  }
  return (
    <form className={className} onSubmit={submit}>
      <h4>Поставить отсечку</h4>
      <label className={'fld ' + wideClass}>
        Всё внесено и сверено по
        <input
          type="date"
          className={bad ? 'err' : ''}
          value={date}
          min={next || undefined}
          onChange={(e) => {
            setDate(e.target.value)
            setBad(false)
          }}
        />
      </label>
      <label className={'fld ' + wideClass}>
        Комментарий
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: всё сошлось" />
      </label>
      <button className="btn">Поставить отсечку</button>
    </form>
  )
}

export const whoList = (byWho: Map<string, number>, name: (id: string) => string) =>
  [...byWho.entries()].map(([w, n]) => `${name(w)} ${n}`).join(' · ')

export const incomeCount = (n: number) => n + ' ' + plural(n, 'поступление', 'поступления', 'поступлений')
