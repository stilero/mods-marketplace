import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'

const T0 = 1_700_000_000_000
const HOUR = 3_600_000
const FABLE_USAGE: TurnUsage = {
  input_tokens: 2_000,
  cache_read_input_tokens: 398_000,
  cache_creation_input_tokens: 0,
  output_tokens: 500,
  model: 'claude-fable-5-1',
}

const SUMMARY = { role: 'user' as const, text: 'Summary of the conversation so far.', toolUses: [] }

type World = {
  opened: string[]
  closed: string[]
  toasts: string[]
  filled: string[]
  submitted: { text: string; origin: string }[]
  forks: number
  forkUsage: { cache_read_input_tokens: number; cache_creation_input_tokens: number; input_tokens: number; output_tokens: number }
}

/** The engine beneath the plugin, answered from memory. */
function world(on: On, isSubscription = true): World {
  const w: World = {
    opened: [],
    closed: [],
    toasts: [],
    filled: [],
    submitted: [],
    forks: 0,
    forkUsage: { cache_read_input_tokens: 400_000, cache_creation_input_tokens: 0, input_tokens: 40, output_tokens: 1 },
  }
  mock.store(on)
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    w.closed.push(e.id)
    w.opened = w.opened.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: w.opened.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('prompt.fill', ($, e) => {
    w.filled.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.submit', ($, e) => {
    w.submitted.push({ text: e.text, origin: e.origin.kind })
    return { text: e.text }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.usage', () => ({
    value: {
      startedAt: T0,
      context: { window: 1_000_000 },
      rateLimits: isSubscription ? [{ kind: 'five_hour', percentUsed: 10 }] : [],
    },
  }))
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('fs.read', () => ({ deny: 'no pricing.json in tests' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: '' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.compact', () => ({ messages: [SUMMARY], tokensBefore: 400_500, tokensAfter: 12_000 }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('model.fork', () => {
    w.forks += 1
    return { value: { isAnswered: true as const, text: '.', usage: { ...w.forkUsage } } }
  })
  return w
}

async function answered($: Engine, usage: TurnUsage = FABLE_USAGE): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer', usage })
}

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}

describe('cold-cache gate', () => {
  test('a warm prompt passes untouched', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await answered($)
    await clock.advance(10 * 60_000)
    const r = await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
    expect(r).toMatchObject({ text: 'hello' })
    expect(w.submitted).toHaveLength(1)
    expect(w.opened).toHaveLength(0)
  })

  test('a cold prompt above the threshold is held, Continue resubmits it as the user', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await answered($)
    const said = await $.command.run({ command: 'cache-thermo', args: 'cold', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(said.text).toContain('so the gate will hold it')
    await clock.advance(2 * HOUR)
    const r = await $.prompt.submit({ text: 'expensive question', wait: false, origin: { kind: 'composer' } })
    expect(r).toHaveProperty('drop')
    expect(String((r as { drop?: string }).drop)).toContain('$8.01')
    expect(w.submitted).toHaveLength(0)
    expect(w.opened).toHaveLength(0)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'cache-thermo',
        surface,
        ...BAND,
      })
      expect(await ui.find({ text: /brrr, the cache went cold/ })).toBeDefined()
      expect(await ui.find({ text: /400,500 tokens/ })).toBeDefined()
      expect((await ui.find({ key: 'continue' }))?.text).toContain('$8.01')
      await ui.unmount()
    }

    const ui = await $.ui.mount({
      plugin: 'cache-thermo',
      surface: 'terminal',
      ...BAND,
    })
    await ui.press({ key: 'continue' })
    await clock.settle()
    expect(w.submitted).toEqual([{ text: 'expensive question', origin: 'plugin' }])
    await ui.unmount()
    const after = await $.ui.mount({ plugin: 'cache-thermo', surface: 'desktop', ...BAND })
    expect(await after.find({ text: /went cold/ })).toBeUndefined()
    await after.unmount()
  })

  test('Cancel hands the prompt back to the composer', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await answered($)
    await clock.advance(2 * HOUR)
    await $.prompt.submit({ text: 'keep me', wait: false, origin: { kind: 'composer' } })
    const ui = await $.ui.mount({
      plugin: 'cache-thermo',
      surface: 'desktop',
      ...BAND,
    })
    await ui.press({ key: 'cancel' })
    await clock.settle()
    expect(w.filled).toEqual(['keep me'])
    expect(w.submitted).toHaveLength(0)
    await ui.unmount()
  })

  test('a hidden band comes back to hold the prompt', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on)
    await answered($)
    await $.command.run({ command: 'cache-thermo', args: 'hide', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await clock.advance(2 * HOUR)
    await $.prompt.submit({ text: 'while hidden', wait: false, origin: { kind: 'composer' } })
    const ui = await $.ui.mount({ plugin: 'cache-thermo', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'continue' })).toBeDefined()
    await ui.unmount()
  })

  test('the cold debug command says whether the next prompt will be held', { options: { gateThresholdUsd: 50 } }, async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on)
    await answered($)
    const cold = { command: 'cache-thermo', args: 'cold', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
    expect((await $.command.run(cold)).text).toContain('under the $50.00 gate threshold, so your next prompt goes straight through')
  })

  test('a cold prompt under the threshold passes', { options: { gateThresholdUsd: 50 } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await answered($)
    await clock.advance(2 * HOUR)
    const r = await $.prompt.submit({ text: 'cheap enough', wait: false, origin: { kind: 'composer' } })
    expect(r).toMatchObject({ text: 'cheap enough' })
    expect(w.submitted).toHaveLength(1)
  })

  test('slash commands and prompts with attachments are never held', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await answered($)
    await clock.advance(2 * HOUR)
    const withImage = await $.prompt.submit({
      text: 'look at this',
      wait: false,
      origin: { kind: 'composer' },
      attachments: [{ type: 'image', mediaType: 'image/png', id: 'img1' }],
    })
    expect(withImage).toMatchObject({ text: 'look at this' })
    expect(w.toasts.some(t => t.includes('not gated'))).toBe(true)
    expect(w.opened).toHaveLength(0)
  })
})

describe('thermometer band', () => {
  test('draws nothing before the first response, then the zone on both surfaces', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'cache-thermo', surface, ...BAND })
      expect(await ui.find({ text: /ctx/ })).toBeUndefined()
      await ui.unmount()
    }
    await answered($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'cache-thermo', surface, ...BAND })
      expect(await ui.find({ text: /toasty/ })).toBeDefined()
      expect(await ui.find({ text: /~\$8\.01 API-equiv to re-cache/ })).toBeDefined()
      expect((await ui.find({ key: 'break' }))?.text).toContain('break')
      await ui.unmount()
    }
    await clock.advance(55 * 60_000)
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: true, turnId: 't2', reason: 'aborted' })
    const warm = await $.ui.mount({ plugin: 'cache-thermo', surface: 'terminal', ...BAND })
    expect(await warm.find({ text: /cooling off/ })).toBeDefined()
    await warm.unmount()
    await clock.advance(10 * 60_000)
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: true, turnId: 't3', reason: 'aborted' })
    const cold = await $.ui.mount({ plugin: 'cache-thermo', surface: 'desktop', ...BAND })
    expect(await cold.find({ text: /brrr, cold/ })).toBeDefined()
    await cold.unmount()
  })

  test('hide removes the band and the command brings it back', async ($, on) => {
    mock.clock(on, { now: T0 })
    world(on)
    await answered($)
    const ui = await $.ui.mount({ plugin: 'cache-thermo', surface: 'terminal', ...BAND })
    await ui.press({ key: 'hide' })
    const hidden = await $.ui.mount({ plugin: 'cache-thermo', surface: 'terminal', ...BAND })
    expect(await hidden.find({ text: /ctx/ })).toBeUndefined()
    await hidden.unmount()
    await ui.unmount()
    const out = await $.command.run({ command: 'cache-thermo', args: 'show', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(out.text).toContain('shown')
  })
})

describe('what the dollars say', () => {
  test('an API-key account sees plain dollars on a 5m clock', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on, false)
    await answered($)
    const ui = await $.ui.mount({ plugin: 'cache-thermo', surface: 'desktop', ...BAND })
    expect(await ui.find({ text: /~\$5\.01 to re-cache · 5m ttl, assumed/ })).toBeDefined()
    expect(await ui.find({ text: /API-equiv/ })).toBeUndefined()
    await ui.unmount()
    await clock.advance(6 * 60_000)
    const r = await $.prompt.submit({ text: 'cold already', wait: false, origin: { kind: 'composer' } })
    expect(r).toHaveProperty('drop')
  })

  test('with dollars off, a subscription sees tokens only', { options: { showCostOnSubscription: false } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await answered($)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'cache-thermo', surface, ...BAND })
      expect(await ui.find({ text: /401k ctx · 1h ttl/ })).toBeDefined()
      expect(await ui.find({ text: /\$/ })).toBeUndefined()
      await ui.unmount()
    }
    await clock.advance(2 * HOUR)
    const r = await $.prompt.submit({ text: 'still gated', wait: false, origin: { kind: 'composer' } })
    expect(String((r as { drop?: string }).drop)).toContain('401k tokens')
    const gate = await $.ui.mount({
      plugin: 'cache-thermo',
      surface: 'desktop',
      ...BAND,
    })
    expect(await gate.find({ text: /went cold · re-caches 401k tokens/ })).toBeDefined()
    expect((await gate.find({ key: 'continue' }))?.text).not.toContain('$')
    await gate.unmount()
  })
})

describe('a new prefix', () => {
  test('a compaction drops the clock until the next response', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await answered($)
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY] })
    const ui = await $.ui.mount({ plugin: 'cache-thermo', surface: 'desktop', ...BAND })
    expect(await ui.find({ text: /ctx/ })).toBeUndefined()
    await ui.unmount()
    // An old clock would gate this; the compacted conversation re-caches anyway.
    await clock.advance(2 * HOUR)
    const r = await $.prompt.submit({ text: 'after compact', wait: false, origin: { kind: 'composer' } })
    expect(r).toMatchObject({ text: 'after compact' })
    expect(w.opened).toHaveLength(0)
    await answered($, { ...FABLE_USAGE, cache_read_input_tokens: 10_000 })
    const back = await $.ui.mount({ plugin: 'cache-thermo', surface: 'terminal', ...BAND })
    expect(await back.find({ text: /13k ctx/ })).toBeDefined()
    await back.unmount()
  })

  test('a /clear ends a break and drops the clock', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await answered($)
    await $.command.run({ command: 'cache-thermo', args: 'break', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(w.toasts.some(t => t.includes('New conversation: the break ends'))).toBe(true)
    const ui = await $.ui.mount({ plugin: 'cache-thermo', surface: 'desktop', ...BAND })
    expect(await ui.find({ text: /ctx|on a break/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('pixel art', () => {
  test('desktop and VS Code draw the SVG art in every band view, the terminal and mobile draw none', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    world(on)
    await answered($)
    const svgs = async (surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'): Promise<number> => {
      const ui = await $.ui.mount({ plugin: 'cache-thermo', surface, ...BAND })
      const n = (await ui.findAll({ type: 'Svg' })).length
      await ui.unmount()
      return n
    }
    // The thermometer.
    expect(await svgs('vscode')).toBe(1)
    expect(await svgs('desktop')).toBe(1)
    expect(await svgs('terminal')).toBe(0)
    expect(await svgs('mobile')).toBe(0)
    // Ember by the campfire.
    await $.command.run({ command: 'cache-thermo', args: 'break', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(await svgs('vscode')).toBe(1)
    expect(await svgs('terminal')).toBe(0)
    await $.command.run({ command: 'cache-thermo', args: 'resume', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    // Frostbit at the gate.
    await clock.advance(2 * HOUR)
    await $.prompt.submit({ text: 'expensive question', wait: false, origin: { kind: 'composer' } })
    expect(await svgs('vscode')).toBe(1)
    expect(await svgs('terminal')).toBe(0)
  })
})

describe('break mode', () => {
  test('the band button starts and ends a break without the command dispatch', async ($, on) => {
    mock.clock(on, { now: T0 })
    const w = world(on)
    await answered($)
    const ui = await $.ui.mount({ plugin: 'cache-thermo', surface: 'desktop', ...BAND })
    await ui.press({ key: 'break' })
    const again = await $.ui.mount({ plugin: 'cache-thermo', surface: 'desktop', ...BAND })
    expect(await again.find({ text: /on a break/ })).toBeDefined()
    await again.press({ key: 'resume' })
    const after = await $.ui.mount({ plugin: 'cache-thermo', surface: 'terminal', ...BAND })
    expect(await after.find({ text: /on a break/ })).toBeUndefined()
    expect(w.toasts.some(x => x.includes('Back from the break'))).toBe(true)
    await after.unmount()
    await again.unmount()
    await ui.unmount()
  })

  test('keeps the cache warm with a fork before the TTL lapses and resumes on a prompt', async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true })
    await answered($)
    const out = await $.command.run({ command: 'cache-thermo', args: 'break', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(out.text).toContain('break')

    // 1h TTL, 90 s lead: the refresh fires at 58:30.
    await clock.advance(58 * 60_000)
    expect(w.forks).toBe(0)
    await clock.advance(60_000)
    expect(w.forks).toBe(1)

    const ui = await $.ui.mount({ plugin: 'cache-thermo', surface: 'desktop', ...BAND })
    expect(await ui.find({ text: /on a break/ })).toBeDefined()
    expect(await ui.find({ text: /1 nudge/ })).toBeDefined()
    await ui.unmount()

    // Another hour: a second refresh, still no cold transition.
    await clock.advance(60 * 60_000)
    expect(w.forks).toBe(2)
    expect(w.toasts.some(t => t.includes('Cache is cold'))).toBe(false)

    // Typing a prompt ends the break; the prompt itself is not gated (the cache is warm).
    const r = await $.prompt.submit({ text: 'back!', wait: false, origin: { kind: 'composer' } })
    expect(r).toMatchObject({ text: 'back!' })
    expect(w.toasts.some(t => t.includes('Back from the break'))).toBe(true)
  })

  test('stops keeping warm after maxBreakHours', { options: { maxBreakHours: 1 } }, async ($, on) => {
    const clock = mock.clock(on, { now: T0 })
    const w = world(on)
    await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true })
    await answered($)
    await $.command.run({ command: 'cache-thermo', args: 'break', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    await clock.advance(59 * 60_000)
    expect(w.forks).toBe(1)
    await clock.advance(3 * 60_000)
    expect(w.toasts.some(t => t.includes('letting the cache cool'))).toBe(true)
  })
})
