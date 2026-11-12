// The band's chrome colors and copy: the same calm palette as cache-thermo and prompt-coach, not loud.
// Cog's own colors come from art.ts; these are for text and borders.
import type { Complexity, Direction } from '../types'

export const THEME = {
  /** A lower setup is enough: mint, the color of a saving. */
  down: '#6ee7b7',
  /** The work needs more: lavender. */
  up: '#c4b5fd',
  reading: '#fcd34d',
  ink: '#dfe7ef',
  dim: '#8a93a6',
  panel: '#0f1420',
  cog: '#a9c4e4',
}

export const directionColor = (d: Direction): string => (d === 'down' ? THEME.down : THEME.up)

export const DIRECTION_MARK: Record<Direction, string> = { down: '▼', up: '▲' }

/** How the band names a complexity, in "… work". */
export const COMPLEXITY_LABEL: Record<Complexity, string> = {
  trivial: 'trivial',
  simple: 'simple',
  moderate: 'everyday',
  complex: 'complex',
  deep: 'deep',
}
