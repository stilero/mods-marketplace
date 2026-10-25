// The den's own chrome colors and copy: cute and calm, not loud.
// Sprite colors come from buddies.ts (each buddy's palette and accent); these are for text, dots and borders.
import type { DenStatus } from '../types'

export const THEME = {
  hot: '#6ee7b7',
  warm: '#fcd34d',
  cold: '#fb7185',
  ink: '#dfe7ef',
  dim: '#8a93a6',
  panel: '#0f1420',
  ember: '#ffb27a',
  frost: '#93c5fd',
  accent: '#c4b5fd',
  ghost: '#9aa3b5',
}

/** Friendly words for each status, used in counts, cards and the status line. */
export const STATUS_LABEL: Record<DenStatus, string> = {
  pending: 'hatching',
  running: 'busy',
  waiting: 'waiting',
  idle: 'napping',
  completed: 'done',
  failed: 'oops',
  killed: 'stopped',
}

/** One-cell dot for each status (header counts and card status lines). */
export const STATUS_DOT: Record<DenStatus, string> = {
  running: '●',
  waiting: '◐',
  idle: '○',
  pending: '✦',
  completed: '✓',
  failed: '✗',
  killed: '·',
}

/** The color of a status dot, a hover border and a failed or killed sprite. */
export const statusColor = (s: DenStatus): string => {
  switch (s) {
    case 'running':
    case 'completed':
      return THEME.hot
    case 'waiting':
      return THEME.warm
    case 'idle':
      return THEME.frost
    case 'failed':
      return THEME.cold
    case 'killed':
      return THEME.dim
    case 'pending':
      return THEME.ember
  }
}

/** Display order for the header counts and the summary: live first, then ended. */
export const STATUS_ORDER: readonly DenStatus[] = ['running', 'waiting', 'idle', 'pending', 'completed', 'failed', 'killed']

/** Card hover background on GUI surfaces. */
export const CARD_HOVER_BG = '#151c2c'
