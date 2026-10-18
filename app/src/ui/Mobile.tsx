import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state'
import { Avatar, ConfirmBox, GearIcon, SyncBadge, ThemeSwitch, useFlashClass } from './common'
import { CheckForm, ExpenseCard, GroupSummary, IncomeAddForm, IncomeEditForm, useCheckSummary, whoList } from './shared'
import { MobileStructSettings } from './settings'
import { BackupsPanel } from './backups'
import { balances, cellKey, groupsAt, lastCheck, monthStats, tileState } from '../lib/model'
import { WD, capitalize, compact, curMonth, dayLabel, dim, fmt, monName, monthTitle, pad, rub, shiftYM, shortDay, sum, todayStr, trats, weekday, weeksOf } from '../lib/format'
import { removeRow } from '../lib/repo'
import { useSyncState } from '../lib/sync'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { MobileTable } from './MobileTable'
import { setExpenseView, useExpenseView } from '../lib/prefs'

type Tab = 'exp' | 'inc' | 'chk' | 'tot' | 'set'

const ICONS: Record<Tab, React.ReactNode> = {
  exp: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9 9.5v10M14.5 9.5v10" />
    </svg>
  ),
  inc: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" />
      <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  ),
  chk: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12.2l2.7 2.7L16 9.6" />
    </svg>
  ),
  tot: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.5 5H6.5l6 7-6 7h11" />
    </svg>
  ),
  set: <GearIcon size={22} />,
}
const TABS: [Tab, string][] = [
  ['exp', 'Траты'],
  ['inc', 'Доходы'],
  ['chk', 'Сверка'],
  ['tot', 'Итого'],
  ['set', 'Настройки'],
]

/** Mouse drag scrolls horizontal strips like a finger does; touch scrolls natively. */
function useDragScroll() {
  useEffect(() => {
    const SEL = '.ph-strip,.ph-tiles,.ph-chips'
    let drag: { el: HTMLElement; x: number; sl: number; moved: boolean } | null = null
    let justDragged = false
    const down = (ev: PointerEvent) => {
      justDragged = false
      if (ev.pointerType !== 'mouse' || ev.button !== 0) return
      const el = (ev.target as HTMLElement).closest<HTMLElement>(SEL)
      if (el) drag = { el, x: ev.clientX, sl: el.scrollLeft, moved: false }
    }
    const move = (ev: PointerEvent) => {
      if (!drag) return
      const dx = ev.clientX - drag.x
      if (!drag.moved && Math.abs(dx) > 4) {
        drag.moved = true
        drag.el.classList.add('dragging')
      }
      if (drag.moved) drag.el.scrollLeft = drag.sl - dx
    }
    const up = () => {
      if (drag?.moved) {
        justDragged = true
        drag.el.classList.remove('dragging')
      }
      drag = null
    }
    const click = (ev: MouseEvent) => {
      if (justDragged) {
        justDragged = false
        ev.preventDefault()
        ev.stopPropagation()
      }
    }
    const wheel = (ev: WheelEvent) => {
      const el = (ev.target as HTMLElement).closest?.<HTMLElement>(SEL)
      if (!el || el.scrollWidth <= el.clientWidth || Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return
      el.scrollLeft += ev.deltaY
      ev.preventDefault()
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
    document.addEventListener('click', click, true)
    document.addEventListener('wheel', wheel, { passive: false })
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      document.removeEventListener('click', click, true)
      document.removeEventListener('wheel', wheel)
    }
  }, [])
}

export function Mobile() {
  const { data } = useApp()
  useDragScroll()
  const [tab, setTab] = useState<Tab>('exp')
  const [month, setMonth] = useState(curMonth())
  const [day, setDay] = useState(+todayStr().slice(8))
  const [sheet, setSheet] = useState<string | null>(null)
  const [incG, setIncG] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const expView = useExpenseView()
  const start = data.book?.start ?? month
  const M = month < start ? start : month

  const goMonth = (m: string) => {
    setMonth(m)
    setDay(todayStr().startsWith(m) ? +todayStr().slice(8) : 1)
    setSheet(null)
  }
  const goTab = (t: Tab) => {
    setTab(t)
    setSheet(null)
    bodyRef.current?.scrollTo({ top: 0 })
  }

  // Android back button: close the sheet, then return to «Траты», then leave the app.
  const back = useRef<() => void>(() => {})
  useEffect(() => {
    back.current = () => {
      if (sheet) setSheet(null)
      else if (tab !== 'exp') {
        setTab('exp')
        bodyRef.current?.scrollTo({ top: 0 })
      } else void CapApp.exitApp()
    }
  })
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const h = CapApp.addListener('backButton', () => back.current())
    return () => void h.then((x) => x.remove())
  }, [])

  return (
    <div className="ph">
      <div className="ph-top">
        <button className="ph-ib" onClick={() => goMonth(shiftYM(M, -1))} disabled={M <= start} aria-label="Предыдущий месяц">
          ‹
        </button>
        <span className="ph-month">{monthTitle(M)}</span>
        <button className="ph-ib" onClick={() => goMonth(shiftYM(M, 1))} aria-label="Следующий месяц">
          ›
        </button>
      </div>
      <div className={'ph-body' + (tab === 'exp' && expView === 'table' ? ' tablemode' : '')} ref={bodyRef}>
        {tab === 'exp' && expView === 'table' && (
          <>
            <Tiles M={M} onTile={(g) => (setIncG(g), goTab('inc'))} />
            <MobileTable
              M={M}
              sel={sheet ? { c: sheet, d: Math.min(day, dim(M)) } : null}
              onCell={(c, d) => {
                setDay(d)
                setSheet(c)
              }}
            />
          </>
        )}
        {tab === 'exp' && expView === 'day' && <DayTab M={M} day={Math.min(day, dim(M))} onDay={setDay} onCat={setSheet} onTile={(g) => (setIncG(g), goTab('inc'))} />}
        {tab === 'inc' && <IncomeTab M={M} g={incG} onG={setIncG} onTile={setIncG} />}
        {tab === 'chk' && (
          <ChecksTab
            onGo={(date) => {
              setMonth(date.slice(0, 7) < start ? start : date.slice(0, 7))
              setDay(+date.slice(8))
              goTab('exp')
            }}
          />
        )}
        {tab === 'tot' && <TotalsTab M={M} />}
        {tab === 'set' && <SettingsTab M={M} />}
      </div>
      <nav className="ph-nav">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => goTab(k)} aria-current={tab === k ? 'page' : undefined}>
            {ICONS[k]}
            <span>{l}</span>
          </button>
        ))}
      </nav>
      {tab === 'exp' && sheet && (
        <>
          <button className="ph-scrim" onClick={() => setSheet(null)} aria-label="Закрыть карточку" />
          <div className="ph-sheet" role="dialog" aria-label="Траты статьи за день">
            <span className="ph-grab" />
            <ExpenseCard key={`${M}|${sheet}|${day}`} M={M} c={sheet} day={Math.min(day, dim(M))} onDay={(d) => setDay(Math.min(Math.max(1, d), dim(M)))} onClose={() => setSheet(null)} variant="sheet" />
          </div>
        </>
      )}
    </div>
  )
}

function Tiles({ M, onTile }: { M: string; onTile: (g: string) => void }) {
  const { data } = useApp()
  const b = balances(data, M)
  return (
    <div className="ph-tiles">
      {groupsAt(data, M).map((g) => {
        const t = tileState(b, g.id)
        return (
          <button key={g.id} className="ph-tile" onClick={() => onTile(g.id)} aria-label={`${g.name}: остаток ${rub(t.end)}. Открыть доходы группы`}>
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
  )
}

function DayTab({ M, day, onDay, onCat, onTile }: { M: string; day: number; onDay: (d: number) => void; onCat: (c: string) => void; onTile: (g: string) => void }) {
  const { data } = useApp()
  const flashCls = useFlashClass()
  const strip = useRef<HTMLDivElement>(null)
  const t = useMemo(() => monthStats(data, M), [data, M])
  const n = dim(M)
  const today = todayStr()
  const td = today.startsWith(M) ? +today.slice(8) : 0
  const ws = weeksOf(M)
  const lcd = lastCheck(data)?.date ?? ''
  const date = M + '-' + pad(day)
  const cday = (c: string) => sum(t.byCatDay.get(cellKey(c, day)) ?? [], (e) => e.amt)

  // Keep the selected day centred in the strip.
  useLayoutEffect(() => {
    const s = strip.current
    const on = s?.querySelector<HTMLElement>('.ph-d.on')
    if (s && on) s.scrollLeft = on.offsetLeft - s.clientWidth / 2 + on.offsetWidth / 2
  }, [day, M])

  return (
    <>
      <Tiles M={M} onTile={onTile} />
      <div className="ph-strip" ref={strip}>
        {Array.from({ length: n }, (_, i) => i + 1).map((d) => {
          const ds = M + '-' + pad(d)
          const wi = ws.findIndex(([a, b]) => d >= a && d <= b)
          const x = t.byDay[d] || 0
          return (
            <button
              key={d}
              className={'ph-d' + (d === day ? ' on' : '') + (d === td ? ' today' : '') + (wi % 2 ? ' w1' : '') + (ds === lcd ? ' cut' : '')}
              onClick={() => onDay(d)}
              aria-pressed={d === day}
              aria-label={`${dayLabel(ds)}: ${x ? rub(x) : 'нет трат'}${ds === lcd ? ', день сверки' : ''}`}
              title={ds === lcd ? 'Сверено по этот день' : undefined}
            >
              <small>{WD[weekday(ds)]}</small>
              <b>{d}</b>
              <span>{x ? compact(x) : '·'}</span>
            </button>
          )
        })}
      </div>
      <div className="ph-dayh">
        <b>{capitalize(dayLabel(date))}</b>
        {date <= lcd && <span className="ph-sv">✓ сверено</span>}
        <span className="num">{rub(t.byDay[day] || 0)}</span>
      </div>
      {groupsAt(data, M).map((g) => {
        const cats = t.cats.filter((c) => c.g === g.id)
        const gt = sum(cats, (c) => cday(c.id))
        return (
          <div className="ph-g" key={g.id}>
            <div className="ph-gh">
              <span>{g.name}</span>
              <span className="num">{gt ? fmt(gt) : ''}</span>
            </div>
            {cats.map((c) => {
              const es = t.byCatDay.get(cellKey(c.id, day)) ?? []
              const fl = es.map((e) => flashCls(e.id, e.who)).find(Boolean) ?? ''
              return (
                <button key={c.id} className={'ph-row' + fl} onClick={() => onCat(c.id)}>
                  <span>{c.name}</span>
                  {es.length > 1 && <span className="cnt">{es.length}</span>}
                  <span className="num">{es.length ? fmt(cday(c.id)) : ''}</span>
                  <span className="chev" aria-hidden="true">
                    ›
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

function IncomeTab({ M, g, onG, onTile }: { M: string; g: string | null; onG: (g: string | null) => void; onTile: (g: string) => void }) {
  const { data, toast } = useApp()
  const flashCls = useFlashClass()
  const [edit, setEdit] = useState<string | null>(null)
  const groups = groupsAt(data, M)
  const gsel = g && groups.some((x) => x.id === g) ? g : null
  const list = data.incs.filter((i) => i.month === M && (!gsel || i.g === gsel)).sort((a, b) => a.date.localeCompare(b.date) || a.updated_at - b.updated_at)
  return (
    <>
      <Tiles M={M} onTile={onTile} />
      <div className="ph-chips" role="group" aria-label="Группа">
        <button aria-pressed={!gsel} onClick={() => onG(null)}>
          Все
        </button>
        {groups.map((x) => (
          <button key={x.id} aria-pressed={gsel === x.id} onClick={() => onG(x.id)}>
            {x.name}
          </button>
        ))}
      </div>
      {gsel && <GroupSummary M={M} g={gsel} className="ph-sum" />}
      {list.length ? (
        <>
          <ul className="ph-list">
            {list.map((i) =>
              edit === i.id ? (
                <li key={i.id}>
                  <IncomeEditForm inc={i} withGroup className="ph-form" onDone={() => setEdit(null)} />
                </li>
              ) : (
                <li key={i.id} className={flashCls(i.id, i.who)}>
                  <div className="ph-li">
                    <b className="num pos">+{fmt(i.amt)}</b>
                    <small>
                      {shortDay(i.date)} · {groups.find((x) => x.id === i.g)?.name ?? '—'}
                      {i.note ? ' · ' + i.note : ''}
                    </small>
                  </div>
                  <Avatar who={i.who} />
                  <button className="x nav" onClick={() => setEdit(i.id)} aria-label="Изменить доход">
                    ✎
                  </button>
                  <button className="x" onClick={() => void removeRow('inc', i).then(() => toast('Доход удалён'))} aria-label="Удалить доход">
                    ×
                  </button>
                </li>
              ),
            )}
          </ul>
          <div className="ph-total">
            <span>Всего пришло</span>
            <span className="num">{rub(sum(list, (i) => i.amt))}</span>
          </div>
        </>
      ) : (
        <p className="ph-note">
          Доходов на {monName(M)} {gsel ? 'в эту группу ' : ''}ещё нет.
        </p>
      )}
      <IncomeAddForm key={M + (gsel ?? "")} M={M} group={gsel ?? undefined} className="ph-form" title={`Добавить доход на ${monName(M)}`} wideClass="wide" />
      <p className="ph-note">Доход записывается в открытый месяц. Для другого месяца переключите его стрелками вверху.</p>
    </>
  )
}

function ChecksTab({ onGo }: { onGo: (date: string) => void }) {
  const { users, me, toast } = useApp()
  const flashCls = useFlashClass()
  const { lc, next, after, byWho, hist } = useCheckSummary()
  const name = (id: string) => (users.find((u) => u.id === id) ?? (id === me.id ? me : null))?.name ?? '?'
  return (
    <>
      <dl className="ph-sum">
        <div>
          <dt>Сверено по</dt>
          <dd>{lc ? shortDay(lc.date) : '—'}</dd>
        </div>
        <div>
          <dt>Вносить с</dt>
          <dd>{lc ? shortDay(next) : '—'}</dd>
        </div>
        <div>
          <dt>После внесено</dt>
          <dd>{trats(after.length)}</dd>
        </div>
        <div>
          <dt>На сумму</dt>
          <dd>{fmt(sum(after, (e) => e.amt))}</dd>
        </div>
      </dl>
      <p className="ph-note">{whoList(byWho, name) || 'После отсечки ничего не внесено.'}</p>
      {lc && (
        <div className="ph-pad">
          <button className="btn ghost sm" onClick={() => onGo(next)}>
            Открыть траты с {shortDay(next)}
          </button>
        </div>
      )}
      <CheckForm className="ph-form" wideClass="wide" />
      <h4 className="ph-h">История отсечек</h4>
      {hist.length ? (
        <ul className="ph-list">
          {hist.map((c) => (
            <li key={c.id} className={flashCls(c.id, c.who)}>
              <div className="ph-li">
                <b>{dayLabel(c.date)}</b>
                <small>{c.note || 'без комментария'}</small>
              </div>
              <Avatar who={c.who} />
              <button className="x" onClick={() => void removeRow('chk', c).then(() => toast('Отсечка удалена'))} aria-label="Удалить отсечку">
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ph-note">Отсечек пока нет.</p>
      )}
    </>
  )
}

function TotalsTab({ M }: { M: string }) {
  const { data } = useApp()
  const t = useMemo(() => monthStats(data, M), [data, M])
  const lc = lastCheck(data)
  const tot = (c: string) => sum(t.ex.filter((e) => e.c === c), (e) => e.amt)
  return (
    <>
      <p className="ph-note">
        Траты за {monName(M)} по статьям и группам{lc && lc.date.startsWith(M) ? `, сверено по ${shortDay(lc.date)}` : ''}.
      </p>
      {groupsAt(data, M).map((g) => {
        const cats = t.cats.filter((c) => c.g === g.id)
        return (
          <div className="ph-g" key={g.id}>
            <div className="ph-gh">
              <span>{g.name}</span>
              <span className="num">{fmt(sum(cats, (c) => tot(c.id)))}</span>
            </div>
            {cats.map((c) => (
              <div className="ph-row static" key={c.id}>
                <span>{c.name}</span>
                <span className="num">{tot(c.id) ? fmt(tot(c.id)) : ''}</span>
              </div>
            ))}
          </div>
        )
      })}
      <div className="ph-total">
        <span>Итого за {monName(M)}</span>
        <span className="num">{rub(sum(t.ex, (e) => e.amt))}</span>
      </div>
    </>
  )
}

function SettingsTab({ M }: { M: string }) {
  const { me, users, session, logout } = useApp()
  const expView = useExpenseView()
  const sync = useSyncState()
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <div className="ph-me">
        <Avatar who={me.id} />
        <div className="ph-li">
          <b>{me.name}</b>
          <small>логин {me.login}</small>
        </div>
        <button className="btn ghost sm" onClick={() => (sync.pending ? setConfirm(true) : void logout())}>
          Выйти
        </button>
      </div>
      {confirm && (
        <div className="ph-pad">
          <ConfirmBox
            text={`${sync.pending} изменений ещё не отправлены на сервер. После выхода они останутся на этом устройстве и отправятся при следующем входе.`}
            yes="Выйти"
            onYes={() => void logout()}
            onNo={() => setConfirm(false)}
          />
        </div>
      )}
      <div className="ph-pad" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <SyncBadge />
        <small style={{ color: 'var(--muted)' }}>{session.server || location.host}</small>
      </div>
      <h4 className="ph-h">Вид трат</h4>
      <div className="ph-pad">
        <div className="seg" role="group" aria-label="Вид трат">
          <button aria-pressed={expView === 'day'} onClick={() => setExpenseView('day')}>
            По дням
          </button>
          <button aria-pressed={expView === 'table'} onClick={() => setExpenseView('table')}>
            Таблица
          </button>
        </div>
      </div>
      <h4 className="ph-h">Тема оформления</h4>
      <div className="ph-pad">
        <ThemeSwitch />
      </div>
      <MobileStructSettings M={M} />
      <h4 className="ph-h">Резервные копии</h4>
      <div className="ph-pad">
        <BackupsPanel />
      </div>
      <h4 className="ph-h">Все пользователи</h4>
      <ul className="ph-list">
        {(users.length ? users : [me]).map((u) => (
          <li key={u.id}>
            <Avatar who={u.id} />
            <div className="ph-li">
              <b>{u.name}</b>
              <small>логин {u.login}</small>
            </div>
          </li>
        ))}
      </ul>
      <p className="ph-note">Пароли и новые пользователи — в версии для компьютера, раздел «Пользователи».</p>
      <p className="ph-note">Версия {__APP_VERSION__}</p>
    </>
  )
}
