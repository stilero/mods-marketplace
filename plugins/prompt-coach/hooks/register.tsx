import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Analysis, CoachMode, CoachStats, CoachView, CriterionKey, Held, Score } from '../types'
import { buildPrompt, coverage, askingText, isWeak, missingParts, parseAnalysis, RUBRIC, scaffold, score, typedText } from './analyze'
import type { Mood } from './art'
import { QUILL_ASCII, QUILL_W, quillSvg } from './art'
import { readOptions } from './options'
import { rt } from './runtime'
import { BLURB, CRITERIA, LABEL, STATUS_DOT, statusColor, THEME } from './theme'

const BUILD = '0.1.4'
const PANE = 'prompt-coach'
const PANE_TITLE = 'Prompt coach'
const COMMAND = 'prompt-coach'
const STORE_STATS = 'stats'
const RECENT = 10

const armedAtom = atom({ plugin: 'prompt-coach', key: 'armed' } as const, false)
const viewAtom = atom({ plugin: 'prompt-coach', key: 'view' } as const, 'idle')
const analysisAtom = atom({ plugin: 'prompt-coach', key: 'analysis' } as const, null)
const heldAtom = atom({ plugin: 'prompt-coach', key: 'held' } as const, null)
const beforeAtom = atom({ plugin: 'prompt-coach', key: 'before' } as const, null)
const modeOverrideAtom = atom({ plugin: 'prompt-coach', key: 'modeOverride' } as const, null)
const statsAtom = atom({ plugin: 'prompt-coach', key: 'stats' } as const, null)

async function currentMode($: EngineInterface): Promise<CoachMode> {
  return (await read($, modeOverrideAtom)) ?? rt.opts.mode
}

async function isArmed($: EngineInterface): Promise<boolean> {
  return rt.opts.trigger === 'every' || (await read($, armedAtom))
}

async function setView($: EngineInterface, view: CoachView): Promise<void> {
  if ((await read($, viewAtom)) !== view) await update($, viewAtom, () => view)
}

/** Body rows the pane asks for inline above the terminal prompt: header, buttons, five parts, stats. */
const PANE_ROWS = 18

async function openPane($: EngineInterface): Promise<void> {
  try {
    await $.ui.open({ id: PANE, title: PANE_TITLE, rows: PANE_ROWS })
  } catch (err) {
    $.ui.log(`opening the pane failed: ${String(err)}`, { to: 'debug' })
  }
}

/** A new conversation: Quill reads its first task prompt. */
async function arm($: EngineInterface): Promise<void> {
  await update($, armedAtom, () => true)
}

async function loadStats($: EngineInterface): Promise<void> {
  const v = (await $.store.get(STORE_STATS)) as Partial<CoachStats> | undefined
  const stats: CoachStats = {
    checked: typeof v?.checked === 'number' ? v.checked : 0,
    recent: Array.isArray(v?.recent) ? v.recent.filter(n => typeof n === 'number').slice(-RECENT) : [],
  }
  await update($, statsAtom, () => stats)
}

/** Counts a coached brief; an improved re-read replaces its brief's entry instead of adding one. */
async function recordStats($: EngineInterface, s: Score, isReRead: boolean): Promise<void> {
  const prev = (await read($, statsAtom)) ?? { checked: 0, recent: [] }
  const next: CoachStats =
    isReRead && prev.recent.length > 0
      ? { checked: prev.checked, recent: [...prev.recent.slice(0, -1), coverage(s)] }
      : { checked: prev.checked + 1, recent: [...prev.recent, coverage(s)].slice(-RECENT) }
  await update($, statsAtom, () => next)
  await $.store.set(STORE_STATS, next)
}

/** One read of the prompt by the coach model; null when it failed or replied with something else. */
async function analyze($: EngineInterface, text: string): Promise<Analysis | null> {
  try {
    const r = await $.model.complete({
      model: rt.opts.model,
      system: RUBRIC,
      prompt: buildPrompt(text),
      maxTokens: 900,
      effort: 'low',
      timeoutMs: 15_000,
    })
    if (!r.isAnswered) {
      $.ui.log(`the coach model gave no reply: ${r.reason}`, { to: 'debug' })
      return null
    }
    const a = parseAnalysis(r.text)
    if (a === null) $.ui.log(`the coach model's reply was not the JSON asked for: ${r.text.slice(0, 200)}`, { to: 'debug' })
    return a
  } catch (err) {
    $.ui.log(`the coach model call failed: ${String(err)}`, { to: 'debug' })
    return null
  }
}

/**
 * Reads the prompt and settles everything but the prompt itself: the view, the analysis, the stats, the arming.
 * Returns the analysis of a task prompt, or null for a failed read or a prompt that is not a task.
 */
async function coach($: EngineInterface, text: string): Promise<Analysis | null> {
  rt.isReading = true
  const prevView = await read($, viewAtom)
  const wasImproving = prevView === 'improving'
  await setView($, 'reading')
  $.ui.status('Quill is reading your prompt…')
  try {
    const a = await analyze($, text)
    if (a === null) {
      // Fail open, and do not try again on every prompt while the model is unreachable.
      await update($, armedAtom, () => false)
      await setView($, prevView === 'reading' ? 'idle' : prevView)
      $.ui.toast('Quill could not read that prompt this time; it went through as typed.')
      return null
    }
    if (!a.isTask) {
      // Questions and follow-ups are not coached: stay armed for the first real task.
      await update($, armedAtom, () => true)
      await setView($, prevView === 'reading' ? 'idle' : prevView)
      return null
    }
    const s = score(a)
    if (!wasImproving) await update($, beforeAtom, () => null)
    await update($, analysisAtom, () => a)
    await recordStats($, s, wasImproving)
    await update($, armedAtom, () => false)
    return a
  } finally {
    rt.isReading = false
    $.ui.status(undefined)
  }
}

/** "improve it": the prompt goes back to the composer with a heading and a question per missing part. */
async function improve($: EngineInterface, h: Held): Promise<void> {
  await update($, heldAtom, () => null)
  await update($, beforeAtom, () => score(h.analysis))
  await update($, armedAtom, () => true)
  await setView($, 'improving')
  await $.prompt.fill({ text: scaffold(h.text, h.analysis) })
}

/** "send anyway": the prompt goes as typed; the checklist stays as a hint for next time. */
async function sendAnyway($: EngineInterface, h: Held): Promise<void> {
  await update($, heldAtom, () => null)
  await setView($, 'hint')
  void $.prompt.submit({ text: h.text, asUser: true })
}

/** "let Claude ask": the prompt goes with a line asking Claude to ask about the missing parts first. */
async function sendAsking($: EngineInterface, h: Held): Promise<void> {
  await update($, heldAtom, () => null)
  await setView($, 'asking')
  void $.prompt.submit({ text: askingText(h.text, h.analysis), asUser: true })
}

async function armNext($: EngineInterface): Promise<void> {
  await arm($)
  $.ui.toast('Quill will read your next prompt.')
}

const scoreText = (s: Score): string => `${s.present} of ${s.applicable} ${s.applicable === 1 ? 'part' : 'parts'} that apply`

function statsText(stats: CoachStats | null): string | null {
  if (stats === null || stats.recent.length === 0) return null
  const avg = Math.round((stats.recent.reduce((a, b) => a + b, 0) / stats.recent.length) * 100)
  return `last ${stats.recent.length} ${stats.recent.length === 1 ? 'brief' : 'briefs'}: ${avg}% covered · ${stats.checked} coached`
}

const MOOD: Record<CoachView, Mood> = {
  idle: 'idle',
  reading: 'reading',
  hint: 'hmm',
  passed: 'happy',
  held: 'hmm',
  improving: 'idle',
  asking: 'idle',
}

const ACCENT: Record<CoachView, string> = {
  idle: THEME.owl,
  reading: THEME.reading,
  hint: THEME.reading,
  passed: THEME.present,
  held: THEME.missing,
  improving: THEME.reading,
  asking: THEME.reading,
}

/** The pane's first two lines for a view. */
function heading(view: CoachView, a: Analysis | null, before: Score | null): { title: string; sub: string } {
  if (a === null || view === 'idle') {
    return {
      title: "Hoo! I'm Quill. A good brief has five parts:",
      sub:
        rt.opts.trigger === 'every'
          ? 'I read every task prompt you send while Claude is idle.'
          : 'I read the first task prompt of each conversation, and the next one when you ask.',
    }
  }
  if (view === 'reading') return { title: 'reading your prompt…', sub: 'one moment' }
  const s = score(a)
  const delta = before === null ? '' : ` · ${before.present}/${before.applicable} → ${s.present}/${s.applicable}`
  const missing = missingParts(a).map(k => LABEL[k])
  switch (view) {
    case 'held':
      return { title: a.headline || 'Your brief leaves something out', sub: `your prompt is waiting · ${scoreText(s)}${delta}` }
    case 'passed':
      return { title: a.headline || 'Nice brief', sub: `nice brief ✓ · ${scoreText(s)}${delta}` }
    case 'improving':
      return {
        title: 'Answer the questions in the prompt box, then send',
        sub: "replace each <question?> with your answer; I'll read it again",
      }
    case 'asking':
      return { title: `Sent: Claude will ask you about ${missing.join(', ')}`, sub: scoreText(s) }
    default:
      return { title: a.headline || 'Notes for your next brief', sub: `for next time · ${scoreText(s)}${delta}` }
  }
}

type Row = { key: CriterionKey; dot: string; color: string; label: string; text: string }

function rows(view: CoachView, a: Analysis | null): Row[] {
  if (a === null || view === 'idle' || view === 'reading') {
    return CRITERIA.map(k => ({ key: k, dot: '·', color: THEME.owl, label: LABEL[k], text: BLURB[k] }))
  }
  return CRITERIA.map(k => {
    const c = a.criteria[k]
    const text = c.status === 'missing' ? c.ask || c.note : c.note
    return { key: k, dot: STATUS_DOT[c.status], color: statusColor(c.status), label: LABEL[k], text: text || BLURB[k] }
  })
}

export const register: Register = (on, options) => {
  rt.opts = readOptions(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Quill the prompt coach: status, next, open, mode gate|hints|off',
      argumentHint: '[next|open|mode gate|mode hints|mode off]',
    })
    try {
      await loadStats($)
    } catch (err) {
      $.ui.log(`reading the stats failed: ${String(err)}`, { to: 'debug' })
    }
    // A fresh conversation arms Quill; a resumed one (or a hot reload mid-conversation) does not.
    let isFresh = true
    try {
      isFresh = (await $.session.messages()).length === 0
    } catch {
      // no transcript to read: treat it as fresh
    }
    if (isFresh) await arm($)
    $.ui.log(`prompt-coach v${BUILD} ready: ${rt.opts.mode}, ${rt.opts.trigger}, model ${rt.opts.model}`, { to: 'debug' })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // The conversation a /clear starts has state of its own: its first prompt arms Quill there.
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

  on('command.run', async ($, e, next) => {
    const name = String(e.command)
    if (name !== COMMAND && !name.endsWith(`:${COMMAND}`)) return next(e)
    const args = String(e.args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    switch (args[0]) {
      case 'next':
        await arm($)
        return { text: 'Quill will read your next prompt.' }
      case 'open':
        await openPane($)
        return { text: 'Prompt coach pane opened.' }
      case 'mode': {
        const m = args[1]
        if (m !== 'gate' && m !== 'hints' && m !== 'off') return { text: 'Usage: /prompt-coach mode gate|hints|off' }
        await update($, modeOverrideAtom, () => m)
        const said = {
          gate: 'Gate mode for this session: a brief that leaves out a part waits in the pane until you pick.',
          hints: 'Hints mode for this session: prompts go at once, the pane shows what to add next time.',
          off: 'Quill is off for this session. /prompt-coach mode hints brings it back.',
        } as const
        return { text: said[m] }
      }
      default: {
        const mode = await currentMode($)
        const armed = await isArmed($)
        const stats = statsText(await read($, statsAtom))
        return {
          text: `prompt-coach: ${mode} mode · ${armed ? 'reading the next task prompt' : 'waiting for the next conversation (/prompt-coach next to read the next prompt)'} · model ${rt.opts.model}${stats === null ? '' : ` · ${stats}`}`,
        }
      }
    }
  }).catch(($, e, next) => (next.called ? next(e) : { text: `prompt-coach: the command failed: ${String(next.error)}` }))

  on('prompt.submit', async ($, e, next) => {
    // The plugin's own resubmits ("send anyway", "let Claude ask") do not reach this hook.
    if (e.command !== undefined || e.isMeta || e.turnId !== undefined) return next(e)
    if (rt.isCleared) {
      rt.isCleared = false
      await arm($)
    }
    // A new prompt instead of a pick is the brief rewritten by hand: read it again, as after "improve it".
    const prevHeld = await read($, heldAtom)
    if (prevHeld !== null) {
      await update($, heldAtom, () => null)
      await update($, beforeAtom, () => score(prevHeld.analysis))
      await update($, armedAtom, () => true)
      await setView($, 'improving')
    }
    const mode = await currentMode($)
    if (mode === 'off' || rt.isReading || !(await isArmed($))) return next(e)
    if (typedText(e.text).trim().length < rt.opts.minChars) return next(e)

    if (mode === 'hints') {
      // The prompt goes now; Quill's notes land in the pane while Claude works.
      await update($, armedAtom, () => false)
      void coach($, e.text)
        .then(async a => {
          // A prompt that turns out not to be a task leaves Quill armed for the next one.
          if (a === null) return
          if (isWeak(a)) {
            await setView($, 'hint')
            await openPane($)
          } else {
            await setView($, 'passed')
            $.ui.toast(`Quill: nice brief ✓ (${scoreText(score(a))})`)
          }
        })
        .catch(err => $.ui.log(`coaching failed: ${String(err)}`, { to: 'debug' }))
      return next(e)
    }

    const a = await coach($, e.text)
    if (a === null) return next(e)
    if (!isWeak(a)) {
      await setView($, 'passed')
      $.ui.toast(`Quill: nice brief ✓ (${scoreText(score(a))})`)
      return next(e)
    }
    const held: Held = { text: e.text, analysis: a }
    await update($, heldAtom, () => held)
    await setView($, 'held')
    await openPane($)
    const missing = missingParts(a).map(k => LABEL[k]).join(', ')
    return {
      drop: `prompt-coach: your brief leaves out ${missing}. Pick "improve it", "send anyway" or "let Claude ask" in the Prompt coach pane.`,
    }
  }).catch(($, e, next) => (next.called ? { text: e.text } : next(e)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await read($, viewAtom)
    const a = await read($, analysisAtom)
    const held = await read($, heldAtom)
    const before = await read($, beforeAtom)
    const stats = statsText(await read($, statsAtom))
    const shown: CoachView = view === 'held' && held === null ? 'hint' : view
    const { title, sub } = heading(shown, a, before)
    const list = rows(shown, a)
    const mood = MOOD[shown]
    const accent = ACCENT[shown]
    const { Box, Text, Button } = $.ui.resolve(e)

    const pick = held
    const buttons =
      shown === 'held' && pick !== null
        ? [
            <Button key="improve" variant="primary" hotkey="i" onPress={() => void improve($, pick)}>
              improve it
            </Button>,
            <Button key="send" hotkey="s" onPress={() => void sendAnyway($, pick)}>
              send anyway
            </Button>,
            <Button key="ask" hotkey="a" onPress={() => void sendAsking($, pick)}>
              let Claude ask
            </Button>,
          ]
        : [
            <Button key="next" hotkey="n" plain dimColor onPress={() => void armNext($)}>
              read my next prompt
            </Button>,
          ]

    // One line per part: the dot, the part's name, then its note or question, wrapping under itself.
    const checklist = list.map(r => (
      <Box key={`row-${r.key}`} gap={1}>
        <Box width={1} flexShrink={0}>
          <Text color={r.color}>{r.dot}</Text>
        </Box>
        <Box width={12} flexShrink={0}>
          <Text bold color={r.dot === STATUS_DOT.missing ? THEME.missing : THEME.ink}>
            {r.label}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text color={r.dot === STATUS_DOT['n/a'] ? THEME.dim : THEME.ink}>{r.text}</Text>
        </Box>
      </Box>
    ))
    // A held prompt's choices sit right under the heading, where a short pane still shows them.
    const isHeld = shown === 'held' && pick !== null
    const statsLine = stats === null ? null : <Text color={THEME.dim}>{stats}</Text>

    // The pane draws its own frame: no border of ours inside it.
    // Desktop and the VS Code extension draw the SVG pixel art; the terminal draws the ASCII frames.
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Svg } = $.ui.resolve(e)
      return (
        <Box key="prompt-coach-pane" flexDirection="column" backgroundColor={THEME.panel} paddingX={1} gap={1}>
          <Box gap={2} alignItems="center">
            <Svg source={quillSvg(mood, 48)} alt={`Quill the owl, ${mood}`} width={48} height={48} isInteractive />
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Text bold color={accent}>
                {title}
              </Text>
              <Text color={THEME.dim}>{sub}</Text>
            </Box>
          </Box>
          {isHeld ? (
            <Box gap={1} flexWrap="wrap">
              {buttons}
            </Box>
          ) : null}
          <Box flexDirection="column">{checklist}</Box>
          {isHeld ? null : (
            <Box gap={1} flexWrap="wrap">
              {buttons}
            </Box>
          )}
          {statsLine}
        </Box>
      )
    }

    const sprite = QUILL_ASCII[mood]
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box gap={1}>
          <Box flexDirection="column" width={QUILL_W} flexShrink={0}>
            {sprite.map(row => (
              <Text color={THEME.owl}>{row}</Text>
            ))}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text bold color={accent}>
              {title}
            </Text>
            <Text color={THEME.dim}>{sub}</Text>
          </Box>
        </Box>
        {isHeld ? (
          <Box gap={1} flexWrap="wrap">
            {buttons}
          </Box>
        ) : null}
        {checklist}
        {isHeld ? null : (
          <Box gap={2} flexWrap="wrap">
            {buttons}
          </Box>
        )}
        {statsLine}
      </Box>
    )
  })
}
