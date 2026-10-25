import { describe, expect, test } from 'claude-code/testing'

import {
  clockFor,
  formatAgo,
  formatClock,
  formatTokens,
  keepWarmLeadMs,
  remainingFraction,
  resolveTtl,
  retime,
  TTL_MS,
  zoneFor,
} from './clock'

describe('resolveTtl', () => {
  test('config pins the TTL', async () => {
    expect(resolveTtl('5m', true)).toEqual({ ttl: '5m', source: 'config' })
    expect(resolveTtl('1h', false)).toEqual({ ttl: '1h', source: 'config' })
  })
  test('auto picks 1h on a subscription (rate limits reported), 5m otherwise', async () => {
    expect(resolveTtl('auto', true)).toEqual({ ttl: '1h', source: 'heuristic' })
    expect(resolveTtl('auto', false)).toEqual({ ttl: '5m', source: 'heuristic' })
    expect(resolveTtl('nonsense', false)).toEqual({ ttl: '5m', source: 'heuristic' })
  })
})

describe('clock and zones', () => {
  test('warmUntil is the request start plus the TTL', async () => {
    const c = clockFor(1_000, '1h', 'heuristic')
    expect(c.warmUntil).toBe(1_000 + TTL_MS['1h'])
    expect(retime(c, '5m', 'config')).toEqual(clockFor(1_000, '5m', 'config'))
  })
  test('zones follow the remaining fraction', async () => {
    const c = clockFor(0, '5m', 'config')
    expect(zoneFor(c, 0, 0.2, false)).toBe('hot')
    expect(zoneFor(c, TTL_MS['5m'] * 0.5, 0.2, false)).toBe('hot')
    expect(zoneFor(c, TTL_MS['5m'] * 0.85, 0.2, false)).toBe('warm')
    expect(zoneFor(c, TTL_MS['5m'], 0.2, false)).toBe('cold')
    expect(zoneFor(c, TTL_MS['5m'] * 2, 0.2, false)).toBe('cold')
    expect(zoneFor(c, TTL_MS['5m'] * 2, 0.2, true)).toBe('working')
    expect(zoneFor(null, 0, 0.2, false)).toBe(null)
  })
  test('remaining fraction is clamped to [0, 1]', async () => {
    const c = clockFor(100, '1h', 'config')
    expect(remainingFraction(c, 0)).toBe(1)
    expect(Number((remainingFraction(c, 100 + TTL_MS['1h'] / 4)).toFixed(5))).toBe(0.75)
    expect(remainingFraction(c, 100 + TTL_MS['1h'] * 3)).toBe(0)
  })
  test('keep-warm lead is clamped to [30 s, ttl/2]', async () => {
    expect(keepWarmLeadMs(90, TTL_MS['1h'])).toBe(90_000)
    expect(keepWarmLeadMs(5, TTL_MS['1h'])).toBe(30_000)
    expect(keepWarmLeadMs(600, TTL_MS['5m'])).toBe(150_000)
    expect(keepWarmLeadMs(Number.NaN, TTL_MS['5m'])).toBe(90_000)
  })
})

describe('formatting', () => {
  test('clock, ago and token formats', async () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(61_000)).toBe('01:01')
    expect(formatClock(3_661_000)).toBe('1:01:01')
    expect(formatAgo(45_000)).toBe('45s')
    expect(formatAgo(12 * 60_000)).toBe('12m')
    expect(formatAgo(72 * 60_000)).toBe('1h 12m')
    expect(formatTokens(980)).toBe('980')
    expect(formatTokens(1_240)).toBe('1.2k')
    expect(formatTokens(212_480)).toBe('212k')
    expect(formatTokens(1_250_000)).toBe('1.3M')
  })
})
