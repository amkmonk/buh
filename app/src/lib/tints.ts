import type { CSSProperties } from 'react'

/** Barely visible row backgrounds a category can have; the colours live in styles.css as --tint-<key>. */
export const ROW_TINTS: { key: string; name: string }[] = [
  { key: '', name: 'Без фона' },
  { key: 'blue', name: 'Голубой' },
  { key: 'green', name: 'Зелёный' },
  { key: 'yellow', name: 'Жёлтый' },
  { key: 'peach', name: 'Персиковый' },
  { key: 'pink', name: 'Розовый' },
  { key: 'violet', name: 'Сиреневый' },
  { key: 'mint', name: 'Мятный' },
  { key: 'gray', name: 'Серый' },
]

/** Inline style that tints a category row (cells read --row). */
export const rowTint = (bg?: string): CSSProperties | undefined =>
  bg && ROW_TINTS.some((t) => t.key === bg) ? ({ ['--row' as string]: `var(--tint-${bg})` } as CSSProperties) : undefined
