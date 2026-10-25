import type { PluginOptions } from 'claude-code'

export type Opts = {
  cacheTtl: string
  gateThresholdUsd: number
  warnFraction: number
  keepWarmLeadSeconds: number
  maxBreakHours: number
  inputPriceOverrideUsdPerMTok: number
  sounds: boolean
  showCostOnSubscription: boolean
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function readOptions(options: PluginOptions): Opts {
  return {
    cacheTtl: String(options.cacheTtl ?? 'auto'),
    gateThresholdUsd: Math.max(0, num(options.gateThresholdUsd, 0.25)),
    warnFraction: Math.min(0.95, Math.max(0.01, num(options.warnFraction, 0.2))),
    keepWarmLeadSeconds: num(options.keepWarmLeadSeconds, 90),
    maxBreakHours: Math.max(0.1, num(options.maxBreakHours, 4)),
    inputPriceOverrideUsdPerMTok: Math.max(0, num(options.inputPriceOverrideUsdPerMTok, 0)),
    sounds: options.sounds !== false && options.sounds !== 'false',
    showCostOnSubscription:
      options.showCostOnSubscription !== false && options.showCostOnSubscription !== 'false',
  }
}
