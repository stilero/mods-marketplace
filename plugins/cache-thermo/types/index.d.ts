export type CacheZone = 'hot' | 'warm' | 'cold' | 'working'
export type CacheTtl = '5m' | '1h'
export type TtlSource = 'config' | 'heuristic'

export type CacheClock = {
  lastRequestStartedAt: number
  warmUntil: number
  ttlMs: number
  ttl: CacheTtl
  ttlSource: TtlSource
}

export type CacheContext = {
  tokens: number
  window: number
  model: string
  /** Rate limits were reported, so the dollars are API-equivalent, not billed. */
  isSubscription: boolean
}

export type Estimate = {
  usd: number
  tokens: number
  ttl: CacheTtl
  model: string
  modelName: string
  pricing: 'table' | 'override' | 'unknown-model'
}

export type PendingGate = {
  text: string
  estimate: Estimate
  lastRequestAgoMs: number
}

export type BreakState = {
  since: number
  refreshes: number
  spentUsd: number
  nextRefreshAt: number
  inFlight: boolean
  lastReadTokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-thermo': {
      clock: CacheClock | null
      context: CacheContext | null
      now: number
      gate: PendingGate | null
      brk: BreakState | null
      isBandHidden: boolean
      lastZone: CacheZone | null
    }
  }
}
