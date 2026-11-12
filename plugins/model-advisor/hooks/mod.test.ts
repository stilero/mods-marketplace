import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptOrigin } from 'claude-code'

const T0 = 1_700_000_000_000

const reply = (complexity: string, model: string, effort: string, headline: string, reason: string, isWork = true) =>
  JSON.stringify({ isWork, complexity, model, effort, headline, reason })

/** What the advisor model answers, picked by a marker word in the prompt. */
const REPLIES: Record<string, string> = {
  TRIVIAL: reply('trivial', 'haiku', 'low', 'A one-file rename', 'One mechanical edit, fully specified.'),
  EVERYDAY: reply('moderate', 'sonnet', 'medium', 'A feature across a few files', 'A typical feature with a few decisions.'),
  HARD: reply('complex', 'opus', 'high', 'A refactor across modules', 'Many interacting parts and a design decision.'),
  DEEP: reply('deep', 'fable', 'xhigh', 'A migration with unknowns', 'Novel, high-stakes work with little guidance.'),
  THINKLESS: reply('simple', 'opus', 'low', 'A small change', 'Small and well specified.'),
  FOLLOWUP: reply('moderate', 'sonnet', 'medium', 'A follow-up', 'Continues earlier work.', false),
  BROKEN: 'I think this prompt is pretty easy!',
}

type World = {
  opened: string[]
  closed: string[]
  toasts: string[]
  filled: string[]
  submitted: { text: string; origin: string }[]
  commands: string[]
  reads: number
  messages: number
  turns: number
  model: string
  savedEffort: string | undefined
  failCommand: string | undefined
  surfaces: ('terminal' | 'desktop' | 'vscode' | 'mobile')[]
}

/** The engine beneath the plugin, answered from memory: a session on Opus at high effort. */
function world(on: On): World {
  const w: World = {
    opened: [],
    closed: [],
    toasts: [],
    filled: [],
    submitted: [],
    commands: [],
    reads: 0,
    messages: 0,
    turns: 0,
    model: 'claude-opus-5-5',
    savedEffort: 'high',
    failCommand: undefined,
    surfaces: ['desktop'],
  }
  mock.store(on)
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    w.closed.push(e.id)
    return { value: undefined }
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
    w.submitted.push({ text: e.text, origin: e.origin.kind })
    return { text: e.text }
  })
  on('model.complete', ($, e) => {
    w.reads += 1
    const prompt = String(e.prompt)
    if (prompt.includes('ERROR')) {
      return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded', usage: USAGE } }
    }
    const marker = Object.keys(REPLIES).find(k => prompt.includes(k)) ?? 'HARD'
    return { value: { isAnswered: true as const, text: REPLIES[marker] ?? '', usage: USAGE } }
  })
  on('session.model', () => ({ value: w.model }))
  on('session.turns', () => ({ value: w.turns }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('session.messages', () => ({ value: Array.from({ length: w.messages }, () => ({ role: 'user', text: 'hi', toolUses: [] })) }))
  on('settings.read', () => ({ value: w.savedEffort === undefined ? {} : { effortLevel: w.savedEffort } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.run', ($, e) => {
    if (w.failCommand === e.command) throw new Error(`/${e.command} is not available here`)
    w.commands.push(`/${e.command} ${e.args}`.trim())
    if (e.command === 'model') w.model = `claude-${e.args}-5-5`
    return { text: '' }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'Summary.', toolUses: [] }], tokensBefore: 100_000, tokensAfter: 5_000 }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  return w
}

const USAGE = { input_tokens: 700, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const BAND = {
  plugin: 'model-advisor',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}

const PANE = {
  plugin: 'model-advisor',
  component: 'Pane',
  requestId: 'model-advisor',
  props: { title: 'Model advisor', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode'] as const

const start = ($: Engine) => $.session.start({ cwd: '/tmp/x', surface: 'desktop', isInteractive: true })
const send = ($: Engine, text: string, origin: PromptOrigin = { kind: 'composer' }) => $.prompt.submit({ text, wait: false, origin })
const command = ($: Engine, name: string, args: string) =>
  $.command.run({ command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
const advisor = ($: Engine, args: string) => command($, 'model-advisor', args)
const drop = (r: unknown): string => String((r as { drop?: string }).drop ?? '')

/** One main-loop request at an effort, as the engine sends it. */
async function request($: Engine, effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'): Promise<void> {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort, messageCount: 1 })) {
    // no chunks
  }
}

const TRIVIAL = 'TRIVIAL: rename the helper foo to bar in utils.ts'

describe('gate mode', () => {
  test('a trivial prompt on opus · high is held; "use haiku · low" switches the session and sends it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    const r = await send($, TRIVIAL)
    expect(drop(r)).toContain('haiku · low is enough for this prompt (you are on opus · high)')
    expect(drop(r)).toContain('/model-advisor switch, send or keep')
    expect(w.submitted).toHaveLength(0)
    expect(w.reads).toBe(1)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ text: /▼ shift down · trivial work fits haiku · low/ })).toBeDefined()
      expect(await ui.find({ text: /One mechanical edit, fully specified\./ })).toBeDefined()
      expect(await ui.find({ text: /now on opus · high · your prompt waits for your pick$/ })).toBeDefined()
      expect((await ui.find({ key: 'switch' }))?.text).toBe('use haiku · low')
      expect(await ui.find({ key: 'send' })).toBeDefined()
      expect(await ui.find({ key: 'keep' })).toBeDefined()
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'switch' })
    await clock.settle()
    await ui.unmount()
    expect(w.commands).toEqual(['/model haiku', '/effort low'])
    expect(w.submitted).toEqual([{ text: TRIVIAL, origin: 'plugin' }])
    expect(w.filled).toHaveLength(0)
    expect(w.toasts.some(t => t.includes('now on haiku · low'))).toBe(true)

    // The band is gone, and the next prompt of the same conversation is not weighed.
    const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await after.find({ key: 'switch' })).toBeUndefined()
    await after.unmount()
    expect(await send($, 'DEEP: now migrate the whole database layer')).toMatchObject({ text: 'DEEP: now migrate the whole database layer' })
    expect(w.reads).toBe(1)
    expect((await advisor($, '')).text).toContain('now on haiku · low')
    expect((await advisor($, '')).text).toContain('1 prompt weighed · 1 shift down · 0 shifts up')
  })

  test('send anyway sends the prompt as the user on the session\'s setup', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'send' })
    await clock.settle()
    await ui.unmount()
    expect(w.submitted).toEqual([{ text: TRIVIAL, origin: 'plugin' }])
    expect(w.commands).toHaveLength(0)
    expect(w.model).toBe('claude-opus-5-5')
  })

  test('keep my prompt hands back what was typed, without the desktop app\'s context', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    const sent = `<system-reminder>\nThe user email is a@b.c\n</system-reminder>\n${TRIVIAL}`
    expect(await send($, sent)).toHaveProperty('drop')
    const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
    await ui.press({ key: 'keep' })
    await clock.settle()
    await ui.unmount()
    expect(w.filled).toEqual([TRIVIAL])
    expect(w.submitted).toHaveLength(0)
    expect(w.commands).toHaveLength(0)
  })

  test('a deep prompt on sonnet · medium is held with advice to shift up', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.model = 'claude-sonnet-5-5'
    w.savedEffort = 'medium'
    await start($)
    const r = await send($, 'DEEP: migrate the billing service to the new event store')
    expect(drop(r)).toContain('this prompt needs fable · xhigh (you are on sonnet · medium)')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ text: /▲ shift up · deep work needs fable · xhigh/ })).toBeDefined()
      expect((await ui.find({ key: 'switch' }))?.text).toBe('use fable · xhigh')
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'switch' })
    await clock.settle()
    await ui.unmount()
    expect(w.commands).toEqual(['/model fable', '/effort xhigh'])
    expect(w.submitted).toHaveLength(1)
    expect((await advisor($, '')).text).toContain('0 shifts down · 1 shift up')
  })

  test('a prompt that fits the setup passes with a toast and no band', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    const text = 'HARD: split the sync engine into a reader and a writer module'
    expect(await send($, text)).toMatchObject({ text })
    expect(w.toasts.some(t => t.includes('opus · high fits this prompt ✓'))).toBe(true)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ key: 'switch' })).toBeUndefined()
    await ui.unmount()
    expect((await advisor($, '')).text).toContain('1 prompt weighed · 0 shifts down · 0 shifts up')
  })

  test('an effort within the tolerance fits; past it, the effort alone is advised', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.savedEffort = 'medium'
    await start($)
    // opus · medium against an advised opus · low: one level, inside the default tolerance of 1.
    expect(await send($, 'THINKLESS: add a null check to the parser entry point')).not.toHaveProperty('drop')
    w.savedEffort = 'xhigh'
    await advisor($, 'next')
    const r = await send($, 'THINKLESS: add a null check to the parser entry point')
    expect(drop(r)).toContain('opus · low is enough for this prompt (you are on opus · xhigh)')
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ key: 'switch' }))?.text).toBe('use low effort')
    await ui.press({ key: 'switch' })
    await clock.settle()
    await ui.unmount()
    expect(w.commands).toEqual(['/effort low'])
    // The first prompt went straight through; the held one went after the switch.
    expect(w.submitted.map(s => s.origin)).toEqual(['composer', 'plugin'])
  })

  test('a model off the ladder gets no model advice', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    w.model = 'my-gateway-model'
    w.savedEffort = 'low'
    await start($)
    expect(await send($, TRIVIAL)).toMatchObject({ text: TRIVIAL })
    expect(w.reads).toBe(1)
  })

  test('a follow-up is not weighed and Cog stays armed for the first piece of work', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect(await send($, 'FOLLOWUP: yes, go on with the second option')).not.toHaveProperty('drop')
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    expect(w.reads).toBe(2)
  })

  test('a failed read and a reply that is not JSON let the prompt through with a toast', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect(await send($, 'ERROR: rename the helper foo to bar')).toMatchObject({ text: 'ERROR: rename the helper foo to bar' })
    expect(w.toasts.some(t => t.includes('could not weigh that prompt'))).toBe(true)
    await advisor($, 'next')
    expect(await send($, 'BROKEN: rename the helper foo to bar')).toMatchObject({ text: 'BROKEN: rename the helper foo to bar' })
    expect(w.toasts.filter(t => t.includes('could not weigh that prompt'))).toHaveLength(2)
  })

  test('short prompts, slash commands, prompts no person wrote and a resumed conversation make no model call', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    await send($, 'TRIVIAL: hi')
    await $.prompt.submit({
      text: '/review TRIVIAL this is a command',
      wait: false,
      origin: { kind: 'composer' },
      command: { name: 'review', args: 'TRIVIAL this is a command' },
    })
    await send($, TRIVIAL, { kind: 'task-notification' })
    await send($, TRIVIAL, { kind: 'peer' })
    await send($, TRIVIAL, { kind: 'plugin', name: 'cache-thermo' })
    await clock.settle()
    expect(w.reads).toBe(0)
    // Another mod's resubmit of the person's own prompt is weighed.
    expect(await send($, TRIVIAL, { kind: 'plugin', name: 'cache-thermo', asUser: true })).toHaveProperty('drop')
    expect(w.reads).toBe(1)
  })

  test('a run that draws nothing is never held and makes no model call', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    w.surfaces = []
    await start($)
    expect(await send($, TRIVIAL, { kind: 'sdk' })).toMatchObject({ text: TRIVIAL })
    expect(w.reads).toBe(0)
    // Still armed: the first prompt once a surface draws is weighed.
    w.surfaces = ['terminal']
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
  })

  test('a resumed conversation is not armed until asked', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    w.messages = 4
    await start($)
    expect(await send($, TRIVIAL)).toMatchObject({ text: TRIVIAL })
    expect(w.reads).toBe(0)
    expect((await advisor($, 'next')).text).toContain('weigh your next prompt')
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
  })

  test('a new prompt instead of a pick replaces the held one and is weighed', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    const text = 'HARD: split the sync engine into a reader and a writer module'
    expect(await send($, text)).toMatchObject({ text })
    expect(w.reads).toBe(2)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ key: 'switch' })).toBeUndefined()
    await ui.unmount()
    expect((await advisor($, 'send')).text).toBe('No prompt is waiting.')
  })

  test('a switch that does not take hands the prompt back instead of sending it', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.failCommand = 'model'
    await start($)
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'switch' })
    await clock.settle()
    await ui.unmount()
    expect(w.submitted).toHaveLength(0)
    expect(w.filled).toEqual([TRIVIAL])
    expect(w.toasts.some(t => t.includes('Cog could not run /model haiku. Type /model haiku and /effort low yourself.'))).toBe(true)
    expect((await advisor($, '')).text).toContain('0 shifts down')
  })

  test('a model switch in the middle of a conversation says that it re-caches', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    w.turns = 3
    await start($)
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ text: /a model switch re-caches this conversation/ })).toBeDefined()
    await ui.unmount()
  })

  test('a prompt with attachments is not held: it gets the hint', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    const r = await $.prompt.submit({
      text: TRIVIAL,
      wait: false,
      origin: { kind: 'composer' },
      attachments: [{ id: 'a1', type: 'image', mediaType: 'image/png' }],
    })
    expect(r).toMatchObject({ text: TRIVIAL })
    await clock.settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await ui.find({ key: 'switch' }))?.text).toBe('use haiku · low next')
    await ui.unmount()
  })

  test('gateOn down holds only advice to shift down; advice to shift up is a hint', { options: { gateOn: 'down' } }, async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    w.model = 'claude-sonnet-5-5'
    w.savedEffort = 'medium'
    await start($)
    const text = 'DEEP: migrate the billing service to the new event store'
    expect(await send($, text)).toMatchObject({ text })
    expect(w.toasts.some(t => t.includes('this needs fable · xhigh (you are on sonnet · medium)'))).toBe(true)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ text: /your prompt went on this setup/ })).toBeDefined()
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    await ui.unmount()
    await advisor($, 'next')
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
  })
})

describe('the command', () => {
  test('switch, send and keep act on the held prompt without the band', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect((await advisor($, 'switch')).text).toBe('No advice is waiting.')
    expect((await advisor($, 'keep')).text).toBe('No prompt is waiting.')

    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    expect((await advisor($, '')).text).toContain('a prompt waits: haiku · low is advised')
    expect((await advisor($, 'switch')).text).toBe('Switching to haiku · low, then sending your prompt.')
    expect(w.commands).toHaveLength(0)
    await clock.advance(1)
    expect(w.commands).toEqual(['/model haiku', '/effort low'])
    expect(w.submitted).toEqual([{ text: TRIVIAL, origin: 'plugin' }])

    await advisor($, 'next')
    expect(await send($, 'DEEP: migrate the billing service to the new event store')).toHaveProperty('drop')
    expect((await advisor($, 'send')).text).toBe('Sending your prompt on haiku · low.')
    await clock.advance(1)
    expect(w.submitted).toHaveLength(2)

    await advisor($, 'next')
    expect(await send($, 'DEEP: migrate the billing service to the new event store')).toHaveProperty('drop')
    expect((await advisor($, 'keep')).text).toBe('Your prompt is back in the prompt box.')
    expect(w.filled).toEqual(['DEEP: migrate the billing service to the new event store'])
    expect(w.submitted).toHaveLength(2)
  })

  test('mode switches gate to hints and off for the session', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect((await advisor($, 'mode hints')).text).toContain('Hints mode')
    expect(await send($, TRIVIAL)).toMatchObject({ text: TRIVIAL })
    await clock.settle()
    expect(w.reads).toBe(1)
    await advisor($, 'mode off')
    await advisor($, 'next')
    expect(await send($, TRIVIAL)).toMatchObject({ text: TRIVIAL })
    expect(w.reads).toBe(1)
    expect((await advisor($, 'mode loud')).text).toContain('Usage')
    expect((await advisor($, '')).text).toContain('off mode')
  })

  test('status names the mode, the setup, the advisor and the ladder', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on)
    await start($)
    const text = (await advisor($, '')).text
    expect(text).toContain('model-advisor: gate mode · weighing the next prompt · now on opus · high · advisor haiku · ladder haiku < sonnet < opus < fable')
  })
})

describe('hints mode', () => {
  test('the prompt goes at once and the band shows the advice for the next prompt', { options: { mode: 'hints' } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect(await send($, TRIVIAL)).toMatchObject({ text: TRIVIAL })
    await clock.settle()
    expect(w.reads).toBe(1)
    expect(w.toasts.some(t => t.includes('haiku · low is enough for this (you are on opus · high)'))).toBe(true)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ text: /▼ shift down · trivial work fits haiku · low/ })).toBeDefined()
      expect(await ui.find({ text: /your prompt went on this setup/ })).toBeDefined()
      expect((await ui.find({ key: 'switch' }))?.text).toBe('use haiku · low next')
      expect(await ui.find({ key: 'dismiss' })).toBeDefined()
      expect(await ui.find({ key: 'send' })).toBeUndefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'switch' })
    await clock.settle()
    await ui.unmount()
    expect(w.commands).toEqual(['/model haiku', '/effort low'])
    // Only the prompt as typed went: the switch sends nothing.
    expect(w.submitted).toEqual([{ text: TRIVIAL, origin: 'composer' }])
    const after = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await after.find({ key: 'switch' })).toBeUndefined()
    await after.unmount()
  })

  test('dismiss hides the hint, and so does the next prompt', { options: { mode: 'hints', trigger: 'every' } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    await send($, TRIVIAL)
    await clock.settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'dismiss' })
    await clock.settle()
    expect(await ui.find({ key: 'switch' })).toBeUndefined()
    await ui.unmount()

    await send($, TRIVIAL)
    await clock.settle()
    await send($, 'HARD: split the sync engine into a reader and a writer module')
    await clock.settle()
    const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await after.find({ key: 'switch' })).toBeUndefined()
    await after.unmount()
    expect(w.reads).toBe(3)
  })
})

describe('the session\'s effort', () => {
  test('the main loop\'s last request says the effort, whatever is saved', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    w.savedEffort = 'low'
    await start($)
    await request($, 'xhigh')
    expect((await advisor($, '')).text).toContain('now on opus · xhigh')
    // opus · xhigh against an advised opus · high: one level, no advice.
    const text = 'HARD: split the sync engine into a reader and a writer module'
    expect(await send($, text)).toMatchObject({ text })
  })

  test('a typed /effort counts before the next request', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    await request($, 'max')
    await command($, 'effort', 'low')
    expect(w.commands).toEqual(['/effort low'])
    expect((await advisor($, '')).text).toContain('now on opus · low')
    // /effort with no level opens a picker: the saved default stands until the next request.
    await command($, 'effort', '')
    expect((await advisor($, '')).text).toContain('now on opus · high')
  })

  test('an effort that the environment names holds for the session: only the model is switched', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    mock.env(on, { CLAUDE_CODE_EFFORT_LEVEL: 'xhigh' })
    await start($)
    await request($, 'low')
    expect((await advisor($, '')).text).toContain('now on opus · xhigh')
    // opus · xhigh against an advised opus · low: /effort cannot change it, so there is nothing to advise.
    expect(await send($, 'THINKLESS: add a null check to the parser entry point')).not.toHaveProperty('drop')
    await advisor($, 'next')
    const r = await send($, TRIVIAL)
    expect(drop(r)).toContain('haiku · xhigh is enough for this prompt (you are on opus · xhigh)')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await ui.find({ key: 'switch' }))?.text).toBe('use haiku')
    await ui.press({ key: 'switch' })
    await clock.settle()
    await ui.unmount()
    expect(w.commands).toEqual(['/model haiku'])
    expect(w.toasts.some(t => t.includes('now on haiku · xhigh'))).toBe(true)
  })

  test('an unknown effort is not advised alone, and rides along with a model switch', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.savedEffort = undefined
    mock.env(on, {})
    await start($)
    expect((await advisor($, '')).text).toContain('now on opus · advisor')
    expect(await send($, 'THINKLESS: add a null check to the parser entry point')).not.toHaveProperty('drop')
    await advisor($, 'next')
    const r = await send($, TRIVIAL)
    expect(drop(r)).toContain('haiku · low is enough for this prompt (you are on opus)')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'switch' })
    await clock.settle()
    await ui.unmount()
    expect(w.commands).toEqual(['/model haiku', '/effort low'])
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
  test('/clear and a compaction arm Cog again', { options: { mode: 'hints' } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    const state = conversationState(on)
    await start($)
    await send($, 'HARD: the first piece of work of the conversation')
    await clock.settle()
    await send($, 'HARD: the second piece of work is not weighed')
    await clock.settle()
    expect(w.reads).toBe(1)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    state.clear()
    await send($, 'HARD: the first piece of work after the clear')
    await clock.settle()
    expect(w.reads).toBe(2)
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'x', toolUses: [] }] })
    await send($, 'HARD: the first piece of work after the compaction')
    await clock.settle()
    expect(w.reads).toBe(3)
  })

  test('trigger every weighs each prompt', { options: { trigger: 'every' } }, async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    w.messages = 2
    await start($)
    await send($, 'HARD: the first piece of work to do')
    await send($, 'HARD: the second piece of work to do')
    expect(w.reads).toBe(2)
  })
})

describe('the pane that stands in for the band', () => {
  test('a band that another mod keeps does not draw the gate: the pane opens with the same choices', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    // Nothing draws the band (cache-thermo, installed earlier, answers for it).
    await clock.advance(699)
    expect(w.opened).toHaveLength(0)
    await clock.advance(1)
    expect(w.opened).toEqual(['model-advisor'])

    for (const surface of [...SURFACES, 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ text: /▼ shift down · trivial work fits haiku · low/ })).toBeDefined()
      expect((await ui.find({ key: 'switch' }))?.text).toBe('use haiku · low')
      expect(await ui.find({ key: 'send' })).toBeDefined()
      expect(await ui.find({ key: 'keep' })).toBeDefined()
      expect((await ui.findAll({ type: 'Svg' })).length).toBe(surface === 'desktop' || surface === 'vscode' ? 1 : 0)
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'switch' })
    await clock.settle()
    await ui.unmount()
    expect(w.commands).toEqual(['/model haiku', '/effort low'])
    expect(w.submitted).toEqual([{ text: TRIVIAL, origin: 'plugin' }])
    expect(w.closed).toEqual(['model-advisor'])
  })

  test('a band that draws the gate needs no pane', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await clock.advance(5000)
    expect(w.opened).toHaveLength(0)
    await ui.press({ key: 'send' })
    await clock.settle()
    await ui.unmount()
    expect(w.closed).toHaveLength(0)
  })

  test('a collapsed band shows nothing: the pane opens', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isCollapsed: true }, surface: 'terminal' })
    await clock.advance(700)
    await ui.unmount()
    expect(w.opened).toEqual(['model-advisor'])
  })

  test('a pick made before the moment is up opens no pane, and a hint gets the pane too', { options: { mode: 'hints' } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await start($)
    await send($, TRIVIAL)
    await clock.settle()
    expect((await advisor($, 'switch')).text).toBe('Switching to haiku · low.')
    await clock.advance(5000)
    expect(w.commands).toEqual(['/model haiku', '/effort low'])
    expect(w.opened).toHaveLength(0)

    await advisor($, 'next')
    await send($, 'DEEP: migrate the billing service to the new event store')
    await clock.settle()
    await clock.advance(700)
    expect(w.opened).toEqual(['model-advisor'])
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: 'switch' }))?.text).toBe('use fable · xhigh next')
    await ui.press({ key: 'dismiss' })
    await clock.settle()
    await ui.unmount()
    expect(w.closed).toEqual(['model-advisor'])
  })

  test('/model-advisor open shows Cog and arms the next prompt; that pane stays open after a pick', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    w.messages = 2
    await start($)
    expect((await advisor($, 'open')).text).toBe('Model advisor pane opened.')
    expect(w.opened).toEqual(['model-advisor'])
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ text: /Beep! I'm Cog/ })).toBeDefined()
      expect(await ui.find({ text: /ladder haiku < sonnet < opus < fable/ })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'next' })
    await clock.settle()
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    expect(await ui.find({ text: /▼ shift down/ })).toBeDefined()
    await ui.press({ key: 'keep' })
    await clock.settle()
    await ui.unmount()
    expect(w.filled).toEqual([TRIVIAL])
    expect(w.closed).toHaveLength(0)
  })
})

describe('the band', () => {
  test('nothing is drawn while there is no advice, and a survey keeps the band', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on)
    await start($)
    const idle = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await idle.findAll({ type: 'Text' })).toHaveLength(0)
    await idle.unmount()
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
    expect(await survey.find({ key: 'switch' })).toBeUndefined()
    await survey.unmount()
  })

  test('desktop and VS Code draw Cog as SVG, the terminal and mobile draw the ASCII frames', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on)
    await start($)
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    const drawn = async (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'): Promise<{ svgs: number; ascii: boolean }> => {
      const ui = await $.ui.mount({ ...BAND, surface })
      const svgs = (await ui.findAll({ type: 'Svg' })).length
      const ascii = (await ui.find({ text: /\/\[v\]\\/ })) !== undefined
      await ui.unmount()
      return { svgs, ascii }
    }
    expect(await drawn('desktop')).toEqual({ svgs: 1, ascii: false })
    expect(await drawn('vscode')).toEqual({ svgs: 1, ascii: false })
    expect(await drawn('terminal')).toEqual({ svgs: 0, ascii: true })
    expect(await drawn('mobile')).toEqual({ svgs: 0, ascii: true })
  })

  test('the terminal\'s art flips between two frames while the band shows', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on)
    await start($)
    expect(await send($, TRIVIAL)).toHaveProperty('drop')
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ text: /\/\[v\]\\/ })).toBeDefined()
    await clock.advance(1000)
    expect(await ui.find({ text: /\/\[V\]\\/ })).toBeDefined()
    await ui.unmount()
  })
})
