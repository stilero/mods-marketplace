// Pure pricing math over the shipped table. No engine imports.

import type { CacheTtl, Estimate } from '../types'
import { PRICING } from './pricing-table'

export type ModelPrice = {
  match: string
  name: string
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  cacheReadMultiplier?: number
}

export type PricingTable = {
  asOf: string
  source: string
  cacheWriteMultiplier: Record<CacheTtl, number>
  defaultCacheReadMultiplier: number
  models: ModelPrice[]
  fallback: Omit<ModelPrice, 'match'>
}

let activeTable: PricingTable = PRICING

/** The table in force: the shipped one, or pricing.json read from the plugin folder at session start. */
export function getPricingTable(): PricingTable {
  return activeTable
}

/** Accepts a parsed pricing.json when it has the expected shape; returns whether it was taken. */
export function setPricingTable(candidate: unknown): boolean {
  if (!isPricingTable(candidate)) return false
  activeTable = candidate
  return true
}

export function isPricingTable(v: unknown): v is PricingTable {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  const mult = t.cacheWriteMultiplier as Record<string, unknown> | undefined
  return (
    typeof t.asOf === 'string' &&
    typeof mult === 'object' && mult !== null &&
    typeof mult['5m'] === 'number' && typeof mult['1h'] === 'number' &&
    typeof t.defaultCacheReadMultiplier === 'number' &&
    Array.isArray(t.models) &&
    t.models.every(m => typeof m === 'object' && m !== null && typeof (m as ModelPrice).match === 'string' && typeof (m as ModelPrice).inputUsdPerMTok === 'number') &&
    typeof t.fallback === 'object' && t.fallback !== null
  )
}

export type ResolvedPrice = {
  name: string
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  cacheReadMultiplier: number
  isFallback: boolean
}

/** Strips a provider path (`us.anthropic.`), a `[1m]` tag and surrounding whitespace. */
export function normalizeModelId(model: string): string {
  let id = model.trim().toLowerCase()
  id = id.replace(/\[.*?\]/g, '')
  const slash = id.lastIndexOf('/')
  if (slash >= 0) id = id.slice(slash + 1)
  id = id.replace(/^(?:[a-z]{2}(?:-[a-z]+)?\.)?anthropic\./, '')
  return id.trim()
}

export function priceFor(model: string, table: PricingTable = PRICING): ResolvedPrice {
  const id = normalizeModelId(model)
  for (const row of table.models) {
    if (new RegExp(row.match).test(id)) {
      return {
        name: row.name,
        inputUsdPerMTok: row.inputUsdPerMTok,
        outputUsdPerMTok: row.outputUsdPerMTok,
        cacheReadMultiplier: row.cacheReadMultiplier ?? table.defaultCacheReadMultiplier,
        isFallback: false,
      }
    }
  }
  return {
    name: table.fallback.name,
    inputUsdPerMTok: table.fallback.inputUsdPerMTok,
    outputUsdPerMTok: table.fallback.outputUsdPerMTok,
    cacheReadMultiplier: table.fallback.cacheReadMultiplier ?? table.defaultCacheReadMultiplier,
    isFallback: true,
  }
}

/** What re-caching `tokens` of context costs on `model` at the `ttl` write rate. */
export function estimateRecache(
  tokens: number,
  model: string,
  ttl: CacheTtl,
  inputPriceOverride = 0,
  table: PricingTable = PRICING,
): Estimate {
  const price = priceFor(model, table)
  const hasOverride = inputPriceOverride > 0
  const inputPrice = hasOverride ? inputPriceOverride : price.inputUsdPerMTok
  const usd = (tokens * inputPrice * table.cacheWriteMultiplier[ttl]) / 1_000_000
  return {
    usd,
    tokens,
    ttl,
    model,
    modelName: price.name,
    pricing: hasOverride ? 'override' : price.isFallback ? 'unknown-model' : 'table',
  }
}

/** What one keep-warm request cost: its cache read plus its (tiny) reply. */
export function keepWarmCost(
  usage: { cache_read_input_tokens: number; input_tokens: number; output_tokens: number },
  model: string,
  inputPriceOverride = 0,
  table: PricingTable = PRICING,
): number {
  const price = priceFor(model, table)
  const inputPrice = inputPriceOverride > 0 ? inputPriceOverride : price.inputUsdPerMTok
  const read = (usage.cache_read_input_tokens * inputPrice * price.cacheReadMultiplier) / 1_000_000
  const fresh = (usage.input_tokens * inputPrice) / 1_000_000
  const out = (usage.output_tokens * price.outputUsdPerMTok) / 1_000_000
  return read + fresh + out
}

export function formatUsd(usd: number): string {
  if (usd >= 100) return `$${Math.round(usd)}`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(2)}`
  if (usd > 0) return `<$0.01`
  return '$0.00'
}
