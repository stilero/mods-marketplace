// The pane's chrome colors and copy: the same calm palette as cache-thermo, not loud.
// Quill's own colors come from art.ts; these are for text and borders.
import type { CriterionKey, CriterionStatus } from '../types'

export const THEME = {
  present: '#6ee7b7',
  reading: '#fcd34d',
  missing: '#fb7185',
  ink: '#dfe7ef',
  dim: '#8a93a6',
  panel: '#0f1420',
  owl: '#e8c39e',
}

export const CRITERIA: readonly CriterionKey[] = ['goal', 'why', 'constraints', 'done', 'reuse']

export const LABEL: Record<CriterionKey, string> = {
  goal: 'Goal',
  why: 'Why',
  constraints: 'Constraints',
  done: 'Done when',
  reuse: 'Reuse',
}

/** One line on each part, for the idle card. */
export const BLURB: Record<CriterionKey, string> = {
  goal: 'what are we building or changing',
  why: 'the background: the problem, who it is for',
  constraints: 'libraries to use or avoid, what not to touch',
  done: 'how we know it is finished',
  reuse: 'code, patterns or docs to build on',
}

export const STATUS_DOT: Record<CriterionStatus, string> = {
  present: '✓',
  missing: '✗',
  'n/a': '–',
}

export const statusColor = (s: CriterionStatus): string =>
  s === 'present' ? THEME.present : s === 'missing' ? THEME.missing : THEME.dim
