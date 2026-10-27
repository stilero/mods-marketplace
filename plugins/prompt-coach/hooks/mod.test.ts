import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const T0 = 1_700_000_000_000

const part = (status: string, note: string, ask = '') => ({ status, note, ask })

/** What the coach model answers, picked by a marker word in the prompt. */
const REPLIES: Record<string, string> = {
  WEAK: JSON.stringify({
    isTask: true,
    headline: 'Clear goal: now say what done looks like',
    criteria: {
      goal: part('present', 'Add CSV export to the reports page'),
      why: part('present', 'Finance needs monthly numbers'),
      constraints: part('missing', 'No libraries named', 'Use the existing CSV helper or a library?'),
      done: part('missing', 'No acceptance criteria', 'Which columns and which test proves it works?'),
      reuse: part('n/a', 'New page'),
    },
  }),
  STRONG: JSON.stringify({
    isTask: true,
    headline: 'A complete brief',
    criteria: {
      goal: part('present', 'Add CSV export'),
      why: part('present', 'Finance'),
      constraints: part('present', 'No new dependencies'),
      done: part('present', 'Test downloads a CSV with 4 columns'),
      reuse: part('present', 'Use lib/csv.ts'),
    },
  }),
  QUESTION: JSON.stringify({ isTask: false, headline: 'Just a question', criteria: {} }),
  BROKEN: 'I think this prompt is pretty good!',
}

type World = {
  opened: string[]
  toasts: string[]
  filled: string[]
  submitted: { text: string; origin: string; context: readonly string[] }[]
  reads: number
  messages: number
}

/** The engine beneath the plugin, answered from memory. */
function world(on: On): World {
  const w: World = { opened: [], toasts: [], filled: [], submitted: [], reads: 0, messages: 0 }
  mock.store(on)
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('prompt.fill', ($, e) => {
    w.filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.submit', ($, e) => {
    w.submitted.push({ text: e.text, origin: e.origin.kind, context: e.context ?? [] })
    return { text: e.text }
  })
  on('model.complete', ($, e) => {
    w.reads += 1
    const prompt = String(e.prompt)
    if (prompt.includes('ERROR')) {
      return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded', usage: USAGE } }
    }
    const marker = Object.keys(REPLIES).find(k => prompt.includes(k)) ?? 'STRONG'
    return { value: { isAnswered: true as const, text: REPLIES[marker] ?? '', usage: USAGE } }
  })
  on('session.messages', () => ({ value: Array.from({ length: w.messages }, () => ({ role: 'user', text: 'hi', toolUses: [] })) }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: '' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'Summary.', toolUses: [] }], tokensBefore: 100_000, tokensAfter: 5_000 }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  return w
}

const USAGE = { input_tokens: 900, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const PANE = {
  plugin: 'prompt-coach',
  component: 'Pane',
  requestId: 'prompt-coach',
  props: {
    title: 'Prompt coach',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const start = ($: Engine) => $.session.start({ cwd: '/tmp/x', surface: 'desktop', isInteractive: true })
const send = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const command = ($: Engine, args: string) =>
  $.command.run({ command: 'prompt-coach', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

describe('hints mode', () => {
  test('a weak first prompt goes at once and the pane shows what to add, once', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    const r = await send($, 'WEAK: add CSV export to the reports page for finance')
    expect(r).toMatchObject({ text: 'WEAK: add CSV export to the reports page for finance' })
    await clock.settle()
    expect(w.reads).toBe(1)
    expect(w.opened).toEqual(['prompt-coach'])
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ text: /Clear goal: now say what done looks like/ })).toBeDefined()
      expect(await ui.find({ text: /for next time · 2 of 4 parts that apply/ })).toBeDefined()
      expect(await ui.find({ text: /Which columns and which test proves it works\?/ })).toBeDefined()
      expect(await ui.find({ text: /last 1 brief: 50% covered · 1 coached/ })).toBeDefined()
      await ui.unmount()
    }
    // The next prompt of the same conversation is not read.
    await send($, 'WEAK: and another thing to build please')
    await clock.settle()
    expect(w.reads).toBe(1)
  })

  test('a complete brief gets a toast, not a pane', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    await send($, 'STRONG: add CSV export, reuse lib/csv.ts, done when the test passes')
    await clock.settle()
    expect(w.opened).toHaveLength(0)
    expect(w.toasts.some(t => t.includes('nice brief ✓ (5 of 5 parts that apply)'))).toBe(true)
  })

  test('a question is not coached and Quill stays armed for the first task', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    await send($, 'QUESTION: what does this repository do?')
    await clock.settle()
    expect(w.opened).toHaveLength(0)
    await send($, 'WEAK: add CSV export to the reports page')
    await clock.settle()
    expect(w.reads).toBe(2)
    expect(w.opened).toEqual(['prompt-coach'])
  })

  test('short prompts, slash commands and a resumed conversation make no model call', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.messages = 4
    await start($)
    await send($, 'WEAK: a resumed conversation is not armed')
    await command($, 'next')
    await send($, 'WEAK: hi')
    await $.prompt.submit({
      text: '/review WEAK this is a command',
      wait: false,
      origin: { kind: 'composer' },
      command: { name: 'review', args: 'WEAK this is a command' },
    })
    await clock.settle()
    expect(w.reads).toBe(0)
  })

  test('a failed read fails open with a toast', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    const r = await send($, 'ERROR: add CSV export to the reports page')
    expect(r).toMatchObject({ text: 'ERROR: add CSV export to the reports page' })
    await clock.settle()
    expect(w.toasts.some(t => t.includes('could not read that prompt'))).toBe(true)
    expect(w.opened).toHaveLength(0)
  })

  test('a reply that is not JSON fails open too', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    await send($, 'BROKEN: add CSV export to the reports page')
    await clock.settle()
    expect(w.toasts.some(t => t.includes('could not read that prompt'))).toBe(true)
  })
})

describe('gate mode', () => {
  test('a weak prompt is held; improve it fills a scaffold and the better prompt shows the delta', { options: { mode: 'gate' } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    const r = await send($, 'WEAK: add CSV export to the reports page')
    expect(r).toHaveProperty('drop')
    expect(String((r as { drop?: string }).drop)).toContain('Constraints, Done when')
    expect(w.submitted).toHaveLength(0)
    expect(w.opened).toEqual(['prompt-coach'])

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ text: /your prompt is waiting · 2 of 4 parts that apply/ })).toBeDefined()
      expect(await ui.find({ key: 'improve' })).toBeDefined()
      expect(await ui.find({ key: 'send' })).toBeDefined()
      expect(await ui.find({ key: 'ask' })).toBeDefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'improve' })
    await clock.settle()
    await ui.unmount()
    expect(w.filled).toHaveLength(1)
    expect(w.filled[0]).toContain('## Constraints\n- <Use the existing CSV helper or a library?>')
    expect(w.filled[0]).toContain('## Done when\n- <Which columns and which test proves it works?>')

    const again = await send($, 'STRONG: the improved brief')
    expect(again).toMatchObject({ text: 'STRONG: the improved brief' })
    expect(w.reads).toBe(2)
    const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await after.find({ text: /nice brief ✓ · 5 of 5 parts that apply · 2\/4 → 5\/5/ })).toBeDefined()
    // The improved brief replaces the weak one in the stats rather than counting twice.
    expect(await after.find({ text: /last 1 brief: 100% covered · 1 coached/ })).toBeDefined()
    await after.unmount()
  })

  test('improve it hands back the brief without the desktop app\'s context, which send anyway keeps', { options: { mode: 'gate' } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    const sent = '<system-reminder>\nThe user email is a@b.c\n</system-reminder>\nWEAK: add CSV export to the reports page'
    expect(await send($, sent)).toHaveProperty('drop')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'improve' })
    await clock.settle()
    await ui.unmount()
    expect(w.filled).toHaveLength(1)
    expect(w.filled[0]?.startsWith('WEAK: add CSV export to the reports page\n\n## Constraints')).toBe(true)
    expect(w.filled[0]).not.toContain('system-reminder')

    await send($, sent)
    const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await again.press({ key: 'send' })
    await clock.settle()
    await again.unmount()
    expect(w.submitted).toEqual([{ text: sent, origin: 'plugin', context: [] }])
  })

  test('send anyway sends the prompt as the user and leaves the hint', { options: { mode: 'gate' } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    await send($, 'WEAK: add CSV export to the reports page')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'send' })
    await clock.settle()
    await ui.unmount()
    expect(w.submitted).toEqual([{ text: 'WEAK: add CSV export to the reports page', origin: 'plugin', context: [] }])
    const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await after.find({ text: /for next time/ })).toBeDefined()
    expect(await after.find({ key: 'improve' })).toBeUndefined()
    await after.unmount()
    // Disarmed: the next prompt goes without a read.
    await send($, 'WEAK: another task for the same conversation')
    expect(w.reads).toBe(1)
  })

  test('let Claude ask sends the brief with the questions to ask first', { options: { mode: 'gate' } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    await send($, 'WEAK: add CSV export to the reports page')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'ask' })
    await clock.settle()
    await ui.unmount()
    expect(w.submitted).toHaveLength(1)
    const sent = w.submitted[0]?.text ?? ''
    expect(sent.startsWith('WEAK: add CSV export to the reports page\n\nBefore you plan or implement anything')).toBe(true)
    expect(sent).toContain('- Constraints: Use the existing CSV helper or a library?')
    expect(w.submitted[0]?.origin).toBe('plugin')
    const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await after.find({ text: /Claude will ask you about Constraints, Done when/ })).toBeDefined()
    await after.unmount()
  })

  test('a brief rewritten by hand instead of a pick is read again', { options: { mode: 'gate' } }, async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect(await send($, 'WEAK: add CSV export to the reports page')).toHaveProperty('drop')
    const r = await send($, 'STRONG: add CSV export, reuse lib/csv.ts, done when the test passes')
    expect(r).toMatchObject({ text: 'STRONG: add CSV export, reuse lib/csv.ts, done when the test passes' })
    expect(w.reads).toBe(2)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ text: /nice brief ✓ · 5 of 5 parts that apply · 2\/4 → 5\/5/ })).toBeDefined()
    await ui.unmount()
  })

  test('a complete brief passes straight through', { options: { mode: 'gate' } }, async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    const r = await send($, 'STRONG: add CSV export with everything spelled out')
    expect(r).toMatchObject({ text: 'STRONG: add CSV export with everything spelled out' })
    expect(w.opened).toHaveLength(0)
  })

  test('a failed read lets the prompt through', { options: { mode: 'gate' } }, async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on)
    await start($)
    const r = await send($, 'ERROR: add CSV export to the reports page')
    expect(r).toMatchObject({ text: 'ERROR: add CSV export to the reports page' })
  })

  test('the session mode command switches hints to gate and off', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect((await command($, 'mode gate')).text).toContain('Gate mode')
    expect(await send($, 'WEAK: add CSV export to the reports page')).toHaveProperty('drop')
    await command($, 'mode off')
    await command($, 'next')
    expect(await send($, 'WEAK: add CSV export to the reports page')).toMatchObject({ text: 'WEAK: add CSV export to the reports page' })
    expect(w.reads).toBe(1)
  })
})

/**
 * $.state as a session holds it: per conversation, so after a /clear the next one starts with nothing written.
 * The kit's own bottom keeps values across a /clear; this one stands in for the engine.
 */
function conversationState(on: On) {
  let values = new Map<string, { value: unknown; version: number }>()
  on('state.get', ($, e) => ({ value: values.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', ($, e) => {
    const version = (values.get(e.key)?.version ?? 0) + 1
    values.set(e.key, { value: e.value, version })
    return { value: { isSet: true as const, version } }
  })
  return { clear: () => (values = new Map()) }
}

describe('arming', () => {
  test('/clear and a compaction arm Quill again', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    const state = conversationState(on)
    await start($)
    await send($, 'WEAK: first task of the conversation')
    await clock.settle()
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    state.clear()
    await send($, 'WEAK: first task after the clear')
    await clock.settle()
    expect(w.reads).toBe(2)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'x', toolUses: [] }] })
    await send($, 'WEAK: first task after the compaction')
    await clock.settle()
    expect(w.reads).toBe(3)
  })

  test('trigger every reads each task prompt', { options: { trigger: 'every' } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.messages = 2
    await start($)
    await send($, 'WEAK: the first task to build')
    await clock.settle()
    await send($, 'WEAK: the second task to build')
    await clock.settle()
    expect(w.reads).toBe(2)
  })

  test('the idle pane teaches the five parts and arms the next prompt', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.messages = 2
    await start($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ text: /A good brief has five parts/ })).toBeDefined()
      expect(await ui.find({ text: /libraries to use or avoid, what not to touch/ })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'next' })
    await ui.unmount()
    await send($, 'WEAK: now read this one')
    await clock.settle()
    expect(w.reads).toBe(1)
    expect((await command($, '')).text).toContain('hints mode')
  })
})

describe('pixel art', () => {
  test('desktop and VS Code draw Quill as SVG, the terminal and mobile draw none', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on)
    await start($)
    const svgs = async (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'): Promise<number> => {
      const ui = await $.ui.mount({ ...PANE, surface })
      const n = (await ui.findAll({ type: 'Svg' })).length
      await ui.unmount()
      return n
    }
    expect(await svgs('vscode')).toBe(1)
    expect(await svgs('desktop')).toBe(1)
    expect(await svgs('terminal')).toBe(0)
    expect(await svgs('mobile')).toBe(0)
  })
})
