import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, RenderElement, RenderInput } from 'claude-code'

import type { Advice, AdvisorMode, AdvisorStats, AdvisorView, Direction, Effort, Held, Reading, Setup } from '../types'
import {
  buildPrompt,
  decide,
  isEffort,
  parseReading,
  rubric,
  setupText,
  switchCommands,
  switchText,
  targetText,
  tierOf,
  typedText,
} from './advise'
import type { Mood } from './art'
import { COG_ASCII, COG_W, cogSvg } from './art'
import { readOptions } from './options'
import { rt } from './runtime'
import { COMPLEXITY_LABEL, DIRECTION_MARK, directionColor, THEME } from './theme'

const PLUGIN = 'model-advisor'
const BUILD = '0.1.0'
const COMMAND = 'model-advisor'
const STORE_STATS = 'stats'
const PANE = 'model-advisor'
const PANE_TITLE = 'Model advisor'
/** Body rows the pane asks for inline above the terminal prompt: Cog, three lines of advice, the buttons, stats. */
const PANE_ROWS = 8
/** How long the band above the prompt gets to draw advice before the pane opens in its place. */
const BAND_GRACE_MS = 700

const armedAtom = atom({ plugin: 'model-advisor', key: 'armed' } as const, false)
const viewAtom = atom({ plugin: 'model-advisor', key: 'view' } as const, 'idle')
const adviceAtom = atom({ plugin: 'model-advisor', key: 'advice' } as const, null)
const heldAtom = atom({ plugin: 'model-advisor', key: 'held' } as const, null)
const modeOverrideAtom = atom({ plugin: 'model-advisor', key: 'modeOverride' } as const, null)
const effortAtom = atom({ plugin: 'model-advisor', key: 'effort' } as const, null)
const frameAtom = atom({ plugin: 'model-advisor', key: 'frame' } as const, 0)
const statsAtom = atom({ plugin: 'model-advisor', key: 'stats' } as const, null)

const NO_STATS: AdvisorStats = { weighed: 0, fit: 0, down: 0, up: 0 }

async function currentMode($: EngineInterface): Promise<AdvisorMode> {
  return (await read($, modeOverrideAtom)) ?? rt.opts.mode
}

async function isArmed($: EngineInterface): Promise<boolean> {
  return rt.opts.trigger === 'every' || (await read($, armedAtom))
}

async function setView($: EngineInterface, view: AdvisorView): Promise<void> {
  if ((await read($, viewAtom)) !== view) await update($, viewAtom, () => view)
}

/** A new conversation: Cog weighs its first prompt. */
async function arm($: EngineInterface): Promise<void> {
  await update($, armedAtom, () => true)
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

async function loadStats($: EngineInterface): Promise<void> {
  const v = (await $.store.get(STORE_STATS)) as Partial<AdvisorStats> | undefined
  const stats: AdvisorStats = { weighed: count(v?.weighed), fit: count(v?.fit), down: count(v?.down), up: count(v?.up) }
  await update($, statsAtom, () => stats)
}

async function bumpStats($: EngineInterface, change: (s: AdvisorStats) => AdvisorStats): Promise<void> {
  const next = change((await read($, statsAtom)) ?? NO_STATS)
  await update($, statsAtom, () => next)
  await $.store.set(STORE_STATS, next)
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function statsText(stats: AdvisorStats | null): string | null {
  if (stats === null || stats.weighed === 0) return null
  return `${plural(stats.weighed, 'prompt', 'prompts')} weighed · ${plural(stats.down, 'shift', 'shifts')} down · ${plural(stats.up, 'shift', 'shifts')} up`
}

/** The effort CLAUDE_CODE_EFFORT_LEVEL names, which holds for the whole session: /effort cannot change it. */
async function pinnedEffort($: EngineInterface): Promise<Effort | null> {
  try {
    const env = await $.env.get('CLAUDE_CODE_EFFORT_LEVEL')
    return isEffort(env) ? env : null
  } catch (err) {
    $.ui.log(`reading the environment's effort failed: ${String(err)}`, { to: 'debug' })
    return null
  }
}

/**
 * The effort the session runs at when the environment names none: the main loop's last request (or what this
 * mod or a typed /effort set), else the saved default. Null when neither says.
 */
async function currentEffort($: EngineInterface): Promise<Effort | null> {
  const seen = await read($, effortAtom)
  if (seen !== null) return seen
  try {
    const saved = await $.settings.read({ key: 'effortLevel' })
    if (isEffort(saved)) return saved
  } catch (err) {
    $.ui.log(`reading the saved effort failed: ${String(err)}`, { to: 'debug' })
  }
  return null
}

async function currentSetup($: EngineInterface): Promise<Setup> {
  let model = ''
  try {
    model = await $.session.model()
  } catch (err) {
    $.ui.log(`reading the model failed: ${String(err)}`, { to: 'debug' })
  }
  const pinned = await pinnedEffort($)
  return {
    model,
    tier: tierOf(model, rt.opts.ladder),
    effort: pinned ?? (await currentEffort($)),
    isEffortPinned: pinned !== null,
  }
}

/** One read of the prompt by the advisor model; null when it failed or replied with something else. */
async function readPrompt($: EngineInterface, text: string): Promise<Reading | null> {
  try {
    const r = await $.model.complete({
      model: rt.opts.model,
      system: rubric(rt.opts.ladder),
      prompt: buildPrompt(text),
      maxTokens: 400,
      effort: 'low',
      timeoutMs: 12_000,
    })
    if (!r.isAnswered) {
      $.ui.log(`the advisor model gave no reply: ${r.reason}`, { to: 'debug' })
      return null
    }
    const reading = parseReading(r.text, rt.opts.ladder)
    if (reading === null) $.ui.log(`the advisor model's reply was not the JSON asked for: ${r.text.slice(0, 200)}`, { to: 'debug' })
    return reading
  } catch (err) {
    $.ui.log(`the advisor model call failed: ${String(err)}`, { to: 'debug' })
    return null
  }
}

type Outcome = { setup: Setup; advice: Advice | null }

/**
 * Weighs the prompt and settles everything but the prompt itself: the view, the advice, the stats, the arming.
 * Returns the setup and the advice (null: the setup fits), or null for a failed read or a prompt that is no work.
 */
async function weigh($: EngineInterface, text: string): Promise<Outcome | null> {
  rt.isReading = true
  await setView($, 'reading')
  $.ui.status('Cog is weighing your prompt…')
  try {
    const reading = await readPrompt($, text)
    if (reading === null) {
      // Fail open, and do not try again on every prompt while the model is unreachable.
      await update($, armedAtom, () => false)
      await setView($, 'idle')
      $.ui.toast('Cog could not weigh that prompt this time; it went through as typed.')
      return null
    }
    if (!reading.isWork) {
      // Greetings and follow-ups are not weighed: stay armed for the first real piece of work.
      await update($, armedAtom, () => true)
      await setView($, 'idle')
      return null
    }
    const setup = await currentSetup($)
    let isMidConversation = false
    try {
      isMidConversation = (await $.session.turns()) > 0
    } catch {
      // no transcript to count: treat it as a fresh conversation
    }
    const decided = decide(reading, setup, rt.opts.ladder, rt.opts.effortTolerance, isMidConversation)
    const advice = decided === null ? null : { ...decided, id: await $.clock.now() }
    await update($, adviceAtom, () => advice)
    await update($, armedAtom, () => false)
    await bumpStats($, s => ({ ...s, weighed: s.weighed + 1, fit: s.fit + (advice === null ? 1 : 0) }))
    return { setup, advice }
  } finally {
    rt.isReading = false
    $.ui.status(undefined)
  }
}

async function openPane($: EngineInterface): Promise<void> {
  try {
    await $.ui.open({ id: PANE, title: PANE_TITLE, rows: PANE_ROWS })
    rt.isPaneOpen = true
  } catch (err) {
    $.ui.log(`opening the pane failed: ${String(err)}`, { to: 'debug' })
  }
}

/** Closes the pane this mod opened in the band's place; one the person opened with /model-advisor open stays. */
async function closeStandIn($: EngineInterface): Promise<void> {
  if (!rt.isPaneOpen) return
  rt.isPaneOpen = false
  try {
    await $.ui.close({ id: PANE })
  } catch (err) {
    $.ui.log(`closing the pane failed: ${String(err)}`, { to: 'debug' })
  }
}

/**
 * Makes sure the person sees the advice. Only one mod draws the band above the prompt: a mod installed earlier
 * (cache-thermo's thermometer) keeps it, and the person can collapse it. When the band has not drawn this
 * advice after a moment, the pane opens with the same picture and the same buttons.
 */
function ensureShown($: EngineInterface, a: Advice): void {
  $.clock.after(BAND_GRACE_MS, () => {
    void (async () => {
      if (rt.bandShows === a.id || (await read($, viewAtom)) === 'idle') return
      if ((await read($, adviceAtom))?.id !== a.id) return
      await openPane($)
    })().catch(err => $.ui.log(`showing the advice failed: ${String(err)}`, { to: 'debug' }))
  })
}

/** The advice is settled (picked, dismissed, replaced): nothing shows it any more. */
async function settle($: EngineInterface): Promise<void> {
  await update($, heldAtom, () => null)
  await setView($, 'idle')
  await closeStandIn($)
}

/**
 * Runs /model and /effort for the advice, as if the person typed them.
 * Returns null once the session runs on the advised setup, else the command that did not take.
 */
async function applySwitch($: EngineInterface, a: Advice): Promise<string | null> {
  if (a.model !== null) {
    const command = `/model ${a.model}`
    try {
      const before = await $.session.model()
      await $.command.run({ command: 'model', args: a.model })
      const after = await $.session.model()
      if (after === before && tierOf(after, rt.opts.ladder) !== a.model) return command
    } catch (err) {
      $.ui.log(`${command} failed: ${String(err)}`, { to: 'debug' })
      return command
    }
  }
  if (a.effort !== null) {
    const level = a.effort
    const command = `/effort ${level}`
    try {
      await $.command.run({ command: 'effort', args: level })
      await update($, effortAtom, () => level)
    } catch (err) {
      $.ui.log(`${command} failed: ${String(err)}`, { to: 'debug' })
      return command
    }
  }
  return null
}

/** The switch, with a toast either way. True once the session runs on the advised setup. */
async function switchTo($: EngineInterface, a: Advice): Promise<boolean> {
  const failed = await applySwitch($, a)
  if (failed !== null) {
    $.ui.toast(`Cog could not run ${failed}. Type ${switchCommands(a).join(' and ')} yourself.`, { timeoutMs: 10_000 })
    return false
  }
  await bumpStats($, s => (a.direction === 'down' ? { ...s, down: s.down + 1 } : { ...s, up: s.up + 1 }))
  $.ui.toast(`Cog: now on ${targetText(a)}`)
  return true
}

/** "use …": the session switches to the advised setup, then the prompt goes as typed. */
async function switchAndSend($: EngineInterface, h: Held): Promise<void> {
  await settle($)
  if (await switchTo($, h.advice)) {
    void $.prompt.submit({ text: h.text, asUser: true })
    return
  }
  // The switch did not take: the prompt goes back to the prompt box rather than out on the old setup.
  await $.prompt.fill({ text: typedText(h.text) })
}

/** "send anyway": the prompt goes as typed, on the session's setup. */
async function sendAnyway($: EngineInterface, h: Held): Promise<void> {
  await settle($)
  void $.prompt.submit({ text: h.text, asUser: true })
}

/** "keep my prompt": the prompt goes back to the prompt box, nothing is sent. */
async function keepPrompt($: EngineInterface, h: Held): Promise<void> {
  await settle($)
  await $.prompt.fill({ text: typedText(h.text) })
}

/** A hint's "use … next": the session switches once it is idle; the prompt already went. */
async function switchForNext($: EngineInterface, a: Advice): Promise<void> {
  await settle($)
  await switchTo($, a)
}

/**
 * Runs `work` once the hook that called this has ended. A command's hook cannot submit a prompt or run a slash
 * command itself: both wait for the command to end, and the command waits for its hook.
 */
function afterHook($: EngineInterface, what: string, work: () => Promise<void>): void {
  $.clock.after(1, () => {
    void work().catch(err => $.ui.log(`${what} failed: ${String(err)}`, { to: 'debug' }))
  })
}

/** Whether gate mode holds a prompt for this advice, or shows it as a hint. */
const holds = (d: Direction): boolean => rt.opts.gateOn === 'both' || rt.opts.gateOn === d

/** Whether a surface draws for this session; true when the session cannot say. */
async function hasSurface($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).length > 0
  } catch {
    return true
  }
}

/** A prompt the person wrote: typed, sent from a phone or an SDK host, or resubmitted for them by another mod. */
function isPersons(origin: PromptOrigin): boolean {
  switch (origin.kind) {
    case 'task-notification':
    case 'scheduled-trigger':
    case 'peer':
      return false
    case 'plugin':
      return origin.name !== PLUGIN && origin.asUser === true
    default:
      return true
  }
}

/** The band's three lines for advice: what to do, why, and where the session stands. */
function lines(a: Advice, isHeld: boolean): { headline: string; reason: string; foot: string } {
  const work = `${COMPLEXITY_LABEL[a.reading.complexity]} work`
  const headline =
    a.direction === 'down'
      ? `${DIRECTION_MARK.down} shift down · ${work} fits ${targetText(a)}`
      : `${DIRECTION_MARK.up} shift up · ${work} needs ${targetText(a)}`
  const waits = isHeld ? 'your prompt waits for your pick' : 'your prompt went on this setup'
  const recache = a.model !== null && a.isMidConversation ? ' · a model switch re-caches this conversation' : ''
  return {
    headline,
    reason: a.reading.reason || a.reading.headline || 'A different setup fits this prompt better.',
    foot: `now on ${setupText(a.setup)} · ${waits}${recache}`,
  }
}

const adviceToast = (a: Advice): string =>
  a.direction === 'down'
    ? `Cog: ${targetText(a)} is enough for this (you are on ${setupText(a.setup)})`
    : `Cog: this needs ${targetText(a)} (you are on ${setupText(a.setup)})`

async function armNext($: EngineInterface): Promise<void> {
  await arm($)
  $.ui.toast('Cog will weigh your next prompt.')
}

type Site = RenderInput<'AbovePrompt' | 'Pane'>

/** Cog beside a few lines of text, with buttons under them: the one picture the band and the pane both draw. */
type Card = {
  mood: Mood
  alt: string
  accent: string
  title: string
  /** The line under the title, in ink; wraps. */
  body: string | null
  /** The last line, dim; wraps. */
  foot: string | null
  buttons: RenderElement[]
  /** The band draws a round border; the pane has a frame of its own. */
  isFramed: boolean
  /** A quiet card (the read in progress) dims its border. */
  isQuiet: boolean
  frame: 0 | 1
}

function drawCard($: EngineInterface, e: Site, c: Card) {
  const border = c.isFramed ? ({ borderStyle: 'round', borderColor: c.accent, borderDimColor: c.isQuiet } as const) : {}
  // Desktop and the VS Code extension draw the SVG pixel art; the terminal draws the ASCII frames.
  if (e.surface === 'desktop' || e.surface === 'vscode') {
    const { Box, Text, Svg } = $.ui.resolve(e)
    return (
      <Box key="model-advisor-card" flexDirection="column" {...border} backgroundColor={THEME.panel} paddingX={1}>
        <Box gap={2} alignItems="center">
          <Svg source={cogSvg(c.mood, 44)} alt={c.alt} width={44} height={44} isInteractive />
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text bold={!c.isQuiet} color={c.accent} wrap="truncate-end">
              {c.title}
            </Text>
            {c.body === null ? null : <Text color={THEME.ink}>{c.body}</Text>}
            {c.foot === null ? null : <Text color={THEME.dim}>{c.foot}</Text>}
          </Box>
        </Box>
        {c.buttons.length === 0 ? null : (
          <Box gap={1} justifyContent="flex-end" flexWrap="wrap">
            {c.buttons}
          </Box>
        )}
      </Box>
    )
  }
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box {...border} paddingX={1} gap={1}>
      <Box flexDirection="column" width={COG_W} flexShrink={0}>
        {COG_ASCII[c.mood][c.frame].map(row => (
          <Text color={THEME.cog}>{row}</Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text bold={!c.isQuiet} color={c.accent}>
          {c.title}
        </Text>
        {c.body === null ? null : <Text>{c.body}</Text>}
        {c.foot === null ? null : <Text color={THEME.dim}>{c.foot}</Text>}
        {c.buttons.length === 0 ? null : (
          <Box gap={2} flexWrap="wrap">
            {c.buttons}
          </Box>
        )}
      </Box>
    </Box>
  )
}

/** What a site shows now: the read in progress, a held prompt, a hint, or nothing (null). */
async function currentCard($: EngineInterface, e: Site, isFramed: boolean): Promise<{ card: Card; advice: Advice | null } | null> {
  const view = await read($, viewAtom)
  const held = await read($, heldAtom)
  const advice = await read($, adviceAtom)
  const frame = (await read($, frameAtom)) === 0 ? 0 : 1
  if (view === 'reading') {
    return {
      advice: null,
      card: {
        mood: 'reading',
        alt: 'Cog the robot, weighing your prompt',
        accent: THEME.reading,
        title: 'Cog is weighing your prompt…',
        body: null,
        foot: 'which model and effort does this work need?',
        buttons: [],
        isFramed,
        isQuiet: true,
        frame,
      },
    }
  }
  // A held prompt keeps its place until the person picks; a hint stays until the next prompt.
  const a: Advice | null = view === 'held' ? (held?.advice ?? null) : view === 'hint' ? advice : null
  if (a === null) return null
  const pick = view === 'held' ? held : null
  const { headline, reason, foot } = lines(a, pick !== null)
  const { Button } = $.ui.resolve(e)
  const buttons =
    pick !== null
      ? [
          <Button key="switch" variant="primary" hotkey="s" onPress={() => void switchAndSend($, pick)}>
            {`use ${switchText(a)}`}
          </Button>,
          <Button key="send" hotkey="a" onPress={() => void sendAnyway($, pick)}>
            send anyway
          </Button>,
          <Button key="keep" hotkey="x" onPress={() => void keepPrompt($, pick)}>
            keep my prompt
          </Button>,
        ]
      : [
          <Button key="switch" variant="primary" hotkey="s" onPress={() => void switchForNext($, a)}>
            {`use ${switchText(a)} next`}
          </Button>,
          <Button key="dismiss" hotkey="x" plain dimColor onPress={() => void settle($)}>
            dismiss
          </Button>,
        ]
  return {
    advice: a,
    card: {
      mood: a.direction,
      alt: a.direction === 'down' ? 'Cog the robot, pointing down' : 'Cog the robot, pointing up',
      accent: directionColor(a.direction),
      title: headline,
      body: reason,
      foot,
      buttons,
      isFramed,
      isQuiet: false,
      frame,
    },
  }
}


export const register: Register = (on, options) => {
  rt.opts = readOptions(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Cog the model advisor: status, next, open, switch, send, keep, mode gate|hints|off',
      argumentHint: '[next|open|switch|send|keep|mode gate|mode hints|mode off]',
    })
    try {
      await loadStats($)
    } catch (err) {
      $.ui.log(`reading the stats failed: ${String(err)}`, { to: 'debug' })
    }
    // A fresh conversation arms Cog; a resumed one (or a hot reload mid-conversation) does not.
    let isFresh = true
    try {
      isFresh = (await $.session.messages()).length === 0
    } catch {
      // no transcript to read: treat it as fresh
    }
    if (isFresh) await arm($)
    // The terminal's art has two frames: flip between them while the band shows.
    $.clock.every(1000, () => {
      void (async () => {
        if ((await read($, viewAtom)) !== 'idle') await update($, frameAtom, f => (f === 0 ? 1 : 0))
      })().catch(err => $.ui.log(`tick failed: ${String(err)}`, { to: 'debug' }))
    })
    $.ui.log(
      `model-advisor v${BUILD} ready: ${rt.opts.mode}, ${rt.opts.trigger}, advisor ${rt.opts.model}, ladder ${rt.opts.ladder.join(' < ')}`,
      { to: 'debug' },
    )
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // The conversation a /clear starts has state of its own: its first prompt arms Cog there.
    if (e.reason === 'clear') rt.isCleared = true
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || r.skip !== undefined) return r
    try {
      await arm($)
    } catch (err) {
      $.ui.log(`arming after compaction failed: ${String(err)}`, { to: 'debug' })
    }
    return r
  })

  // Every main-loop request says which effort the session runs at.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && isEffort(e.effort)) {
      const level = e.effort
      if ((await read($, effortAtom)) !== level) await update($, effortAtom, () => level)
    }
    return yield* next(e)
  })

  // A typed /effort changes the effort before the next request shows it.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const level = String(e.args ?? '').trim().toLowerCase()
    await update($, effortAtom, () => (isEffort(level) ? level : null))
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', async ($, e, next) => {
    const name = String(e.command)
    if (name !== COMMAND && !name.endsWith(`:${COMMAND}`)) return next(e)
    const args = String(e.args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    const held = await read($, heldAtom)
    switch (args[0]) {
      case 'next':
        await arm($)
        return { text: 'Cog will weigh your next prompt.' }
      case 'open':
        await openPane($)
        // The person asked for it: it stays open after a pick.
        rt.isPaneOpen = false
        return { text: 'Model advisor pane opened.' }
      case 'switch': {
        if (held !== null) {
          afterHook($, 'the switch', () => switchAndSend($, held))
          return { text: `Switching to ${targetText(held.advice)}, then sending your prompt.` }
        }
        const advice = await read($, adviceAtom)
        if (advice === null || (await read($, viewAtom)) !== 'hint') return { text: 'No advice is waiting.' }
        afterHook($, 'the switch', () => switchForNext($, advice))
        return { text: `Switching to ${targetText(advice)}.` }
      }
      case 'send':
        if (held === null) return { text: 'No prompt is waiting.' }
        afterHook($, 'sending the prompt', () => sendAnyway($, held))
        return { text: `Sending your prompt on ${setupText(held.advice.setup)}.` }
      case 'keep':
        if (held === null) return { text: 'No prompt is waiting.' }
        await keepPrompt($, held)
        return { text: 'Your prompt is back in the prompt box.' }
      case 'mode': {
        const m = args[1]
        if (m !== 'gate' && m !== 'hints' && m !== 'off') return { text: 'Usage: /model-advisor mode gate|hints|off' }
        await update($, modeOverrideAtom, () => m)
        const said = {
          gate: 'Gate mode for this session: a prompt that fits another model or effort waits in the band until you pick.',
          hints: 'Hints mode for this session: prompts go at once, the band shows the advice for the next prompt.',
          off: 'Cog is off for this session. /model-advisor mode gate brings it back.',
        } as const
        return { text: said[m] }
      }
      default: {
        const mode = await currentMode($)
        const armed = await isArmed($)
        const setup = await currentSetup($)
        const stats = statsText(await read($, statsAtom))
        const waiting = held === null ? '' : ` · a prompt waits: ${targetText(held.advice)} is advised (/model-advisor switch|send|keep)`
        return {
          text: `model-advisor: ${mode} mode · ${armed ? 'weighing the next prompt' : 'waiting for the next conversation (/model-advisor next to weigh the next prompt)'} · now on ${setupText(setup)} · advisor ${rt.opts.model} · ladder ${rt.opts.ladder.join(' < ')}${stats === null ? '' : ` · ${stats}`}${waiting}`,
        }
      }
    }
  }).catch(($, e, next) => (next.called ? next(e) : { text: `model-advisor: the command failed: ${String(next.error)}` }))

  on('prompt.submit', async ($, e, next) => {
    // The plugin's own resubmits ("use …", "send anyway") do not reach this hook.
    if (e.command !== undefined || e.isMeta || e.turnId !== undefined || !isPersons(e.origin)) return next(e)
    if (rt.isCleared) {
      rt.isCleared = false
      await arm($)
    }
    // A new prompt instead of a pick replaces the held one: weigh it afresh. It also ends a hint.
    if ((await read($, heldAtom)) !== null) await update($, armedAtom, () => true)
    if (!rt.isReading) await settle($)

    const mode = await currentMode($)
    if (mode === 'off' || rt.isReading || !(await isArmed($))) return next(e)
    if (typedText(e.text).trim().length < rt.opts.minChars) return next(e)
    // A run that draws nothing (claude -p, an SDK host with no surface) has no band to pick in: never hold it.
    if (!(await hasSurface($))) return next(e)

    // A resubmit cannot carry attachments, so a prompt with them is never held: it gets a hint.
    const hasAttachments = e.attachments !== undefined && e.attachments.length > 0
    if (mode === 'hints' || hasAttachments) {
      // The prompt goes now; Cog's advice lands in the band while Claude works.
      await update($, armedAtom, () => false)
      void weigh($, e.text)
        .then(async o => {
          // A prompt that turns out to be no work leaves Cog armed for the next one.
          if (o === null) return
          if (o.advice === null) {
            await setView($, 'idle')
            $.ui.toast(`Cog: ${setupText(o.setup)} fits this prompt ✓`)
          } else {
            await setView($, 'hint')
            $.ui.toast(adviceToast(o.advice), { timeoutMs: 8000 })
            ensureShown($, o.advice)
          }
        })
        .catch(err => $.ui.log(`weighing failed: ${String(err)}`, { to: 'debug' }))
      return next(e)
    }

    const o = await weigh($, e.text)
    if (o === null) return next(e)
    if (o.advice === null) {
      await setView($, 'idle')
      $.ui.toast(`Cog: ${setupText(o.setup)} fits this prompt ✓`)
      return next(e)
    }
    if (!holds(o.advice.direction)) {
      await setView($, 'hint')
      $.ui.toast(adviceToast(o.advice), { timeoutMs: 8000 })
      ensureShown($, o.advice)
      return next(e)
    }
    const held: Held = { text: e.text, advice: o.advice }
    await update($, heldAtom, () => held)
    await setView($, 'held')
    ensureShown($, o.advice)
    const verdict =
      o.advice.direction === 'down'
        ? `${targetText(o.advice)} is enough for this prompt`
        : `this prompt needs ${targetText(o.advice)}`
    return {
      drop: `model-advisor: ${verdict} (you are on ${setupText(o.setup)}). Pick "use ${switchText(o.advice)}", "send anyway" or "keep my prompt" above the prompt, or run /model-advisor switch, send or keep.`,
    }
  }).catch(($, e, next) => (next.called ? { text: e.text } : next(e)))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const shown = await currentCard($, e, true)
    if (shown === null) return next(e)
    // The band is on screen with this advice: the pane has no need to open in its place.
    if (shown.advice !== null && !e.props.isCollapsed) rt.bandShows = shown.advice.id
    return drawCard($, e, shown.card)
  })

  // The band's stand-in (see ensureShown), and what /model-advisor open shows.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const shown = await currentCard($, e, false)
    if (shown !== null) return drawCard($, e, shown.card)
    const stats = statsText(await read($, statsAtom))
    const { Button } = $.ui.resolve(e)
    return drawCard($, e, {
      mood: 'idle',
      alt: 'Cog the robot, waiting for your next prompt',
      accent: THEME.cog,
      title: "Beep! I'm Cog, your model advisor.",
      body: `I find the lowest model and effort that will do your work well. ${
        rt.opts.trigger === 'every'
          ? 'I weigh every prompt you send while Claude is idle.'
          : 'I weigh the first prompt of each conversation, and the next one when you ask.'
      }`,
      foot: `ladder ${rt.opts.ladder.join(' < ')}${stats === null ? '' : ` · ${stats}`}`,
      buttons: [
        <Button key="next" hotkey="n" plain dimColor onPress={() => void armNext($)}>
          weigh my next prompt
        </Button>,
      ],
      isFramed: false,
      isQuiet: true,
      frame: (await read($, frameAtom)) === 0 ? 0 : 1,
    })
  })
}
