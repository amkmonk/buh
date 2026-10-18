import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state'
import { rowTint } from '../lib/tints'
import { Avatar, GearIcon, Modal, SyncBadge, ThemeSwitch, useFlashClass } from './common'
import { CheckForm, ExpenseCard, GroupSummary, IncomeAddForm, IncomeEditForm, incomeCount, useCheckSummary, whoList } from './shared'
import { StructSettings, UsersSettings } from './settings'
import { BackupsPanel } from './backups'
import { balances, cellKey, groupsAt, lastCheck, monthStats, tileState } from '../lib/model'
import { GEN, WD, curMonth, dayLabel, daysBetween, dim, fmt, monGen, monName, monthTitle, nextDay, pad, parseYM, rub, shiftYM, shortDay, sum, todayStr, trats, weekday, weeksOf } from '../lib/format'
import { moveExpenses, removeRow } from '../lib/repo'
import type { Expense } from '../lib/types'

type View = 'table' | 'income' | 'settings'
type ModalState = { kind: 'group'; g: string } | { kind: 'checks' } | null

export function Desktop() {
  const { data, toast, flash } = useApp()
  const [month, setMonth] = useState(curMonth())
  const [moving, setMoving] = useState<Expense[] | null>(null)
  const [view, setView] = useState<View>('table')
  const [pop, setPop] = useState<{ c: string; day: number } | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [scrollDay, setScrollDay] = useState<number | null>(null)
  const start = data.book?.start ?? month
  const M = month < start ? start : month

  const go = (m: string) => {
    setMonth(m)
    setPop(null)
    setScrollDay(null)
  }
  const closeModal = useCallback(() => setModal(null), [])

  // While moving, a click on a cell puts the expenses there; Esc cancels.
  useEffect(() => {
    if (!moving) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoving(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moving])
  const dropInto = async (c: string, day: number) => {
    if (!moving) return
    const rows = moving
    setMoving(null)
    const date = M + '-' + pad(day)
    const cat = monthStats(data, M).cats.find((x) => x.id === c)
    flash(await moveExpenses(rows, c, date))
    toast(`Перенесено ${rub(sum(rows, (e) => e.amt))} в «${cat?.name}», ${shortDay(date)}`)
    setPop({ c, day })
  }

  return (
    <div className="app">
      <Header
        M={M}
        start={start}
        view={view}
        onMonth={go}
        onView={(v) => {
          setView(v)
          setPop(null)
        }}
        onGroup={(g) => setModal({ kind: 'group', g })}
        onChecks={() => setModal({ kind: 'checks' })}
      />
      <div className="view">
        {view === 'table' && moving && (
          <div className="mv-bar" role="status">
            <span>
              Перенос{' '}
              <b>
                {trats(moving.length)} на {rub(sum(moving, (e) => e.amt))}
              </b>
              : нажмите ячейку, куда перенести. Можно переключить месяц.
            </span>
            <button className="btn ghost sm" onClick={() => setMoving(null)}>
              Отмена
            </button>
          </div>
        )}
        {view === 'table' && (
          <MonthTable
            M={M}
            pop={pop}
            scrollDay={scrollDay}
            moving={!!moving}
            onCell={(c, day) => (moving ? void dropInto(c, day) : setPop({ c, day }))}
          />
        )}
        {view === 'income' && <IncomePage M={M} onBack={() => setView('table')} />}
        {view === 'settings' && <SettingsPage M={M} onBack={() => setView('table')} />}
      </div>
      {view === 'table' && pop && (
        <CellPop
          M={M}
          c={pop.c}
          day={pop.day}
          onDay={(d) => setPop({ c: pop.c, day: Math.min(Math.max(1, d), dim(M)) })}
          onClose={() => setPop(null)}
          onPick={(rows) => {
            setMoving(rows)
            setPop(null)
          }}
          onMoved={(c, date) => {
            if (!date.startsWith(M)) setMonth(date.slice(0, 7))
            setPop({ c, day: +date.slice(8) })
          }}
        />
      )}
      {modal?.kind === 'group' && <GroupModal M={M} g={modal.g} onClose={closeModal} />}
      {modal?.kind === 'checks' && (
        <ChecksModal
          onClose={closeModal}
          onGo={(date) => {
            setModal(null)
            setView('table')
            setPop(null)
            setMonth(date.slice(0, 7) < start ? start : date.slice(0, 7))
            setScrollDay(+date.slice(8))
          }}
        />
      )}
    </div>
  )
}

function Header(props: { M: string; start: string; view: View; onMonth: (m: string) => void; onView: (v: View) => void; onGroup: (g: string) => void; onChecks: () => void }) {
  const { M, start, view } = props
  const { data } = useApp()
  const b = balances(data, M)
  const lc = lastCheck(data)
  const nav = (
    <div className="mnav">
      <button onClick={() => props.onMonth(shiftYM(M, -1))} disabled={M <= start} aria-label="Предыдущий месяц" title={M <= start ? 'Раньше учёт не вёлся' : undefined}>
        ‹
      </button>
      <button className="mtitle" aria-pressed={view === 'income'} onClick={() => props.onView(view === 'income' ? 'table' : 'income')} title="Все доходы за месяц">
        {monthTitle(M)}
      </button>
      <button onClick={() => props.onMonth(shiftYM(M, 1))} aria-label="Следующий месяц">
        ›
      </button>
    </div>
  )
  const gear = (
    <button className="gear" aria-pressed={view === 'settings'} onClick={() => props.onView(view === 'settings' ? 'table' : 'settings')} aria-label="Настройки" title="Настройки: группы, статьи, пользователи">
      <GearIcon />
    </button>
  )
  if (view === 'settings')
    return (
      <div className="apptop">
        {nav}
        <span className="set-title">Настройки</span>
        <div className="top-end">
          <SyncBadge />
          {gear}
        </div>
      </div>
    )
  return (
    <div className="apptop">
      {nav}
      {lc ? (
        <button className={'chk' + (daysBetween(lc.date, todayStr()) > 7 ? ' stale' : '')} onClick={props.onChecks} title="Сверка и отсечки">
          <span className="chk-i">✓</span>
          <span>
            Сверено по {shortDay(lc.date)}
            <small>вносить с {shortDay(nextDay(lc.date))}</small>
          </span>
        </button>
      ) : (
        <button className="chk stale" onClick={props.onChecks}>
          <span className="chk-i">✓</span>
          <span>
            Сверок ещё не было<small>нажмите, чтобы поставить отсечку</small>
          </span>
        </button>
      )}
      <div className="gtiles">
        {groupsAt(data, M).map((g) => {
          const t = tileState(b, g.id)
          const tip = `${g.name}: с прошлого месяца ${rub(t.carry)}, пришло ${rub(t.inc)}, потрачено ${rub(t.sp)}, остаток ${rub(t.end)}. Нажмите, чтобы открыть доходы группы`
          return (
            <button key={g.id} className="gt" onClick={() => props.onGroup(g.id)} title={tip} aria-label={tip}>
              <span className="gt-h">
                <b>{g.name}</b>
                <span className={'num ' + t.tone}>{fmt(t.end)}</span>
              </span>
              <span className={'bar ' + t.tone}>
                <i style={{ width: t.pct.toFixed(1) + '%' }} />
              </span>
            </button>
          )
        })}
      </div>
      <div className="top-end">
        <SyncBadge />
        {gear}
      </div>
    </div>
  )
}

function MonthTable({
  M,
  pop,
  scrollDay,
  moving,
  onCell,
}: {
  M: string
  pop: { c: string; day: number } | null
  scrollDay: number | null
  moving: boolean
  onCell: (c: string, day: number) => void
}) {
  const { data } = useApp()
  const flashCls = useFlashClass()
  const wrap = useRef<HTMLDivElement>(null)
  const t = useMemo(() => monthStats(data, M), [data, M])
  const n = dim(M)
  const { m } = parseYM(M)
  const today = todayStr()
  const td = today.startsWith(M) ? +today.slice(8) : 0
  const ws = weeksOf(M)
  const lcd = lastCheck(data)?.date ?? ''
  const days = Array.from({ length: n }, (_, i) => i + 1)
  const dc = (d: number) => {
    const ds = M + '-' + pad(d)
    const wd = weekday(ds)
    return (
      (d === td ? ' today' : '') +
      (wd === 0 || wd === 6 ? ' we' : '') +
      (ds <= lcd ? ' sv' : '') +
      (ds === lcd ? ' sv-cut' : '') +
      (ws.findIndex(([a, b]) => d >= a && d <= b) % 2 ? ' w1' : '') +
      (wd === 1 && d > 1 ? ' wb' : '')
    )
  }
  const cell = (c: string, d: number) => t.byCatDay.get(cellKey(c, d)) ?? []
  const cday = (c: string, d: number) => sum(cell(c, d), (e) => e.amt)
  const cnum = (x: number) => (x ? fmt(x) : '')

  // Drag with the mouse to pan the table in both directions; a drag never counts as a click on a cell.
  useEffect(() => {
    const w = wrap.current
    if (!w) return
    let drag: { x: number; y: number; sl: number; st: number; moved: boolean } | null = null
    let swallowClick = false
    const down = (e: PointerEvent) => {
      swallowClick = false
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if ((e.target as HTMLElement).closest('input, button, select, a')) return
      drag = { x: e.clientX, y: e.clientY, sl: w.scrollLeft, st: w.scrollTop, moved: false }
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) > 5) {
        drag.moved = true
        w.classList.add('panning')
      }
      if (drag.moved) {
        w.scrollLeft = drag.sl - dx
        w.scrollTop = drag.st - dy
        e.preventDefault()
      }
    }
    const up = () => {
      if (drag?.moved) {
        swallowClick = true
        w.classList.remove('panning')
      }
      drag = null
    }
    const click = (e: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      e.stopPropagation()
      e.preventDefault()
    }
    w.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    w.addEventListener('click', click, true)
    return () => {
      w.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      w.removeEventListener('click', click, true)
    }
  }, [])

  // Scroll to today (or to the requested day) when the month changes.
  useLayoutEffect(() => {
    const w = wrap.current
    if (!w) return
    const target = scrollDay ?? (td || 0)
    const th = target ? w.querySelector<HTMLElement>(`th[data-d="${target}"]`) : null
    const nameW = w.querySelector<HTMLElement>('thead .name')?.offsetWidth ?? 0
    w.scrollLeft = th ? Math.max(0, scrollDay ? th.offsetLeft - nameW - 4 : th.offsetLeft - w.clientWidth * 0.65) : 0
  }, [M, scrollDay, td])

  const groups = groupsAt(data, M)
  return (
    <div className={'gridwrap' + (moving ? ' moving' : '')} ref={wrap}>
      <table className="sheet">
        <thead>
          <tr>
            <th className="name">Статья</th>
            {days.map((d) => (
              <th key={d} className={'dh' + dc(d)} data-d={d}>
                <span>{d}</span>
                <small>{WD[weekday(M + '-' + pad(d))]}</small>
              </th>
            ))}
            <th className="wt">Итого</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const cats = t.cats.filter((c) => c.g === g.id)
            const gday = (d: number) => sum(cats, (c) => cday(c.id, d))
            return [
              <tr className="grp" key={g.id}>
                <td className="name">{g.name}</td>
                {days.map((d) => (
                  <td key={d} className={'gd' + dc(d)}>
                    {cnum(gday(d))}
                  </td>
                ))}
                <td className="wt">{cnum(sum(days, gday))}</td>
              </tr>,
              ...cats.map((c) => (
                <tr className="cat" key={c.id} style={rowTint(c.bg)}>
                  <td className="name">{c.name}</td>
                  {days.map((d) => {
                    const es = cell(c.id, d)
                    const fl = es.map((e) => flashCls(e.id, e.who)).find(Boolean) ?? ''
                    const sel = pop && pop.c === c.id && pop.day === d
                    return (
                      <td
                        key={d}
                        className={'d' + dc(d) + (es.length > 1 ? ' multi' : '') + (sel ? ' sel' : '') + fl}
                        data-c={c.id}
                        data-d={d}
                        tabIndex={0}
                        aria-label={`${c.name}, ${d} ${GEN[m - 1]}: ${es.length ? trats(es.length) + ' на ' + rub(cday(c.id, d)) : 'нет трат'}`}
                        onClick={() => onCell(c.id, d)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onCell(c.id, d)
                          }
                        }}
                      >
                        {cnum(cday(c.id, d))}
                      </td>
                    )
                  })}
                  <td className="wt">{cnum(sum(days, (d) => cday(c.id, d)))}</td>
                </tr>
              )),
            ]
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="name">Итого за день</td>
            {days.map((d) => (
              <td key={d} className={dc(d).trim()}>
                {cnum(t.byDay[d] || 0)}
              </td>
            ))}
            <td className="wt">{cnum(sum(days, (d) => t.byDay[d] || 0))}</td>
          </tr>
        </tfoot>
      </table>
      {!groups.length && <p className="empty" style={{ padding: 16 }}>Загружаем книгу…</p>}
    </div>
  )
}

/** Floating card next to the selected cell; follows the cell while the table scrolls. */
function CellPop({
  M,
  c,
  day,
  onDay,
  onClose,
  onPick,
  onMoved,
}: {
  M: string
  c: string
  day: number
  onDay: (d: number) => void
  onClose: () => void
  onPick: (rows: Expense[]) => void
  onMoved: (c: string, date: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: -9999, top: 0 })

  useLayoutEffect(() => {
    const wrap = document.querySelector<HTMLElement>('.gridwrap')
    const cellEl = () => document.querySelector<HTMLElement>(`td.d[data-c="${c}"][data-d="${day}"]`)
    // Bring the cell into view between the sticky name and total columns.
    const cell = cellEl()
    if (wrap && cell) {
      const cr = cell.getBoundingClientRect()
      const wr = wrap.getBoundingClientRect()
      const nameW = wrap.querySelector<HTMLElement>('thead .name')?.offsetWidth ?? 0
      const totW = wrap.querySelector<HTMLElement>('thead .wt')?.offsetWidth ?? 0
      if (cr.left < wr.left + nameW) wrap.scrollLeft -= wr.left + nameW - cr.left
      else if (cr.right > wr.right - totW) wrap.scrollLeft += cr.right - (wr.right - totW)
    }
    const place = () => {
      const el = cellEl()
      const p = ref.current
      if (!el || !p) return
      const r = el.getBoundingClientRect()
      const w = p.offsetWidth
      const h = p.offsetHeight
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8)
      let top = r.bottom + 6
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
      setPos((old) => (old.left === left && old.top === top ? old : { left, top }))
    }
    place()
    wrap?.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    const ro = new ResizeObserver(place)
    if (ref.current) ro.observe(ref.current)
    return () => {
      wrap?.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
      ro.disconnect()
    }
  }, [c, day, M])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (ref.current?.contains(t) || t.closest('td.d') || t.closest('dialog')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        document.querySelector<HTMLElement>(`td.d[data-c="${c}"][data-d="${day}"]`)?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [c, day, onClose])

  return (
    <div className="pop" ref={ref} role="dialog" aria-label="Траты в ячейке" style={{ left: pos.left, top: pos.top }}>
      <ExpenseCard key={`${M}|${c}|${day}`} M={M} c={c} day={day} onDay={onDay} onClose={onClose} variant="pop" onPick={onPick} onMoved={onMoved} />
    </div>
  )
}

function GroupModal({ M, g, onClose }: { M: string; g: string; onClose: () => void }) {
  const { data, toast } = useApp()
  const flashCls = useFlashClass()
  const [edit, setEdit] = useState<string | null>(null)
  const group = groupsAt(data, M).find((x) => x.id === g)
  if (!group) return null
  const list = data.incs.filter((i) => i.g === g && i.month === M).sort((a, b) => a.date.localeCompare(b.date) || a.updated_at - b.updated_at)
  const inc = sum(list, (i) => i.amt)
  const first = M === data.book?.start
  return (
    <Modal onClose={onClose} label={group.name}>
      <div className="m-h">
        <div>
          <h3>{group.name}</h3>
          <small>{monthTitle(M)}</small>
        </div>
        <button className="x" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      <GroupSummary M={M} g={g} className="m-sum" />
      {list.length ? (
        <>
          <ul className="m-list">
            {list.map((i) =>
              edit === i.id ? (
                <li key={i.id}>
                  <IncomeEditForm inc={i} withGroup={false} className="m-ef" onDone={() => setEdit(null)} />
                </li>
              ) : (
                <li key={i.id} className={flashCls(i.id, i.who)}>
                  <span className="m-d num">{dayLabel(i.date)}</span>
                  <span className="m-n">{i.note || 'без комментария'}</span>
                  <Avatar who={i.who} />
                  <b className="num pos">+{fmt(i.amt)}</b>
                  <button className="x nav" onClick={() => setEdit(i.id)} aria-label={`Изменить доход ${fmt(i.amt)} ₽`}>
                    ✎
                  </button>
                  <button className="x" onClick={() => void removeRow('inc', i).then(() => toast('Доход удалён'))} aria-label={`Удалить доход ${fmt(i.amt)} ₽`}>
                    ×
                  </button>
                </li>
              ),
            )}
          </ul>
          <div className="m-tot">
            <span>{incomeCount(list.length)}</span>
            <span>
              всего <b>{rub(inc)}</b>
            </span>
          </div>
        </>
      ) : (
        <p className="empty">В {monName(M)} в эту группу доходов ещё не было.</p>
      )}
      <IncomeAddForm key={M} M={M} group={g} className="m-add" title={`Добавить доход на ${monName(M)}`} />
      <p className="m-note">
        Остаток = {first ? 'начальный остаток' : 'перенос с ' + monGen(shiftYM(M, -1))} + доходы − траты. Остаток или перерасход перейдёт в {monName(shiftYM(M, 1))}. Доход записывается в открытый месяц.
      </p>
    </Modal>
  )
}

function ChecksModal({ onClose, onGo }: { onClose: () => void; onGo: (date: string) => void }) {
  const { users, me, toast } = useApp()
  const flashCls = useFlashClass()
  const { lc, next, after, incAfter, byWho, hist } = useCheckSummary()
  const name = (id: string) => (users.find((u) => u.id === id) ?? (id === me.id ? me : null))?.name ?? '?'
  return (
    <Modal onClose={onClose} label="Сверка и отсечки">
      <div className="m-h">
        <div>
          <h3>Сверка и отсечки</h3>
          <small>Отсечка значит: всё по эту дату внесено и сошлось с реальной суммой</small>
        </div>
        <button className="x" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      <dl className="m-sum">
        <div>
          <dt>Сверено по</dt>
          <dd>{lc ? shortDay(lc.date) : '—'}</dd>
        </div>
        <div>
          <dt>После внесено</dt>
          <dd>{trats(after.length)}</dd>
        </div>
        <div>
          <dt>На сумму</dt>
          <dd>{fmt(sum(after, (e) => e.amt))}</dd>
        </div>
        <div>
          <dt>Кто вносил</dt>
          <dd className="k-who">{whoList(byWho, name) || '—'}</dd>
        </div>
      </dl>
      {incAfter.length > 0 && (
        <p className="m-note">
          Доходов после отсечки: {incAfter.length} на {rub(sum(incAfter, (i) => i.amt))}.
        </p>
      )}
      {lc && (
        <div>
          <button className="btn ghost sm" onClick={() => onGo(next)}>
            Открыть таблицу с {shortDay(next)}
          </button>
        </div>
      )}
      <CheckForm className="m-add" wideClass="" />
      <h4 className="k-h">История отсечек</h4>
      {hist.length ? (
        <ul className="m-list">
          {hist.map((c) => (
            <li key={c.id} className={flashCls(c.id, c.who)}>
              <span className="m-d num">{dayLabel(c.date)}</span>
              <span className="m-n">{c.note || 'без комментария'}</span>
              <Avatar who={c.who} />
              <button className="x" onClick={() => void removeRow('chk', c).then(() => toast(`Отсечка по ${shortDay(c.date)} удалена`))} aria-label={`Удалить отсечку ${shortDay(c.date)}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Отсечек пока нет.</p>
      )}
    </Modal>
  )
}

function IncomePage({ M, onBack }: { M: string; onBack: () => void }) {
  const { data, toast } = useApp()
  const flashCls = useFlashClass()
  const [edit, setEdit] = useState<string | null>(null)
  const list = data.incs.filter((i) => i.month === M).sort((a, b) => a.date.localeCompare(b.date) || a.updated_at - b.updated_at)
  const groups = groupsAt(data, M)
  return (
    <div className="page">
      <div className="page-h">
        <button className="btn ghost sm" onClick={onBack}>
          ← К таблице
        </button>
        <h3 className="page-t">Доходы на {monName(M)}</h3>
        <span className="m-tot">
          всего <b>{rub(sum(list, (i) => i.amt))}</b>
        </span>
      </div>
      {list.length ? (
        <div className="tblwrap">
          <table className="list">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Откуда</th>
                <th>Группа</th>
                <th className="r">Сумма</th>
                <th>Кто</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) =>
                edit === i.id ? (
                  <tr key={i.id}>
                    <td colSpan={6}>
                      <IncomeEditForm inc={i} withGroup className="m-ef wide4" onDone={() => setEdit(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={i.id} className={flashCls(i.id, i.who)}>
                    <td className="num">{dayLabel(i.date)}</td>
                    <td>{i.note || '—'}</td>
                    <td>{groups.find((g) => g.id === i.g)?.name ?? '—'}</td>
                    <td className="r num pos">+{fmt(i.amt)}</td>
                    <td>
                      <Avatar who={i.who} />
                    </td>
                    <td className="r">
                      <button className="x nav" onClick={() => setEdit(i.id)} aria-label="Изменить доход">
                        ✎
                      </button>
                      <button className="x" onClick={() => void removeRow('inc', i).then(() => toast('Доход удалён'))} aria-label="Удалить доход">
                        ×
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">На {monName(M)} доходов ещё нет.</p>
      )}
      <IncomeAddForm key={M} M={M} className="incf" wideClass="span2" />
      <p className="m-note">Доход записывается в открытый месяц ({monName(M)}). Для другого месяца переключите его стрелками рядом с названием.</p>
    </div>
  )
}

function SettingsPage({ M, onBack }: { M: string; onBack: () => void }) {
  const { me, logout } = useApp()
  const [tab, setTab] = useState<'cats' | 'users' | 'backups'>('cats')
  return (
    <div className="page">
      <div className="page-h">
        <button className="btn ghost sm" onClick={onBack}>
          ← К таблице
        </button>
        <div className="seg" role="group" aria-label="Раздел настроек">
          <button aria-pressed={tab === 'cats'} onClick={() => setTab('cats')}>
            Группы и статьи
          </button>
          <button aria-pressed={tab === 'users'} onClick={() => setTab('users')}>
            Пользователи
          </button>
          <button aria-pressed={tab === 'backups'} onClick={() => setTab('backups')}>
            Резервные копии
          </button>
        </div>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Avatar who={me.id} /> {me.name}
          <button className="btn ghost sm" onClick={() => void logout()}>
            Выйти
          </button>
        </span>
      </div>
      <div className="page-h" style={{ gap: 12 }}>
        <span className="set-note">Тема оформления на этом устройстве</span>
        <ThemeSwitch />
      </div>
      <div className="cfg">{tab === 'cats' ? <StructSettings M={M} /> : tab === 'users' ? <UsersSettings /> : <BackupsPanel />}</div>
      <p className="m-note">Версия {__APP_VERSION__}</p>
    </div>
  )
}
