import { describe, expect, test } from 'claude-code/testing'

import { estimateRecache, formatUsd, isPricingTable, keepWarmCost, normalizeModelId, priceFor } from './pricing'
import { PRICING } from './pricing-table'

describe('model matching', () => {
  test('normalizes provider paths, tags and case', async () => {
    expect(normalizeModelId('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(normalizeModelId('us.anthropic.claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(normalizeModelId('anthropic/claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(normalizeModelId('Claude-Fable-5-1[1m]')).toBe('claude-fable-5-1')
  })
  test('resolves every shipped row and flags unknown models', async () => {
    expect(priceFor('claude-fable-5-1').name).toBe('Claude Fable 5.1')
    expect(priceFor('claude-fable-5-1').cacheReadMultiplier).toBe(0.025)
    expect(priceFor('claude-fable-5').name).toBe('Claude Fable 5')
    expect(priceFor('claude-opus-5-5').inputUsdPerMTok).toBe(4)
    expect(priceFor('claude-opus-5-5').cacheReadMultiplier).toBe(0.05)
    expect(priceFor('claude-opus-5').inputUsdPerMTok).toBe(5)
    expect(priceFor('claude-opus-4-8').inputUsdPerMTok).toBe(5)
    expect(priceFor('claude-sonnet-5-5').inputUsdPerMTok).toBe(2)
    expect(priceFor('claude-sonnet-5').inputUsdPerMTok).toBe(2)
    expect(priceFor('claude-sonnet-4-6').inputUsdPerMTok).toBe(3)
    expect(priceFor('claude-haiku-5-5').inputUsdPerMTok).toBe(0.1)
    expect(priceFor('claude-haiku-4-5').inputUsdPerMTok).toBe(1)
    const unknown = priceFor('claude-ultra-9')
    expect(unknown.isFallback).toBe(true)
    expect(unknown.inputUsdPerMTok).toBe(5)
  })
})

describe('estimates', () => {
  test('re-cache cost = tokens × input price × write multiplier', async () => {
    // 400k tokens on Fable 5.1 at $10/MTok, 1h TTL (2×) = $8.00
    const e = estimateRecache(400_000, 'claude-fable-5-1', '1h')
    expect(Number((e.usd).toFixed(6))).toBe(8)
    expect(e.pricing).toBe('table')
    expect(e.modelName).toBe('Claude Fable 5.1')
    // 5m TTL writes at 1.25×
    expect(Number((estimateRecache(400_000, 'claude-fable-5-1', '5m').usd).toFixed(6))).toBe(5)
    // Opus 5.5 at $4/MTok, 1h
    expect(Number((estimateRecache(100_000, 'claude-opus-5-5', '1h').usd).toFixed(6))).toBe(0.8)
  })
  test('override price and unknown model are flagged', async () => {
    const o = estimateRecache(100_000, 'claude-opus-5-5', '1h', 20)
    expect(Number((o.usd).toFixed(6))).toBe(4)
    expect(o.pricing).toBe('override')
    expect(estimateRecache(100_000, 'claude-ultra-9', '1h').pricing).toBe('unknown-model')
  })
  test('keep-warm cost is the cache read plus the reply', async () => {
    const usd = keepWarmCost(
      { cache_read_input_tokens: 200_000, input_tokens: 50, output_tokens: 2 },
      'claude-fable-5-1',
    )
    // 200k × $10 × 0.025 / 1e6 = $0.05, + 50 × $10 / 1e6 = $0.0005, + 2 × $50 / 1e6 = $0.0001
    expect(Number((usd).toFixed(4))).toBe(0.0506)
  })
  test('the shipped table has the expected shape and dollar formatting is stable', async () => {
    expect(isPricingTable(PRICING)).toBe(true)
    expect(isPricingTable({})).toBe(false)
    expect(PRICING.cacheWriteMultiplier).toEqual({ '5m': 1.25, '1h': 2 })
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(0.25)).toBe('$0.25')
    expect(formatUsd(8.479)).toBe('$8.48')
    expect(formatUsd(123.4)).toBe('$123')
  })
})
