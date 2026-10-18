export const MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
export const GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export const pad = (n: number) => String(n).padStart(2, '0')
export const sum = <T,>(a: readonly T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0)
export const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU')
export const rub = (n: number) => fmt(n) + ' ₽'
export const compact = (n: number) => (n >= 10000 ? (n / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + 'к' : fmt(n))

export const todayStr = () => {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
export const curMonth = () => todayStr().slice(0, 7)

export const parseYM = (s: string) => {
  const [y, m] = s.split('-').map(Number)
  return { y, m }
}
export const dim = (s: string) => {
  const { y, m } = parseYM(s)
  return new Date(y, m, 0).getDate()
}
export const shiftYM = (s: string, d: number) => {
  const { y, m } = parseYM(s)
  const t = new Date(y, m - 1 + d, 1)
  return t.getFullYear() + '-' + pad(t.getMonth() + 1)
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
export const capitalize = cap
export const monthTitle = (M: string) => {
  const { y, m } = parseYM(M)
  return cap(MON[m - 1]) + ' ' + y
}
export const monName = (M: string) => MON[parseYM(M).m - 1]
export const monGen = (M: string) => GEN[parseYM(M).m - 1]
export const weekday = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}
export const dayLabel = (date: string) => {
  const [, m, d] = date.split('-').map(Number)
  return d + ' ' + GEN[m - 1] + ', ' + WD[weekday(date)]
}
export const shortDay = (date: string) => {
  const [, m, d] = date.split('-').map(Number)
  return d + ' ' + GEN[m - 1]
}
export const nextDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(y, m - 1, d + 1)
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate())
}
export const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5)
export const plural = (n: number, a: string, b: string, c: string) => {
  const m10 = n % 10
  const m100 = n % 100
  return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c
}
export const trats = (n: number) => n + ' ' + plural(n, 'трата', 'траты', 'трат')

/** Monday-based weeks of a month as [firstDay, lastDay] pairs. */
export function weeksOf(M: string): [number, number][] {
  const { y, m } = parseYM(M)
  const n = dim(M)
  const off = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const w: [number, number][] = []
  for (let s = 1 - off; s <= n; s += 7) w.push([Math.max(1, s), Math.min(n, s + 6)])
  return w
}

/** "350+120" → [350, 120]; empty → []; invalid → null. */
export function parseTerms(input: string): number[] | null {
  const s = String(input).replace(/[\s  ]/g, '').replace(/,/g, '.').replace(/^=/, '')
  if (!s) return []
  if (!/^\d+(\.\d+)?(\+\d+(\.\d+)?)*$/.test(s)) return null
  return s.split('+').map(Number).filter((n) => n > 0).map((n) => Math.round(n * 100) / 100)
}

export function parseSigned(input: string): number | null {
  const s = String(input).replace(/[\s  ]/g, '').replace(/,/g, '.').replace(/[−–]/g, '-')
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return Math.round(Number(s) * 100) / 100
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 12)
