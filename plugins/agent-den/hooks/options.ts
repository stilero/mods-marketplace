// userConfig → Opts. Values can come in as strings (settings UI) or be missing, so every field is read,
// coerced and clamped here, and the rest of the mod trusts Opts.
import type { PluginOptions } from 'claude-code'

import type { Animations } from './art'

export type Opts = {
  autoOpen: boolean
  keepFinishedMinutes: number
  animations: Animations
  buddyMap: string
  maxLogLines: number
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

const ANIMATIONS: readonly Animations[] = ['full', 'calm', 'off']

/** Reads the mod's userConfig with defaults true, 10, 'full', '', 300. */
export function readOptions(options: PluginOptions): Opts {
  const anim = String(options.animations ?? 'full')
  return {
    autoOpen: options.autoOpen !== false && options.autoOpen !== 'false',
    keepFinishedMinutes: clamp(num(options.keepFinishedMinutes, 10), 0.5, 240),
    animations: ANIMATIONS.find(a => a === anim) ?? 'full',
    buddyMap: String(options.buddyMap ?? ''),
    maxLogLines: clamp(Math.round(num(options.maxLogLines, 300)), 20, 5000),
  }
}
