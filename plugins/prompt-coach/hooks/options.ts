import type { PluginOptions } from 'claude-code'

export type Opts = {
  mode: 'hints' | 'gate'
  trigger: 'conversation' | 'every'
  model: string
  minChars: number
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function readOptions(options: PluginOptions): Opts {
  const model = String(options.model ?? '').trim()
  return {
    mode: options.mode === 'gate' ? 'gate' : 'hints',
    trigger: options.trigger === 'every' ? 'every' : 'conversation',
    model: model === '' ? 'haiku' : model,
    minChars: Math.max(0, Math.round(num(options.minChars, 20))),
  }
}
