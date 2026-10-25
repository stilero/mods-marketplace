import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BreakState, CacheClock, CacheZone, PendingGate } from '../types'
import { asciiWidth, bar, BUDDY_W, CAMPFIRE_ASCII, EMBER_ASCII, FROSTBIT_ASCII, PALETTE, campfireSvg, frostbitSvg, thermometerSvg } from './art'
import {
  clockFor,
  displayKey,
  formatAgo,
  formatClock,
  formatLeft,
  formatTokens,
  formatTokensLong,
  isCold,
  remainingFraction,
  keepWarmLeadMs,
  remainingMs,
  resolveTtl,
  zoneFor,
} from './clock'
import { readOptions } from './options'
import { formatUsd, getPricingTable, keepWarmCost, setPricingTable } from './pricing'
import { currentEstimate, moneyText, rt } from './runtime'
import { THEME, ZONE_DOT, ZONE_LABEL, zoneColor } from './theme'
import type { SoundName } from './runtime'
const PLUGIN = 'cache-thermo'
const BUILD = '0.2.2'

const clockAtom = atom({ plugin: 'cache-thermo', key: 'clock' } as const, null)
const contextAtom = atom({ plugin: 'cache-thermo', key: 'context' } as const, null)
const nowAtom = atom({ plugin: 'cache-thermo', key: 'now' } as const, 0)
const gateAtom = atom({ plugin: 'cache-thermo', key: 'gate' } as const, null)
const brkAtom = atom({ plugin: 'cache-thermo', key: 'brk' } as const, null)
const isBandHiddenAtom = atom({ plugin: 'cache-thermo', key: 'isBandHidden' } as const, false)
const lastZoneAtom = atom({ plugin: 'cache-thermo', key: 'lastZone' } as const, null)

/** Best effort: no sound on Linux/Windows, none when the file is missing. */
function play($: EngineInterface, name: SoundName): void {
  if (!rt.opts.sounds) return
  $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
}

const WRITE_LABEL = { '5m': '1.25× write, 5m TTL', '1h': '2× write, 1h TTL' } as const

function describePricing(g: PendingGate): string {
  const e = g.estimate
  switch (e.pricing) {
    case 'override':
      return `${WRITE_LABEL[e.ttl]}, your configured price`
    case 'unknown-model':
      return `${WRITE_LABEL[e.ttl]}, unknown model so Opus list price assumed`
    default:
      return `${WRITE_LABEL[e.ttl]}, ${e.modelName} list price`
  }
}

async function resubmit($: EngineInterface, g: PendingGate): Promise<void> {
  await update($, gateAtom, () => null)
  void $.prompt.submit({ text: g.text, asUser: true })
}

async function giveBack($: EngineInterface, g: PendingGate): Promise<void> {
  await update($, gateAtom, () => null)
  await $.prompt.fill({ text: g.text })
}

export const KEEP_WARM_PROMPT =
  'Cache keep-alive ping from the cache-thermo mod. Reply with a single period and nothing else.'

const STORE_TOTALS = 'breakTotals'

type Totals = { breaks: number; refreshes: number; spentUsd: number }

async function readTotals($: EngineInterface): Promise<Totals> {
  const v = (await $.store.get(STORE_TOTALS)) as Partial<Totals> | undefined
  return {
    breaks: v?.breaks ?? 0,
    refreshes: v?.refreshes ?? 0,
    spentUsd: v?.spentUsd ?? 0,
  }
}

export async function startBreak($: EngineInterface): Promise<boolean> {
  const clock = await read($, clockAtom)
  if (clock === null) {
    $.ui.toast('Nothing to keep warm yet: send a prompt first.')
    return false
  }
  if ((await read($, brkAtom)) !== null) return true
  const now = await $.clock.now()
  const lead = keepWarmLeadMs(rt.opts.keepWarmLeadSeconds, clock.ttlMs)
  const brk: BreakState = {
    since: now,
    refreshes: 0,
    spentUsd: 0,
    nextRefreshAt: Math.max(now, clock.warmUntil - lead),
    inFlight: false,
    lastReadTokens: 0,
  }
  await update($, brkAtom, () => brk)
  await update($, isBandHiddenAtom, () => false)
  $.ui.status('☕ on a break, keeping the cache warm')
  return true
}

export async function endBreak(
  $: EngineInterface,
  reason: 'button' | 'command' | 'prompt' | 'timeout' | 'error' | 'session-end' | 'reset',
): Promise<void> {
  const brk = await read($, brkAtom)
  if (brk === null) return
  await update($, brkAtom, () => null)
  $.ui.status(undefined)
  const totals = await readTotals($)
  await $.store.set(STORE_TOTALS, {
    breaks: totals.breaks + 1,
    refreshes: totals.refreshes + brk.refreshes,
    spentUsd: totals.spentUsd + brk.spentUsd,
  })
  if (reason === 'timeout') {
    $.ui.toast(`Break hit ${rt.opts.maxBreakHours}h: letting the cache cool now.`, { timeoutMs: 8000 })
  } else if (reason !== 'session-end' && reason !== 'error' && reason !== 'reset') {
    const ctx = await read($, contextAtom)
    const money = moneyText(brk.spentUsd, ctx?.isSubscription ?? false)
    $.ui.toast(
      `Back from the break: ${brk.refreshes} keep-warm ${brk.refreshes === 1 ? 'refresh' : 'refreshes'}${money === null ? '' : `, ≈ ${money}`}`,
    )
    play($, 'resume')
  }
}

/**
 * The conversation's prefix changed under the clock (a compaction, a /clear, a resume
 * into another session): the next request writes a new cache whatever the clock says,
 * so drop the clock until that response arrives.
 */
async function forgetCache($: EngineInterface, why: string): Promise<void> {
  if ((await read($, brkAtom)) !== null) {
    await endBreak($, 'reset')
    $.ui.toast(`${why}: the break ends, there is nothing cached to keep warm until the next response.`, {
      timeoutMs: 8000,
    })
  }
  await update($, clockAtom, () => null)
  await update($, contextAtom, () => null)
  await update($, lastZoneAtom, () => null)
  lastDisplayKey = ''
}

/** The context window, and whether rate limits were reported (a subscription). */
async function usageFacts($: EngineInterface): Promise<{ window: number; isSubscription: boolean }> {
  try {
    const u = await $.session.usage()
    return { window: u.context.window, isSubscription: u.rateLimits.length > 0 }
  } catch {
    return { window: 0, isSubscription: false }
  }
}

/** Runs once a second from the ticker while a break is on. */
export async function breakTick($: EngineInterface, now: number, clock: CacheClock): Promise<void> {
  const brk = await read($, brkAtom)
  if (brk === null) return
  if (now - brk.since > rt.opts.maxBreakHours * 3_600_000) {
    await endBreak($, 'timeout')
    return
  }
  if (rt.keepWarmInFlight || brk.inFlight) return
  const lead = keepWarmLeadMs(rt.opts.keepWarmLeadSeconds, clock.ttlMs)
  if (remainingMs(clock, now) > lead) return

  rt.keepWarmInFlight = true
  await update($, brkAtom, b => (b === null ? null : { ...b, inFlight: true }))
  const t0 = await $.clock.now()
  try {
    const r = await $.model.fork({ prompt: KEEP_WARM_PROMPT })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') {
      $.ui.toast('Nothing to keep warm: no response in this conversation yet.')
      await endBreak($, 'error')
      return
    }
    if (!r.isAnswered && r.reason === 'api-error') {
      $.ui.toast(`Keep-warm request failed (HTTP ${r.status}); ending the break.`, { timeoutMs: 8000 })
      await endBreak($, 'error')
      return
    }
    const usage = r.usage
    const ctx = await read($, contextAtom)
    const model = ctx?.model ?? (await $.session.model())
    const cost = keepWarmCost(usage, model, rt.opts.inputPriceOverrideUsdPerMTok, getPricingTable())
    const prev = await read($, clockAtom)
    const next = clockFor(t0, clock.ttl, prev?.ttlSource ?? clock.ttlSource)
    await update($, clockAtom, () => next)
    await update($, brkAtom, b =>
      b === null
        ? null
        : {
            ...b,
            inFlight: false,
            refreshes: b.refreshes + 1,
            spentUsd: b.spentUsd + cost,
            lastReadTokens: usage.cache_read_input_tokens,
            nextRefreshAt: next.warmUntil - lead,
          },
    )
    const hit = usage.cache_read_input_tokens > 0 ? 'cache hit' : 'CACHE MISS'
    $.ui.log(
      `keep-warm #${brk.refreshes + 1}: ${hit}, read ${usage.cache_read_input_tokens} / wrote ${usage.cache_creation_input_tokens} / out ${usage.output_tokens} tokens, ≈ ${formatUsd(cost)}`,
      { to: 'debug' },
    )
    if (usage.cache_read_input_tokens === 0) {
      $.ui.toast('Keep-warm request did not hit the cache (it re-cached instead).', { timeoutMs: 8000 })
    }
  } finally {
    rt.keepWarmInFlight = false
    await update($, brkAtom, b => (b === null ? null : { ...b, inFlight: false }))
  }
}

const COMMAND = 'cache-thermo'

const loadPricingOverride = async ($: EngineInterface): Promise<void> => {
  try {
    const text = await $.fs.read(`${$.plugin.root}/pricing.json`)
    if (typeof text === 'string' && setPricingTable(JSON.parse(text))) {
      $.ui.log(`pricing table from pricing.json (asOf ${getPricingTable().asOf})`, { to: 'debug' })
    }
  } catch {
    // the shipped table stands
  }
}

const announceZone = async ($: EngineInterface, zone: CacheZone, now: number): Promise<void> => {
  const last = await read($, lastZoneAtom)
  if (last === zone) return
  await update($, lastZoneAtom, () => zone)
  if (last === null || rt.isWorking) return
  const clock = await read($, clockAtom)
  const ctx = await read($, contextAtom)
  if (clock === null || ctx === null) return
  if (zone === 'warm' && last === 'hot') {
    $.ui.toast(`Ember is dozing off: the cache goes cold in ${formatClock(remainingMs(clock, now))}`, { timeoutMs: 6000 })
    play($, 'warm')
  } else if (zone === 'cold' && last !== 'cold') {
    const est = currentEstimate(ctx, clock)
    const money = moneyText(est.usd, ctx.isSubscription)
    $.ui.toast(
      `Brrr, the cache is cold. The next prompt re-caches ${money === null ? `${formatTokens(ctx.tokens)} tokens` : `≈ ${money}`}`,
      { timeoutMs: 10000 },
    )
    play($, 'cold')
  }
}

let lastDisplayKey = ''

const tick = async ($: EngineInterface): Promise<void> => {
  const clock = await read($, clockAtom)
  if (clock === null) return
  const now = await $.clock.now()
  const zone = zoneFor(clock, now, rt.opts.warnFraction, rt.isWorking)
  if (zone !== null) await announceZone($, zone, now)
  const hidden = await read($, isBandHiddenAtom)
  const brk = await read($, brkAtom)
  const gate = await read($, gateAtom)
  // The band changes by the minute above two minutes left and by the second below;
  // a break panel counts down to its next refresh the same way. Redraw only then.
  let key = displayKey(remainingMs(clock, now), zone ?? 'hot')
  if (brk !== null) key += `|b${displayKey(Math.max(0, brk.nextRefreshAt - now), 'r')}|${brk.inFlight ? 1 : 0}`
  if (gate !== null) key += '|g'
  if ((!hidden || brk !== null || gate !== null) && key !== lastDisplayKey) {
    lastDisplayKey = key
    await update($, nowAtom, () => now)
  }
  if (brk !== null) await breakTick($, now, clock)
}

export const register: Register = (on, options) => {
  rt.opts = readOptions(options)

  on('session.start', async ($, e, next) => {
    await loadPricingOverride($)
    await $.command.register({
      name: COMMAND,
      description: 'Prompt-cache thermometer: status, break, resume, hide, show, cold (debug)',
      argumentHint: '[break|resume|hide|show|cold]',
    })
    $.clock.every(1000, () => {
      void tick($).catch(err => $.ui.log(`tick failed: ${String(err)}`, { to: 'debug' }))
    })
    $.ui.log(`cache-thermo v${BUILD} ready: ttl ${rt.opts.cacheTtl}, prices asOf ${getPricingTable().asOf}`, {
      to: 'debug',
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) rt.isWorking = true
    return next(e)
  })

  // Every main-loop request refreshes the cache; the TTL counts from the request's start.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const requestStartedAt = await $.clock.now()
    for await (const chunk of next(e)) {
      if (chunk.kind === 'stop' && chunk.usage !== null) {
        const u = chunk.usage
        const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
        // Rate limits arrive with responses, so the auto TTL is decided here, not at session start.
        const facts = await usageFacts($)
        const { ttl, source } = resolveTtl(rt.opts.cacheTtl, facts.isSubscription)
        await update($, clockAtom, () => clockFor(requestStartedAt, ttl, source))
        await update($, contextAtom, () => ({ tokens, model: u.model || e.model, ...facts }))
      }
      yield chunk
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    rt.isWorking = false
    const clock = await read($, clockAtom)
    const now = await $.clock.now()
    // Fallback when no stop chunk reached us (a made-up response, an interrupted stream).
    if (e.usage !== undefined && (clock === null || clock.lastRequestStartedAt < now - e.durationMs - 1000)) {
      const u = e.usage
      const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      const facts = await usageFacts($)
      const { ttl, source } = resolveTtl(rt.opts.cacheTtl, facts.isSubscription)
      await update($, clockAtom, () => clockFor(now, ttl, source))
      await update($, contextAtom, () => ({ tokens, model: u.model, ...facts }))
    }
    await update($, nowAtom, () => now)
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    const name = String(e.command)
    $.ui.log(`cache-thermo: command.run /${name} ${e.args}`, { to: 'debug' })
    if (name !== COMMAND && !name.endsWith(`:${COMMAND}`)) return next(e)
    const arg = String(e.args ?? '').trim().toLowerCase()
    const now = await $.clock.now()
    switch (arg) {
      case 'break':
        return { text: (await startBreak($)) ? 'On a break: keeping the cache warm.' : 'Nothing to keep warm yet.' }
      case 'resume':
        await endBreak($, 'command')
        return { text: 'Back from the break.' }
      case 'hide':
        await update($, isBandHiddenAtom, () => true)
        return { text: 'Thermometer hidden. /cache-thermo show brings it back.' }
      case 'show':
        await update($, isBandHiddenAtom, () => false)
        return { text: 'Thermometer shown.' }
      case 'cold': {
        const clock = await read($, clockAtom)
        if (clock === null) return { text: 'No cache clock yet: send a prompt first.' }
        await update($, clockAtom, () => ({ ...clock, warmUntil: now }))
        const ctx = await read($, contextAtom)
        if (ctx === null) return { text: 'Debug: the cache is now marked cold.' }
        // Say what the next prompt will do: a small context passes the gate silently.
        const est = currentEstimate(ctx, clock)
        const usd = formatUsd(est.usd)
        const limit = formatUsd(rt.opts.gateThresholdUsd)
        return {
          text:
            est.usd >= rt.opts.gateThresholdUsd
              ? `Debug: the cache is now marked cold. Your next prompt re-caches ≈ ${usd} (${clock.ttl} TTL), at or over the ${limit} gate threshold, so the gate will hold it.`
              : `Debug: the cache is now marked cold, but re-caching ${formatTokens(ctx.tokens)} tokens costs only ≈ ${usd} (${clock.ttl} TTL), under the ${limit} gate threshold, so your next prompt goes straight through. Set "Gate threshold (USD)" to 0 in the plugin's settings to gate every cold prompt.`,
        }
      }
      default: {
        const clock = await read($, clockAtom)
        const ctx = await read($, contextAtom)
        if (clock === null || ctx === null) return { text: 'cache-thermo: no response yet, nothing cached to watch.' }
        const zone = zoneFor(clock, now, rt.opts.warnFraction, rt.isWorking) ?? 'hot'
        const est = currentEstimate(ctx, clock)
        const left = isCold(clock, now) ? 'cold' : `${formatClock(remainingMs(clock, now))} left`
        const money = moneyText(est.usd, ctx.isSubscription)
        const recache = money === null ? '' : ` · re-cache ≈ ${money}`
        return {
          text: `cache-thermo: ${ZONE_LABEL[zone]} · ${left} · ${formatTokens(ctx.tokens)} ctx on ${est.modelName}${recache} · TTL ${clock.ttl} (${clock.ttlSource}) · gate ≥ ${formatUsd(rt.opts.gateThresholdUsd)} · prices asOf ${getPricingTable().asOf}`,
        }
      }
    }
  }).catch(($, e, next) => (next.called ? next(e) : { text: `cache-thermo: the command failed: ${String(next.error)}` }))

  on('session.end', async ($, e, next) => {
    // A /clear or a resume goes on in this process under another conversation.
    if (e.reason === 'clear' || e.reason === 'resume') await forgetCache($, 'New conversation')
    else await endBreak($, 'session-end')
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || r.skip !== undefined) return r
    try {
      await forgetCache($, 'Conversation compacted')
    } catch (err) {
      $.ui.log(`forgetting the cache after compaction failed: ${String(err)}`, { to: 'debug' })
    }
    return r
  })


  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hidden = await read($, isBandHiddenAtom)
    const clock = await read($, clockAtom)
    const ctx = await read($, contextAtom)
    const gate = await read($, gateAtom)
    if (e.props.hasSurvey || clock === null || ctx === null || (hidden && gate === null)) return next(e)

    const tick = await read($, nowAtom)
    const now = tick > 0 ? tick : await $.clock.now()
    const zone = zoneFor(clock, now, rt.opts.warnFraction, e.props.isWorking) ?? 'hot'
    const brk = await read($, brkAtom)
    const fraction = e.props.isWorking ? 1 : remainingFraction(clock, now)
    const est = currentEstimate(ctx, clock)
    const color = zoneColor(zone)
    const ttlNote = clock.ttlSource === 'heuristic' ? `${clock.ttl} ttl, assumed` : `${clock.ttl} ttl`
    const unknown = est.pricing === 'unknown-model' ? ' · unknown model' : ''
    const timeText = zone === 'working'
        ? 'warming up'
        : formatLeft(remainingMs(clock, now))
    const status = `${ZONE_DOT[zone]} ${ZONE_LABEL[zone]} · ${timeText}`
    const money = moneyText(est.usd, ctx.isSubscription)
    const recache = money === null ? '' : ` · ~${money} to re-cache`
    const stats = `${formatTokens(ctx.tokens)} ctx${recache} · ${ttlNote}${unknown}`
    const breakLabel = '☕ break'
    const onBreak = () => {
      void startBreak($)
    }
    const onResume = () => {
      void endBreak($, 'button')
    }
    const onHide = () => update($, isBandHiddenAtom, () => true)

    // A held prompt takes the band over until the person picks: the gate is a band view, not a pane.
    if (gate !== null) {
      const g = gate
      const gMoney = moneyText(g.estimate.usd, ctx.isSubscription)
      const pct = ctx.window > 0 ? ` · ${Math.round((g.estimate.tokens / ctx.window) * 100)}% of window` : ''
      const headline =
        gMoney === null
          ? `❄ brrr, the cache went cold · re-caches ${formatTokens(g.estimate.tokens)} tokens`
          : `❄ brrr, the cache went cold · re-cache ≈ ${gMoney}`
      const detail = `${formatTokensLong(g.estimate.tokens)} tokens${pct} · idle ${formatAgo(g.lastRequestAgoMs)}, ${g.estimate.ttl} TTL lapsed`
      const pricing = gMoney === null ? 'your prompt waits here until you pick' : describePricing(g)
      const continueLabel = gMoney === null ? 'go ahead anyway' : `go ahead anyway · ${formatUsd(g.estimate.usd)}`
      const onContinue = () => {
        void resubmit($, g)
      }
      const onCancel = () => {
        void giveBack($, g)
      }
      const { Button } = $.ui.resolve(e)
      const buttons = [
        <Button key="continue" variant="primary" hotkey="c" onPress={onContinue}>
          {continueLabel}
        </Button>,
        <Button key="cancel" hotkey="x" onPress={onCancel}>
          keep my prompt
        </Button>,
      ]
      if (e.surface === 'desktop') {
        const { Box, Text, Svg } = $.ui.resolve(e)
        return (
          <Box
            key="cache-thermo-band"
            flexDirection="column"
            borderStyle="round"
            borderColor={THEME.cold}
            backgroundColor={THEME.panel}
            paddingX={1}
          >
            <Box gap={2} alignItems="center">
              <Svg source={frostbitSvg(44)} alt="Frostbit, the ice imp, shivering" width={44} height={44} isInteractive />
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Text bold color={THEME.cold} wrap="truncate-end">
                  {headline}
                </Text>
                <Text color={THEME.ink} wrap="truncate-end">
                  {detail}
                </Text>
                <Text color={THEME.dim} wrap="truncate-end">
                  {pricing}
                </Text>
              </Box>
            </Box>
            <Box gap={1} justifyContent="flex-end">
              {buttons}
            </Box>
          </Box>
        )
      }
      const { Box, Text } = $.ui.resolve(e)
      const sprite = FROSTBIT_ASCII[Math.floor(now / 1000) % 2] ?? FROSTBIT_ASCII[0] ?? []
      return (
        <Box borderStyle="round" borderColor={THEME.cold} paddingX={1} gap={1}>
          <Box flexDirection="column" width={asciiWidth(FROSTBIT_ASCII)}>
            {sprite.map(row => (
              <Text color={THEME.frost}>{row}</Text>
            ))}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <Text bold color={THEME.cold}>
              {headline}
            </Text>
            <Text>{detail}</Text>
            <Text color={THEME.dim}>{pricing}</Text>
            <Box gap={2}>{buttons}</Box>
          </Box>
        </Box>
      )
    }

    if (brk !== null) {
      const untilRefresh = Math.max(0, brk.nextRefreshAt - now)
      const line1 = brk.inFlight
        ? '☕ on a break · stoking the fire now…'
        : `☕ on a break · keeping the cache warm · next nudge in ${formatClock(untilRefresh)}`
      const spent = moneyText(brk.spentUsd, ctx.isSubscription)
      const line2 = `${brk.refreshes} ${brk.refreshes === 1 ? 'nudge' : 'nudges'}${spent === null ? '' : ` · ≈ ${spent} spent`} · away ${formatClock(now - brk.since)} · auto-stop after ${rt.opts.maxBreakHours}h`
      if (e.surface === 'desktop') {
        const { Box, Text, Button, Svg } = $.ui.resolve(e)
        return (
          <Box
            key="cache-thermo-band"
            borderStyle="round"
            borderColor={THEME.warm}
            borderDimColor
            backgroundColor={THEME.panel}
            paddingX={1}
            gap={2}
            alignItems="center"
          >
            <Svg source={campfireSvg(44)} alt="Ember tending a campfire" width={44} height={44} isInteractive />
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Text color={THEME.warm} wrap="truncate-end">
                {line1}
              </Text>
              <Text color={THEME.dim} wrap="truncate-end">
                {line2}
              </Text>
            </Box>
            <Button key="resume" variant="primary" hotkey="r" onPress={onResume}>
              I'm back
            </Button>
          </Box>
        )
      }
      const { Box, Text, Button } = $.ui.resolve(e)
      const frame = Math.floor(now / 1000) % 2
      const sprite = CAMPFIRE_ASCII[frame] ?? CAMPFIRE_ASCII[0] ?? []
      return (
        <Box borderStyle="round" borderColor={THEME.warm} borderDimColor paddingX={1} gap={1}>
          <Box flexDirection="column" width={asciiWidth(CAMPFIRE_ASCII)}>
            {sprite.map(row => (
              <Text color={THEME.ember}>{row}</Text>
            ))}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            <Text color={THEME.warm}>{line1}</Text>
            <Text color={THEME.dim}>{line2}</Text>
            <Box>
              <Button key="resume" variant="primary" hotkey="r" onPress={onResume}>
                I'm back
              </Button>
            </Box>
          </Box>
        </Box>
      )
    }

    if (e.surface === 'desktop') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)
      // The band is narrow on the desktop (roughly 5 px per cell): keep the tube to about a third.
      const widthPx = Math.round(Math.min(240, Math.max(140, e.props.bodyColumns * 1.8)))
      return (
        <Box
          key="cache-thermo-band"
          flexDirection="column"
          borderStyle="round"
          borderColor={color}
          borderDimColor
          backgroundColor={THEME.panel}
          paddingX={1}
        >
          <Box gap={2} alignItems="center">
            <Svg
              source={thermometerSvg({ fraction, zone, widthPx, heightPx: 32 })}
              alt={`Prompt cache thermometer: ${Math.round(fraction * 100)}% of the TTL left, ${ZONE_LABEL[zone]}`}
              width={widthPx}
              height={32}
              isInteractive
            />
            <Box flexGrow={1} flexShrink={1}>
              <Text color={color} wrap="truncate-end">
                {status}
              </Text>
            </Box>
          </Box>
          <Box gap={2} alignItems="center" justifyContent="space-between">
            <Box flexShrink={1}>
              <Text color={THEME.dim} wrap="truncate-end">
                {stats}
              </Text>
            </Box>
            <Box gap={1}>
              <Button key="break" hotkey="b" plain dimColor onPress={onBreak}>
                {breakLabel}
              </Button>
              <Button key="hide" hotkey="x" plain dimColor onPress={onHide}>
                hide
              </Button>
            </Box>
          </Box>
        </Box>
      )
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const frame = Math.floor(now / 1000) % 2
    const buddy = zone === 'cold' ? FROSTBIT_ASCII : EMBER_ASCII[zone]
    const sprite = buddy[frame] ?? buddy[0] ?? []
    const spriteColor = zone === 'cold' ? PALETTE.frost : PALETTE.ember
    const spriteW = BUDDY_W
    const barW = Math.max(8, Math.min(32, e.props.bodyColumns - spriteW - 48))
    const cells = bar(fraction * barW, barW)
    return (
      <Box borderStyle="round" borderColor={color} borderDimColor paddingX={1} gap={1}>
        <Box flexDirection="column" width={spriteW}>
          {sprite.map(row => (
            <Text color={spriteColor}>{row}</Text>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Box gap={1}>
            <Text color={color}>{cells.fill}</Text>
            <Text color={THEME.dim}>{cells.empty}</Text>
            <Text color={color}>{status}</Text>
          </Box>
          <Text color={THEME.dim}>{stats}</Text>
          <Box gap={2}>
            <Button key="break" hotkey="b" plain dimColor onPress={onBreak}>
              {breakLabel}
            </Button>
            <Button key="hide" hotkey="x" plain dimColor onPress={onHide}>
              hide
            </Button>
          </Box>
        </Box>
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'plugin' && e.origin.name === PLUGIN) return next(e)

    // Typing a prompt ends a break; the request itself refreshes the cache.
    if ((await read($, brkAtom)) !== null) await endBreak($, 'prompt')

    if (e.command !== undefined || e.isMeta || e.turnId !== undefined) return next(e)

    const clock = await read($, clockAtom)
    const ctx = await read($, contextAtom)
    const now = await $.clock.now()
    if (clock === null || ctx === null || !isCold(clock, now)) return next(e)

    const estimate = currentEstimate(ctx, clock)
    if (estimate.usd < rt.opts.gateThresholdUsd) return next(e)

    const money = moneyText(estimate.usd, ctx.isSubscription)
    const cost = money === null ? `${formatTokens(estimate.tokens)} tokens` : `≈ ${money}`
    if (e.attachments !== undefined && e.attachments.length > 0) {
      $.ui.toast(
        `Cold cache: this prompt re-caches ${cost} (not gated, it carries attachments)`,
        { timeoutMs: 8000 },
      )
      return next(e)
    }

    const pending: PendingGate = {
      text: e.text,
      estimate,
      lastRequestAgoMs: now - clock.lastRequestStartedAt,
    }
    await update($, gateAtom, () => pending)
    await update($, isBandHiddenAtom, () => false)
    play($, 'gate')
    return {
      drop: `cache-thermo: the prompt cache is cold (re-cache ${cost}). Choose "go ahead anyway" or "keep my prompt" in the band above the prompt.`,
    }
  }).catch(($, e, next) => next(e))
}
