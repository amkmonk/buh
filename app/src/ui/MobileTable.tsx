import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state'
import { useFlashClass } from './common'
import { cellKey, groupsAt, lastCheck, monthStats } from '../lib/model'
import { GEN, WD, dim, fmt, pad, rub, sum, todayStr, trats, weekday, weeksOf } from '../lib/format'

const NAME_W = 96 // category column; long names wrap to two lines

/** Month table for phones: three days per screen, sticky names and dates, days snap into place. */
export function MobileTable({ M, sel, onCell }: { M: string; sel: { c: string; d: number } | null; onCell: (c: string, d: number) => void }) {
  const { data } = useApp()
  const flashCls = useFlashClass()
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const t = useMemo(() => monthStats(data, M), [data, M])

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = dim(M)
  const m = +M.slice(5)
  const today = todayStr()
  const td = today.startsWith(M) ? +today.slice(8) : 0
  const lcd = lastCheck(data)?.date ?? ''
  const ws = weeksOf(M)
  const dayW = width ? Math.floor((width - NAME_W) / 3) : 80
  const totW = width ? width - NAME_W - dayW * 2 : 80
  const days = Array.from({ length: n }, (_, i) => i + 1)

  // Open the month (and re-centre after a rotation) with today in the middle of the screen.
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el || !width) return
    el.scrollLeft = td ? Math.max(0, (td - 2) * dayW) : 0
    el.scrollTop = 0
  }, [M, td, dayW, width])

  // Mouse drag pans the table (for a narrow desktop window); fingers scroll natively.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    let drag: { x: number; y: number; l: number; t: number; moved: boolean } | null = null
    let swallow = false
    const down = (e: PointerEvent) => {
      swallow = false
      if (e.pointerType === 'mouse' && e.button === 0) drag = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop, moved: false }
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) > 5) {
        drag.moved = true
        el.classList.add('drag')
      }
      if (drag.moved) {
        el.scrollLeft = drag.l - dx
        el.scrollTop = drag.t - dy
        e.preventDefault()
      }
    }
    const up = () => {
      if (drag?.moved) {
        swallow = true
        el.classList.remove('drag')
        const w = (el.querySelector('th.dh') as HTMLElement | null)?.offsetWidth || 1
        el.scrollTo({ left: Math.round(el.scrollLeft / w) * w, behavior: 'smooth' })
      }
      drag = null
    }
    const click = (e: MouseEvent) => {
      if (!swallow) return
      swallow = false
      e.stopPropagation()
      e.preventDefault()
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    el.addEventListener('click', click, true)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      el.removeEventListener('click', click, true)
    }
  }, [])

  const dc = (d: number) => {
    const ds = M + '-' + pad(d)
    const wd = weekday(ds)
    return (d === td ? ' today' : '') + (ws.findIndex(([a, b]) => d >= a && d <= b) % 2 ? ' w1' : '') + (ds === lcd ? ' cut' : '') + (wd === 0 || wd === 6 ? ' we' : '')
  }
  const cell = (c: string, d: number) => t.byCatDay.get(cellKey(c, d)) ?? []
  const cday = (c: string, d: number) => sum(cell(c, d), (e) => e.amt)
  const cnum = (x: number) => (x ? fmt(x) : '')
  const colW = { width: dayW, minWidth: dayW, maxWidth: dayW }

  return (
    <div className="mt-wrap" ref={wrap} style={{ scrollPaddingLeft: NAME_W }}>
      <table className="mt" style={{ ['--nw' as string]: NAME_W + 'px' }}>
        <thead>
          <tr>
            <th className="nm">Статья</th>
            {days.map((d) => (
              <th key={d} className={'dh' + dc(d)} style={colW} title={M + '-' + pad(d) === lcd ? 'Сверено по этот день' : undefined}>
                <b>{d}</b>
                {WD[weekday(M + '-' + pad(d))]}
              </th>
            ))}
            <th className="tot" style={{ width: totW, minWidth: totW }}>
              Итого
            </th>
          </tr>
        </thead>
        <tbody>
          {groupsAt(data, M).map((g) => {
            const cats = t.cats.filter((c) => c.g === g.id)
            const gday = (d: number) => sum(cats, (c) => cday(c.id, d))
            return [
              <tr className="grp" key={g.id}>
                <td className="nm">
                  <span>{g.name}</span>
                </td>
                {days.map((d) => (
                  <td key={d} className={'gd' + dc(d)}>
                    {cnum(gday(d))}
                  </td>
                ))}
                <td className="tot">{cnum(sum(days, gday))}</td>
              </tr>,
              ...cats.map((c) => (
                <tr className="cat" key={c.id}>
                  <td className="nm">
                    <span>{c.name}</span>
                  </td>
                  {days.map((d) => {
                    const es = cell(c.id, d)
                    const fl = es.map((e) => flashCls(e.id, e.who)).find(Boolean) ?? ''
                    const on = sel && sel.c === c.id && sel.d === d
                    return (
                      <td
                        key={d}
                        className={'d' + dc(d) + (es.length > 1 ? ' multi' : '') + (on ? ' sel' : '') + fl}
                        onClick={() => onCell(c.id, d)}
                        aria-label={`${c.name}, ${d} ${GEN[m - 1]}: ${es.length ? trats(es.length) + ' на ' + rub(cday(c.id, d)) : 'нет трат'}`}
                      >
                        {cnum(cday(c.id, d))}
                      </td>
                    )
                  })}
                  <td className="tot">{cnum(sum(days, (d) => cday(c.id, d)))}</td>
                </tr>
              )),
            ]
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="nm">
              <span>За день</span>
            </td>
            {days.map((d) => (
              <td key={d} className={dc(d).trim()}>
                {cnum(t.byDay[d] || 0)}
              </td>
            ))}
            <td className="tot">{cnum(sum(days, (d) => t.byDay[d] || 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
