// Module-level runtime the hooks share. Nothing here must survive a hot reload:
// everything a drawing reads lives in $.state (see types/index.d.ts).
import type { EngineInterface } from 'claude-code'

import type { CacheClock, CacheContext, Estimate } from '../types'
import type { Opts } from './options'
import { estimateRecache, formatUsd, getPricingTable } from './pricing'

export const rt: {
  opts: Opts
  /** True while a main-loop turn runs (turn.start → turn.complete). */
  isWorking: boolean
  /** Synchronous guard for the keep-warm fork; mirrored in state for the drawing. */
  keepWarmInFlight: boolean
} = {
  opts: {
    cacheTtl: 'auto',
    gateThresholdUsd: 0.25,
    warnFraction: 0.2,
    keepWarmLeadSeconds: 90,
    maxBreakHours: 4,
    inputPriceOverrideUsdPerMTok: 0,
    sounds: true,
    showCostOnSubscription: true,
  },
  isWorking: false,
  keepWarmInFlight: false,
}

export function currentEstimate(ctx: CacheContext, clock: CacheClock): Estimate {
  return estimateRecache(ctx.tokens, ctx.model, clock.ttl, rt.opts.inputPriceOverrideUsdPerMTok, getPricingTable())
}

/** A dollar figure as this person sees it: "$8.48", "$8.48 API-equiv" on a subscription, null when they turned dollars off. */
export function moneyText(usd: number, isSubscription: boolean): string | null {
  if (!isSubscription) return formatUsd(usd)
  return rt.opts.showCostOnSubscription ? `${formatUsd(usd)} API-equiv` : null
}

export type SoundName = 'warm' | 'cold' | 'gate' | 'resume'
