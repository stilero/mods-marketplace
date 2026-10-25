// The band's and panels' own chrome colors and copy: cute and calm, not loud.
// Sprite and thermometer colors come from art.ts (PALETTE); these are for text and borders.
import type { CacheZone } from '../types'

export const THEME = {
  hot: '#6ee7b7',
  warm: '#fcd34d',
  cold: '#fb7185',
  ink: '#dfe7ef',
  dim: '#8a93a6',
  panel: '#0f1420',
  ember: '#ffb27a',
  frost: '#93c5fd',
}

export const ZONE_LABEL: Record<CacheZone, string> = {
  hot: 'toasty',
  warm: 'cooling off',
  cold: 'brrr, cold',
  working: 'warming up',
}

export const ZONE_DOT: Record<CacheZone, string> = {
  hot: '●',
  warm: '◐',
  cold: '○',
  working: '✦',
}

export const zoneColor = (zone: CacheZone): string =>
  zone === 'cold' ? THEME.cold : zone === 'warm' ? THEME.warm : THEME.hot
