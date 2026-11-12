import type { PluginOptions } from 'claude-code'

export type Opts = {
  mode: 'gate' | 'hints'
  gateOn: 'both' | 'down' | 'up'
  trigger: 'conversation' | 'every'
  model: string
  /** Model names as /model takes them, from the cheapest to the most capable. */
  ladder: string[]
  effortTolerance: number
  minChars: number
}

export const DEFAULT_LADDER: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable']

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** "haiku, Sonnet,opus" → ['haiku', 'sonnet', 'opus']; fewer than two names leave nothing to advise, so the default stands. */
export function parseLadder(raw: unknown): string[] {
  const names = String(raw ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s !== '')
  const unique = names.filter((n, i) => names.indexOf(n) === i)
  return unique.length >= 2 ? unique : [...DEFAULT_LADDER]
}

export function readOptions(options: PluginOptions): Opts {
  const model = String(options.model ?? '').trim()
  return {
    mode: options.mode === 'hints' ? 'hints' : 'gate',
    gateOn: options.gateOn === 'down' ? 'down' : options.gateOn === 'up' ? 'up' : 'both',
    trigger: options.trigger === 'every' ? 'every' : 'conversation',
    model: model === '' ? 'haiku' : model,
    ladder: parseLadder(options.ladder),
    effortTolerance: Math.max(0, Math.min(4, Math.round(num(options.effortTolerance, 1)))),
    minChars: Math.max(0, Math.round(num(options.minChars, 20))),
  }
}
