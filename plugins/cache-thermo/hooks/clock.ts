// Pure cache-clock math. No imports: this file is shared by the hooks module and the tests.

import type { CacheClock, CacheTtl, CacheZone, TtlSource } from '../types'

export const TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }

export type ClockOptions = {
  /** `auto`, `5m` or `1h` from userConfig. */
  cacheTtl: string
  /** Remaining fraction at or below which the band turns yellow. */
  warnFraction: number
}

/** Picks the TTL: the configured one, else 1h on a subscription (rate limits reported) and 5m otherwise. */
export function resolveTtl(
  cacheTtl: string,
  hasRateLimits: boolean,
): { ttl: CacheTtl; source: TtlSource } {
  if (cacheTtl === '5m' || cacheTtl === '1h') return { ttl: cacheTtl, source: 'config' }
  return { ttl: hasRateLimits ? '1h' : '5m', source: 'heuristic' }
}

/** A clock started by a request at `requestStartedAt`. */
export function clockFor(
  requestStartedAt: number,
  ttl: CacheTtl,
  source: TtlSource,
): CacheClock {
  const ttlMs = TTL_MS[ttl]
  return {
    lastRequestStartedAt: requestStartedAt,
    warmUntil: requestStartedAt + ttlMs,
    ttlMs,
    ttl,
    ttlSource: source,
  }
}

/** The same clock on another TTL (the config changed). */
export function retime(clock: CacheClock, ttl: CacheTtl, source: TtlSource): CacheClock {
  return clockFor(clock.lastRequestStartedAt, ttl, source)
}

export function remainingMs(clock: CacheClock, now: number): number {
  return Math.max(0, clock.warmUntil - now)
}

/** Remaining TTL as a fraction in [0, 1]. */
export function remainingFraction(clock: CacheClock, now: number): number {
  if (clock.ttlMs <= 0) return 0
  return Math.min(1, remainingMs(clock, now) / clock.ttlMs)
}

export function isCold(clock: CacheClock | null, now: number): boolean {
  return clock !== null && remainingMs(clock, now) <= 0
}

export function zoneFor(
  clock: CacheClock | null,
  now: number,
  warnFraction: number,
  isWorking: boolean,
): CacheZone | null {
  if (clock === null) return null
  if (isWorking) return 'working'
  const fraction = remainingFraction(clock, now)
  if (fraction <= 0) return 'cold'
  if (fraction <= warnFraction) return 'warm'
  return 'hot'
}

/** `mm:ss`, or `h:mm:ss` past an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** `41 min left` above two minutes, `1:59 left` below; `nap time` when gone. */
export function formatLeft(ms: number): string {
  if (ms <= 0) return 'nap time'
  if (ms > 120_000) {
    const min = Math.ceil(ms / 60_000)
    return `${min} min left`
  }
  return `${formatClock(ms)} left`
}

/**
 * What the band shows changes only when this key changes: the zone, the
 * minute above two minutes left, the second below. The ticker redraws on it,
 * not on every second, so the desktop does not re-mount the band each tick.
 */
export function displayKey(remaining: number, zone: string): string {
  if (remaining <= 0) return `${zone}:0`
  if (remaining > 120_000) return `${zone}:m${Math.ceil(remaining / 60_000)}`
  return `${zone}:s${Math.floor(remaining / 1000)}`
}

/** `1h 12m`, `12m`, `45s`: how long ago, for the dialog. */
export function formatAgo(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

/** `212k`, `1.2M`, `980`. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/** `212,480`. */
export function formatTokensLong(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Keep-warm lead clamped to [30 s, ttl/2]. */
export function keepWarmLeadMs(leadSeconds: number, ttlMs: number): number {
  const lead = Math.max(30, Number.isFinite(leadSeconds) ? leadSeconds : 90) * 1000
  return Math.min(lead, Math.floor(ttlMs / 2))
}
