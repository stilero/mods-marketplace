// Engine tests for agent-den: the hooks, the ticker, the command and both panes, on every surface.
// The world() hooks stand for the engine beneath the mod and answer from memory; the clock is mocked,
// so `clock.advance(1000)` runs two ticks (the first one polls the agent list).
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, SessionMessage } from 'claude-code'

const T0 = 1_700_000_000_000

type World = {
  agents: AgentInfo[]
  messages: Record<string, SessionMessage[] | { deny: string }>
  /** Every ui.open, in order (an id once for each open). */
  opens: string[]
  /** The panes open now. */
  open: string[]
  /** Open panes that ui.panes lists as waiting undrawn (isPlaced false). */
  unplaced: string[]
  closed: string[]
  toasts: string[]
  statuses: (string | undefined)[]
  views: string[]
  /** The agent ids that session.messages was asked for. */
  reads: string[]
  /** A tool call whose tool_use_id is here waits for that promise before it answers. */
  holds: Record<string, Promise<void>>
}

/** The engine beneath the plugin, answered from memory. */
function world(on: On): World {
  const w: World = { agents: [], messages: {}, opens: [], open: [], unplaced: [], closed: [], toasts: [], statuses: [], views: [], reads: [], holds: {} }
  mock.store(on)
  on('agent.list', () => ({ value: w.agents.map(a => ({ ...a })) }))
  on('session.messages', ($, e) => {
    w.reads.push(e.agentId ?? '')
    return { value: w.messages[e.agentId ?? ''] ?? [] }
  })
  on('ui.open', ($, e) => {
    w.opens.push(e.id)
    if (!w.open.includes(e.id)) w.open.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    w.open = w.open.filter(id => id !== e.id)
    w.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: w.open.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: !w.unplaced.includes(id) })),
  }))
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.view', ($, e) => {
    w.views.push(e.agentId ?? '')
    return { value: {} }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: '' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('tool.call', async ($, e) => {
    await w.holds[e.tool_use_id]
    return { result: {}, text: 'line one\nline two\nline three' }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  return w
}

async function boot($: Engine, on: On) {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on)
  await $.session.start({ cwd: '/tmp/x', surface: 'terminal', isInteractive: true })
  return { clock, w }
}

const DEN = {
  plugin: 'agent-den',
  component: 'Pane',
  requestId: 'agent-den',
  props: { title: 'Agent den', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const LOG = { ...DEN, requestId: 'agent-den-log', props: { ...DEN.props, title: 'Log' } } as const

const agent = (id: string, type: string, description: string, status: AgentInfo['status'] = 'running'): AgentInfo => ({ id, type, description, status })

const run = ($: Engine, args: string) =>
  $.command.run({ command: 'agent-den', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

const count = (list: readonly string[], id: string): number => list.filter(x => x === id).length

describe('den', () => {
  test('a listed agent shows after one tick; the den opens one time', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    expect(count(w.opens, 'agent-den')).toBe(1)
    expect(w.statuses).toContain('🐾 1 busy')
    const ui = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await ui.find({ key: 'open-a1' })).toBeDefined()
    expect((await ui.find({ key: 'open-a1' }))?.text).toContain('Digby')
    await ui.unmount()
    w.agents.push(agent('a2', 'Plan', 'Plan the rewrite'))
    await clock.advance(1000)
    expect(count(w.opens, 'agent-den')).toBe(1)
    const after = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect((await after.find({ key: 'open-a2' }))?.text).toContain('Bricks')
    await after.unmount()
  })

  test('hide closes the den, and it stays hidden until /agent-den show', async ($, on) => {
    const { clock, w } = await boot($, on)
    // Hidden before the first agent: only isDenHidden can stop the auto-open.
    const empty = await $.ui.mount({ ...DEN, surface: 'terminal' })
    await empty.press({ key: 'hide' })
    await clock.settle()
    await empty.unmount()
    expect(w.closed).toContain('agent-den')
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    expect(count(w.opens, 'agent-den')).toBe(0)
    const said = await run($, 'show')
    expect(said.text).toContain('shown')
    expect(count(w.opens, 'agent-den')).toBe(1)

    const ui = await $.ui.mount({ ...DEN, surface: 'desktop' })
    await ui.press({ key: 'hide' })
    await clock.settle()
    await ui.unmount()
    w.agents.push(agent('a2', 'Plan', 'Plan the rewrite'))
    await clock.advance(1000)
    expect(count(w.opens, 'agent-den')).toBe(1)
  })

  test('a subagent tool call sets the current tool and adds log lines; a main-loop call does not', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    const sub = { tool: 'Read' as const, tool_use_id: 'u1', file_path: 'src/a.ts', agentId: 'a1' }
    await $.tool.call(sub)
    await $.tool.call({ tool: 'Read', tool_use_id: 'u2', file_path: 'src/b.ts' })
    const den = await $.ui.mount({ ...DEN, surface: 'terminal' })
    // Both calls ran to the end: the card no longer shows a tool in flight.
    expect(await den.find({ text: /thinking…/ })).toBeDefined()
    expect(await den.find({ text: /Read a\.ts/ })).toBeUndefined()
    expect(await den.find({ text: /b\.ts/ })).toBeUndefined()
    await den.press({ key: 'open-a1' })
    await clock.settle()
    await den.unmount()
    await clock.advance(1000)
    const log = await $.ui.mount({ ...LOG, surface: 'terminal' })
    expect(await log.find({ text: '▸ Read a.ts' })).toBeDefined()
    expect(await log.find({ text: '  line one' })).toBeDefined()
    expect(await log.find({ text: '  line three' })).toBeUndefined()
    expect(await log.find({ text: /b\.ts/ })).toBeUndefined()
    await log.unmount()
  })

  test('a tool call in flight shows on the card until it ends', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    let release: () => void = () => {}
    // Holds this one call beneath the mod until the test lets it go.
    w.holds.held = new Promise<void>(resolve => {
      release = resolve
    })
    // agentId is not in Read's typed input: a variable skips the literal check, as `sub` above does.
    const held = { tool: 'Read' as const, tool_use_id: 'held', file_path: 'src/a.ts', agentId: 'a1' }
    const call = $.tool.call(held)
    await clock.settle()
    const during = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await during.find({ text: /Read a\.ts/ })).toBeDefined()
    expect(await during.find({ text: /thinking…/ })).toBeUndefined()
    await during.unmount()
    release()
    await call
    const after = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await after.find({ text: /Read a\.ts/ })).toBeUndefined()
    expect(await after.find({ text: /thinking…/ })).toBeDefined()
    await after.unmount()
  })

  test('a log read takes the tool in flight from the transcript, and drops it when its result is in', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    const brief = { role: 'user' as const, text: 'Find the auth code', toolUses: [] }
    w.messages.a1 = [brief, { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'x1', tool: 'Grep', input: { pattern: 'auth' } }] }]
    await clock.advance(3000)
    const during = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await during.find({ text: /Grep auth/ })).toBeDefined()
    await during.unmount()
    w.messages.a1 = [
      brief,
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'x1', tool: 'Grep', input: { pattern: 'auth' }, text: 'src/auth.ts:1: export function auth()' }] },
      { role: 'assistant', text: 'Found it in src/auth.ts.', toolUses: [] },
    ]
    await clock.advance(3000)
    const after = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await after.find({ text: /Grep auth/ })).toBeUndefined()
    expect(await after.find({ text: /thinking…/ })).toBeDefined()
    await after.unmount()
  })

  test('an agent that drops out of the list after its answer ends as done', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a1' })
    await $.turn.complete({ answer: 'All done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    w.agents = []
    await clock.advance(1000)
    const ui = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await ui.find({ text: /✓ done/ })).toBeDefined()
    expect(await ui.find({ text: /All done/ })).toBeDefined()
    await ui.unmount()
    expect(w.statuses).toContain('🐾 1 done')
  })

  test('the den draws an Svg for each card on GUI surfaces and none in the terminal', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'), agent('a2', 'Plan', 'Plan the rewrite', 'idle'))
    await clock.advance(1000)
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...DEN, surface })
      const svgs = await ui.findAll({ type: 'Svg' })
      expect(svgs).toHaveLength(surface === 'terminal' ? 0 : 2)
      // With the default `full`, a busy buddy animates (the `off` test below checks the opposite).
      for (const s of svgs) expect(String(s.props.source)).toContain('<animate')
      expect(await ui.find({ key: 'open-a1' })).toBeDefined()
      expect(await ui.find({ key: 'open-a2' })).toBeDefined()
      expect(await ui.find({ key: 'hide' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a control character in an agent description does not blank the GUI den', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find\u0007 the auth code'))
    await clock.advance(1000)
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...DEN, surface })
      expect(await ui.findAll({ type: 'Svg' })).toHaveLength(1)
      expect(await ui.find({ key: 'open-a1' })).toBeDefined()
      await ui.unmount()
    }
    await run($, 'log 1')
    const log = await $.ui.mount({ ...LOG, surface: 'desktop' })
    expect(await log.find({ key: 'close' })).toBeDefined()
    await log.unmount()
  })

  test('the empty den offers the demo on every surface', async ($, on) => {
    const { clock, w } = await boot($, on)
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...DEN, surface })
      expect(await ui.find({ text: /No buddies out yet/ })).toBeDefined()
      expect(await ui.findAll({ type: 'Svg' })).toHaveLength(surface === 'terminal' ? 0 : 1)
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...DEN, surface: 'terminal' })
    await ui.press({ key: 'demo' })
    await clock.settle()
    await ui.unmount()
    expect(count(w.opens, 'agent-den')).toBe(1)
    const after = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await after.find({ key: 'open-demo-running' })).toBeDefined()
    await after.unmount()
  })

  test('/agent-den toggles: a den that waits undrawn is opened, not closed', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    expect(count(w.opens, 'agent-den')).toBe(1)
    w.unplaced.push('agent-den')
    expect((await run($, '')).text).toContain('shown')
    expect(w.closed).not.toContain('agent-den')
    expect(count(w.opens, 'agent-den')).toBe(2)
    w.unplaced = []
    expect((await run($, '')).text).toContain('hidden')
    expect(w.closed).toContain('agent-den')
    // Hidden: a new agent does not open it again.
    w.agents.push(agent('a2', 'Plan', 'Plan the rewrite'))
    await clock.advance(1000)
    expect(count(w.opens, 'agent-den')).toBe(2)
  })

  test('/agent-den demo shows seven cards; /agent-den clear removes every demo buddy', async ($, on) => {
    const { clock, w } = await boot($, on)
    const said = await run($, 'demo')
    expect(said.text).toContain('Seven demo buddies')
    expect(count(w.opens, 'agent-den')).toBe(1)
    const statuses = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed'] as const
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...DEN, surface })
      for (const s of statuses) expect(await ui.find({ key: `open-demo-${s}` })).toBeDefined()
      expect(await ui.findAll({ type: 'Svg' })).toHaveLength(surface === 'terminal' ? 0 : 7)
      await ui.unmount()
    }
    expect((await run($, 'clear')).text).toContain('Cleared 7')
    expect((await run($, 'clear')).text).toContain('No finished or demo buddies')
    await clock.advance(1000)
    const ui = await $.ui.mount({ ...DEN, surface: 'terminal' })
    for (const s of statuses) expect(await ui.find({ key: `open-demo-${s}` })).toBeUndefined()
    expect(await ui.find({ text: /No buddies out yet/ })).toBeDefined()
    await ui.unmount()
    // The status line is gone, and the demo's Digby no longer holds the Explore buddy.
    expect(w.statuses[w.statuses.length - 1]).toBeUndefined()
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    const after = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect((await after.find({ key: 'open-a1' }))?.text).toContain('Digby')
    await after.unmount()
  })

  test('a real agent gets its own buddy while the demo is on screen', async ($, on) => {
    const { clock, w } = await boot($, on)
    await run($, 'demo')
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    const ui = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect((await ui.find({ key: 'open-a1' }))?.text).toContain('Digby')
    await ui.unmount()
  })

  test('the demo buddies leave by themselves after keepFinishedMinutes', async ($, on) => {
    const { clock, w } = await boot($, on)
    await run($, 'demo')
    await clock.advance(1000)
    expect(w.statuses[w.statuses.length - 1]).toBeDefined()
    await clock.advance(10 * 60_000 + 1000)
    const ui = await $.ui.mount({ ...DEN, surface: 'terminal' })
    for (const s of ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed'] as const) {
      expect(await ui.find({ key: `open-demo-${s}` })).toBeUndefined()
    }
    expect(await ui.find({ text: /No buddies out yet/ })).toBeDefined()
    await ui.unmount()
    expect(w.statuses[w.statuses.length - 1]).toBeUndefined()
  })

  test('session.end with clear drops the ended rows and the demo rows', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'), agent('a2', 'Plan', 'Plan the rewrite'))
    await clock.advance(1000)
    await run($, 'demo')
    await $.turn.start({ text: 'go', turnId: 't1', agentId: 'a2' })
    await $.turn.complete({ answer: 'Planned.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a2' })
    w.agents = [agent('a1', 'Explore', 'Find the auth code'), agent('a2', 'Plan', 'Plan the rewrite', 'completed')]
    await clock.advance(1000)
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    // The list still names a2 as completed: the next poll must not bring it back, nor open the den again.
    const opens = count(w.opens, 'agent-den')
    await clock.advance(1000)
    expect(count(w.opens, 'agent-den')).toBe(opens)
    const ui = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await ui.find({ key: 'open-a1' })).toBeDefined()
    expect(await ui.find({ key: 'open-a2' })).toBeUndefined()
    expect(await ui.find({ key: 'open-demo-running' })).toBeUndefined()
    expect(await ui.find({ key: 'open-demo-completed' })).toBeUndefined()
    expect(await ui.find({ key: 'open-demo-failed' })).toBeUndefined()
    await ui.unmount()
    expect(w.reads.some(id => id.startsWith('demo-'))).toBe(false)
  })

  test('an agent first listed as ended gets no card and does not open the den', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('old', 'Explore', 'An old run', 'completed'))
    await clock.advance(1000)
    expect(count(w.opens, 'agent-den')).toBe(0)
    const ui = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await ui.find({ key: 'open-old' })).toBeUndefined()
    await ui.unmount()
  })

  test('an unknown command gives the usage', async ($, on) => {
    await boot($, on)
    expect((await run($, 'dance')).text).toContain('Usage')
  })
})

describe('log pane', () => {
  test('a press on a card opens the output; view, close and back work', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    w.messages.a1 = [
      { role: 'user', text: 'Find the auth code', toolUses: [] },
      {
        role: 'assistant',
        text: 'Looking for it now.',
        toolUses: [{ tool_use_id: 'x1', tool: 'Grep', input: { pattern: 'auth' }, text: 'src/auth.ts:1: export function auth()' }],
      },
    ]
    await clock.advance(1000)
    for (const surface of ['terminal', 'desktop'] as const) {
      const den = await $.ui.mount({ ...DEN, surface })
      await den.press({ key: 'open-a1' })
      await clock.settle()
      await den.unmount()
      expect(count(w.opens, 'agent-den-log')).toBe(surface === 'terminal' ? 1 : 2)
    }
    await clock.advance(1000)
    const term = await $.ui.mount({ ...LOG, surface: 'terminal' })
    expect(await term.find({ text: '▸ Grep auth' })).toBeDefined()
    expect(await term.find({ text: 'brief: Find the auth code' })).toBeDefined()
    await term.unmount()

    const gui = await $.ui.mount({ ...LOG, surface: 'desktop' })
    expect((await gui.find({ type: 'Code' }))?.text).toContain('▸ Grep auth')
    expect(await gui.findAll({ type: 'Svg' })).toHaveLength(1)
    await gui.press({ key: 'view' })
    await clock.settle()
    expect(w.views).toEqual(['a1'])
    await gui.press({ key: 'close' })
    await clock.settle()
    await gui.unmount()
    expect(w.closed).toContain('agent-den-log')

    const none = await $.ui.mount({ ...LOG, surface: 'terminal' })
    expect(await none.find({ text: /Pick a buddy/ })).toBeDefined()
    await none.unmount()

    const den = await $.ui.mount({ ...DEN, surface: 'terminal' })
    await den.press({ key: 'open-a1' })
    await clock.settle()
    await den.unmount()
    const before = count(w.opens, 'agent-den')
    const log = await $.ui.mount({ ...LOG, surface: 'terminal' })
    await log.press({ key: 'back' })
    await clock.settle()
    await log.unmount()
    expect(count(w.opens, 'agent-den')).toBe(before + 1)
    expect(count(w.closed, 'agent-den-log')).toBe(2)
  })

  test('/agent-den log 1 and log <name> open the log pane', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'), agent('a2', 'Plan', 'Plan the rewrite'))
    await clock.advance(1000)
    expect((await run($, 'log 1')).text).toContain('Digby')
    expect(count(w.opens, 'agent-den-log')).toBe(1)
    expect((await run($, 'log Bricks')).text).toContain('Bricks')
    expect((await run($, 'log rewrite')).text).toContain('Bricks')
    expect((await run($, 'log 9')).text).toContain('no buddy matches')
    expect(count(w.opens, 'agent-den-log')).toBe(3)
  })

  test('a workflow agent gets a row from its brief, is never read, and has no transcript button', async ($, on) => {
    const { clock, w } = await boot($, on)
    await $.turn.start({ text: 'Migrate the users table\nThen check the indexes.', turnId: 'w1', agentId: 'wf1' })
    expect(count(w.opens, 'agent-den')).toBe(1)
    const den = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect((await den.find({ key: 'open-wf1' }))?.text).toContain('Migrate the users table')
    expect((await den.find({ key: 'open-wf1' }))?.text).toContain('Mochi')
    expect(await den.find({ text: /workflow/ })).toBeDefined()
    await den.press({ key: 'open-wf1' })
    await clock.settle()
    await den.unmount()
    await clock.advance(5000)
    expect(w.reads).not.toContain('wf1')
    const log = await $.ui.mount({ ...LOG, surface: 'terminal' })
    expect(await log.find({ key: 'view' })).toBeUndefined()
    expect(await log.find({ key: 'back' })).toBeDefined()
    expect(await log.find({ text: 'brief: Migrate the users table' })).toBeDefined()
    await log.unmount()
    await $.turn.complete({ answer: 'Migrated.', durationMs: 5, isAborted: false, turnId: 'w1', reason: 'answer', agentId: 'wf1' })
    const after = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await after.find({ text: /✓ done/ })).toBeDefined()
    await after.unmount()
  })

  test('an engine fork (unlisted id, no brief) makes no row and does not open the den', async ($, on) => {
    const { clock, w } = await boot($, on)
    const fork = { tool: 'Write' as const, tool_use_id: 'f1', file_path: '/m/memory.md', content: 'x', agentId: 'fork-xyz' }
    await $.tool.call(fork)
    await $.turn.start({ text: '', turnId: 'ft', agentId: 'fork-xyz' })
    await clock.advance(2000)
    expect(count(w.opens, 'agent-den')).toBe(0)
    expect(w.statuses.filter(s => s !== undefined)).toEqual([])
    const den = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await den.find({ key: 'open-fork-xyz' })).toBeUndefined()
    await den.unmount()
  })

  test('a listed agent whose first event is a tool call still gets a row', async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a9', 'Explore', 'Find it'))
    const sub = { tool: 'Read' as const, tool_use_id: 'u9', file_path: 'src/a.ts', agentId: 'a9' }
    await $.tool.call(sub)
    expect(count(w.opens, 'agent-den')).toBe(1)
    await clock.advance(1000)
    const den = await $.ui.mount({ ...DEN, surface: 'terminal' })
    expect(await den.find({ key: 'open-a9' })).toBeDefined()
    await den.unmount()
  })

  test('a workflow row that misses turn.complete ends after keepFinishedMinutes with no event', async ($, on) => {
    const { clock, w } = await boot($, on)
    await $.turn.start({ text: 'Migrate the users table', turnId: 'w1', agentId: 'wf1' })
    const call = { tool: 'Read' as const, tool_use_id: 'r1', file_path: 'src/a.ts', agentId: 'wf1' }
    await $.tool.call(call)
    await clock.advance(9 * 60_000)
    expect(w.statuses.at(-1)).toContain('busy')
    await clock.advance(2 * 60_000)
    expect(w.statuses.at(-1)).toContain('done')
    await $.tool.call({ ...call, tool_use_id: 'r2' })
    expect(w.statuses.length).toBeGreaterThan(0)
  })

  test('a tool call in flight keeps an unlisted row live past keepFinishedMinutes', { options: { keepFinishedMinutes: 0.5 } }, async ($, on) => {
    const { clock, w } = await boot($, on)
    await $.turn.start({ text: 'Long job', turnId: 'w1', agentId: 'wf2' })
    let release: () => void = () => {}
    w.holds.long = new Promise<void>(resolve => { release = resolve })
    const held = { tool: 'Read' as const, tool_use_id: 'long', file_path: 'a.ts', agentId: 'wf2' }
    const p = $.tool.call(held)
    await clock.settle()
    await clock.advance(60_000)
    expect(w.statuses.at(-1)).toContain('busy')
    release()
    await p
    await clock.advance(20_000)
    expect(w.statuses.at(-1)).toContain('busy')
    await clock.advance(15_000)
    expect(w.statuses.at(-1)).toContain('done')
  })

  test('a demo buddy has no transcript: the button shows a toast', async ($, on) => {
    const { clock, w } = await boot($, on)
    await run($, 'demo')
    await run($, 'log 2')
    const log = await $.ui.mount({ ...LOG, surface: 'desktop' })
    await log.press({ key: 'view' })
    await clock.settle()
    await log.unmount()
    expect(w.views).toEqual([])
    expect(w.toasts).toContain('This is a demo buddy.')
  })
})

describe('options', () => {
  test('animations off draws static SVGs', { options: { animations: 'off' } }, async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    const ui = await $.ui.mount({ ...DEN, surface: 'desktop' })
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs).toHaveLength(1)
    for (const s of svgs) expect(String(s.props.source)).not.toContain('<animate')
    await ui.unmount()
  })

  test('animations calm still turns the spinner of a busy buddy', { options: { animations: 'calm' } }, async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    const seen = new Set<string>()
    for (let i = 0; i < 4; i++) {
      await clock.advance(500)
      const ui = await $.ui.mount({ ...DEN, surface: 'terminal' })
      // Only the spinner glyph: the elapsed time on the card changes each second anyway.
      const text = (await ui.find({ text: /thinking…/ }))?.text ?? ''
      seen.add(/(\S) thinking…/.exec(text)?.[1] ?? '')
      await ui.unmount()
    }
    expect(seen.has('')).toBe(false)
    expect(seen.size).toBeGreaterThan(1)
  })

  test('autoOpen off never opens the den by itself', { options: { autoOpen: false } }, async ($, on) => {
    const { clock, w } = await boot($, on)
    w.agents.push(agent('a1', 'Explore', 'Find the auth code'))
    await clock.advance(1000)
    expect(count(w.opens, 'agent-den')).toBe(0)
  })
})
