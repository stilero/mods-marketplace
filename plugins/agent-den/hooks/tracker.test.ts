import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, BuddyRef, DenStatus, LogLine } from '../types'
import {
  animKey,
  asciiFrameFor,
  cleanText,
  closeEffect,
  currentFromMessages,
  DEMO_PREFIX,
  demoState,
  dropEnded,
  elapsedOf,
  ensureRow,
  expire,
  firstLine,
  formatElapsed,
  isEnded,
  isLive,
  liveBuddies,
  messagesToLog,
  onToolStart,
  onTurnComplete,
  onTurnStart,
  resultLines,
  sameLog,
  summary,
  toolLabel,
  treeOrder,
  upsertListed,
} from './tracker'
import type { ListedAgent, PickFn } from './tracker'

const T0 = 1_000_000

// A pick that shows what it was given: key from the type, variant = how many buddies were taken.
const pick: PickFn = (type, taken) => ({ key: 'k-' + type.toLowerCase(), variant: taken.length })

const row = (over: Partial<AgentRow> & { id: string }): AgentRow => ({
  description: 'task',
  type: 'Explore',
  buddy: { key: 'digby', variant: 0 },
  status: 'running',
  statusSince: T0,
  startedAt: T0,
  toolCount: 0,
  turnCount: 0,
  isListed: true,
  ...over,
})

const listed = (over: Partial<ListedAgent> & { id: string }): ListedAgent => ({
  description: 'task',
  type: 'Explore',
  status: 'running',
  ...over,
})

const hasUndefined = (r: object): boolean => Object.values(r).includes(undefined)

describe('isLive and isEnded', () => {
  test('split the seven statuses', async () => {
    const all: DenStatus[] = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed']
    expect(all.filter(isLive)).toEqual(['pending', 'running', 'waiting', 'idle'])
    expect(all.filter(isEnded)).toEqual(['completed', 'failed', 'killed'])
  })
})

describe('cleanText', () => {
  test('removes ESC and other control characters, keeps newlines, turns a tab into 2 spaces', async () => {
    expect(cleanText('\u001b[31mred\u001b[0m')).toBe('[31mred[0m')
    expect(cleanText('a\tb')).toBe('a  b')
    expect(cleanText('one\ntwo')).toBe('one\ntwo')
    expect(cleanText('a\u0000b\u0007c\u007fd\u009be\rf')).toBe('abcdef')
  })
})

describe('firstLine', () => {
  test('takes the first non-empty line, trimmed and collapsed', async () => {
    expect(firstLine('\n\n   hello    world  \nsecond', 80)).toBe('hello world')
    expect(firstLine('', 80)).toBe('')
    expect(firstLine('  \n \t \n', 80)).toBe('')
  })
  test('cuts by code points and ends a cut line with …', async () => {
    expect(firstLine('abcdefgh', 5)).toBe('abcd…')
    expect(firstLine('abcde', 5)).toBe('abcde')
    // An emoji at the cut is never split into a lone surrogate.
    const out = firstLine('ab😀😀😀', 4)
    expect(out).toBe('ab😀…')
    expect([...out]).toHaveLength(4)
    expect(out.includes('�')).toBe(false)
  })
  test('a tab and a control character do not reach the result', async () => {
    expect(firstLine('a\tb', 80)).toBe('a b')
    expect(firstLine('\u001bx\u0007y', 80)).toBe('xy')
  })
})

describe('upsertListed', () => {
  test('a new id gives a listed row at the end of the order', async () => {
    const r = upsertListed({}, [], [listed({ id: 'a', name: 'scout', parentId: 'p' })], T0, pick)
    expect(r.changed).toBe(true)
    expect(r.added).toEqual(['a'])
    expect(r.order).toEqual(['a'])
    expect(r.agents.a).toEqual({
      id: 'a',
      description: 'task',
      type: 'Explore',
      name: 'scout',
      parentId: 'p',
      buddy: { key: 'k-explore', variant: 0 },
      status: 'running',
      statusSince: T0,
      startedAt: T0,
      toolCount: 0,
      turnCount: 0,
      isListed: true,
    })
  })
  test('a second new row in the same call sees the first one as taken', async () => {
    const agents = { x: row({ id: 'x' }), y: row({ id: 'y', status: 'completed', endedAt: T0 }) }
    const r = upsertListed(agents, ['x', 'y'], [listed({ id: 'x' }), listed({ id: 'y', status: 'completed' }), listed({ id: 'a' }), listed({ id: 'b' })], T0, pick)
    // x is live (1 taken); a adds one more for b. The ended y is not taken.
    expect(r.agents.a?.buddy.variant).toBe(1)
    expect(r.agents.b?.buddy.variant).toBe(2)
    expect(r.added).toEqual(['a', 'b'])
    expect(r.order).toEqual(['x', 'y', 'a', 'b'])
  })
  test('an ended agent with no row gets no row', async () => {
    for (const status of ['completed', 'failed', 'killed'] as const) {
      const r = upsertListed({}, [], [listed({ id: 'a', status })], T0, pick)
      expect(r.agents.a).toBeUndefined()
      expect(r.added).toEqual([])
      expect(r.order).toEqual([])
      expect(r.changed).toBe(false)
    }
  })
  test('a row that dropEnded removed does not come back while the list still names it as ended', async () => {
    const agents = { x: row({ id: 'x' }), y: row({ id: 'y', status: 'completed', endedAt: T0 }) }
    const cleared = dropEnded(agents, ['x', 'y'], {})
    const r = upsertListed(cleared.agents, cleared.order, [listed({ id: 'x' }), listed({ id: 'y', status: 'completed' })], T0 + 1_000, pick)
    expect(r.agents.y).toBeUndefined()
    expect(r.added).toEqual([])
    expect(r.order).toEqual(['x'])
  })
  test('a removed id that the list names as live again gets a new row', async () => {
    const agents = { y: row({ id: 'y', status: 'completed', endedAt: T0 }) }
    const cleared = dropEnded(agents, ['y'], {})
    const r = upsertListed(cleared.agents, cleared.order, [listed({ id: 'y', status: 'running' })], T0 + 1_000, pick)
    expect(r.agents.y?.status).toBe('running')
    expect(r.agents.y?.endedAt).toBeUndefined()
    expect(r.added).toEqual(['y'])
    expect(r.order).toEqual(['y'])
  })
  test('a status change sets statusSince; an end sets endedAt and keeps an earlier one', async () => {
    const agents = { a: row({ id: 'a', status: 'pending' }) }
    const r1 = upsertListed(agents, ['a'], [listed({ id: 'a', status: 'running' })], T0 + 100, pick)
    expect(r1.changed).toBe(true)
    expect(r1.added).toEqual([])
    expect(r1.agents.a?.status).toBe('running')
    expect(r1.agents.a?.statusSince).toBe(T0 + 100)
    const r2 = upsertListed(r1.agents, r1.order, [listed({ id: 'a', status: 'completed' })], T0 + 200, pick)
    expect(r2.agents.a?.endedAt).toBe(T0 + 200)
    const r3 = upsertListed(r2.agents, r2.order, [listed({ id: 'a', status: 'failed' })], T0 + 300, pick)
    expect(r3.agents.a?.status).toBe('failed')
    expect(r3.agents.a?.endedAt).toBe(T0 + 200)
    expect(r3.agents.a?.statusSince).toBe(T0 + 300)
  })
  test('the same status gives no change and returns the inputs', async () => {
    const agents = { a: row({ id: 'a' }) }
    const order = ['a']
    const r = upsertListed(agents, order, [listed({ id: 'a' })], T0 + 5_000, pick)
    expect(r.changed).toBe(false)
    expect(r.agents).toBe(agents)
    expect(r.order).toBe(order)
  })
  test('description, type, name and parentId follow the list', async () => {
    const agents = { a: row({ id: 'a', name: 'old', parentId: 'p' }) }
    const r = upsertListed(agents, ['a'], [listed({ id: 'a', description: 'new', type: 'Plan', name: 'fresh' })], T0, pick)
    expect(r.changed).toBe(true)
    expect(r.agents.a?.description).toBe('new')
    expect(r.agents.a?.type).toBe('Plan')
    expect(r.agents.a?.name).toBe('fresh')
    expect('parentId' in (r.agents.a ?? {})).toBe(false)
    // The buddy of a listed row is never picked again.
    expect(r.agents.a?.buddy).toEqual({ key: 'digby', variant: 0 })
  })
  test('an ended row that goes live again loses endedAt', async () => {
    const ended = { a: row({ id: 'a', status: 'completed', endedAt: T0 }) }
    const r = upsertListed(ended, ['a'], [listed({ id: 'a', status: 'running' })], T0 + 50, pick)
    expect(r.agents.a?.status).toBe('running')
    expect(r.agents.a?.statusSince).toBe(T0 + 50)
    expect('endedAt' in (r.agents.a ?? {})).toBe(false)
    expect(hasUndefined(r.agents.a ?? {})).toBe(false)
    expect(ended.a.endedAt).toBe(T0)
  })
  test('a dropped live row ends by its lastReason', async () => {
    const cases: [AgentRow['lastReason'], DenStatus][] = [
      [undefined, 'completed'],
      ['answer', 'completed'],
      ['error', 'failed'],
      ['refusal', 'failed'],
      ['aborted', 'killed'],
    ]
    for (const [reason, status] of cases) {
      const base = row({ id: 'a', statusSince: T0 - 10 })
      if (reason !== undefined) base.lastReason = reason
      const r = upsertListed({ a: base }, ['a'], [], T0 + 9, pick)
      expect(r.changed).toBe(true)
      expect(r.agents.a?.status).toBe(status)
      expect(r.agents.a?.endedAt).toBe(T0 + 9)
      expect(r.agents.a?.statusSince).toBe(T0 + 9)
      expect(r.agents.a?.isListed).toBe(false)
      expect(hasUndefined(r.agents.a ?? {})).toBe(false)
    }
  })
  test('a dropped ended row keeps its status and endedAt', async () => {
    const r = upsertListed({ a: row({ id: 'a', status: 'failed', endedAt: T0 }) }, ['a'], [], T0 + 9, pick)
    expect(r.agents.a?.status).toBe('failed')
    expect(r.agents.a?.endedAt).toBe(T0)
    expect(r.agents.a?.isListed).toBe(false)
  })
  test('unlisted rows (demo, workflow) that the list does not name do not change', async () => {
    const demo = demoState(T0)
    const r = upsertListed(demo.agents, demo.order, [], T0 + 60_000, pick)
    expect(r.changed).toBe(false)
    expect(r.agents).toBe(demo.agents)
    const wf = { w: row({ id: 'w', type: 'workflow', isListed: false }) }
    expect(upsertListed(wf, ['w'], [listed({ id: 'other' })], T0, pick).agents.w).toBe(wf.w)
  })
  test('a workflow row that the list names later gets the listed type and a new buddy', async () => {
    const agents = {
      x: row({ id: 'x' }),
      w: row({ id: 'w', type: 'workflow', isListed: false, buddy: { key: 'mochi', variant: 0 } }),
    }
    const r = upsertListed(agents, ['x', 'w'], [listed({ id: 'x' }), listed({ id: 'w', type: 'Plan' })], T0, pick)
    expect(r.changed).toBe(true)
    expect(r.agents.w?.type).toBe('Plan')
    expect(r.agents.w?.isListed).toBe(true)
    // Taken: only x (w's own buddy does not count against it).
    expect(r.agents.w?.buddy).toEqual({ key: 'k-plan', variant: 1 })
    // Picked one time: a second poll keeps it.
    const r2 = upsertListed(r.agents, r.order, [listed({ id: 'x' }), listed({ id: 'w', type: 'Plan' })], T0 + 1, pick)
    expect(r2.changed).toBe(false)
  })
  test('the inputs do not change', async () => {
    const agents = { a: row({ id: 'a', lastReason: 'error' }), b: row({ id: 'b', status: 'pending' }) }
    const order = ['a', 'b']
    const list = [listed({ id: 'b', status: 'running' }), listed({ id: 'c' })]
    const before = JSON.stringify({ agents, order, list })
    const r = upsertListed(agents, order, list, T0 + 1, pick)
    expect(JSON.stringify({ agents, order, list })).toBe(before)
    expect(r.order).toEqual(['a', 'b', 'c'])
    expect(r.order).not.toBe(order)
    for (const v of Object.values(r.agents)) expect(hasUndefined(v)).toBe(false)
  })
})

describe('engine strings', () => {
  test('upsertListed and ensureRow keep no control characters in the drawn fields', async () => {
    const bad = 'Fix\u0007 the\n\tbuild \u001b[31mnow'
    const r = upsertListed({}, [], [listed({ id: 'a', description: bad, type: 'Ex\u0000plore', name: 'sc\u0007out' })], T0, pick)
    expect(r.agents.a).toMatchObject({ description: 'Fix the build [31mnow', type: 'Explore', name: 'scout' })
    // The same list again changes nothing.
    expect(upsertListed(r.agents, r.order, [listed({ id: 'a', description: bad, type: 'Ex\u0000plore', name: 'sc\u0007out' })], T0, pick).changed).toBe(false)
    const e = ensureRow({}, [], 'b', T0, pick, { type: '\u0007', description: bad, model: 'm\u0007', name: 'n\u0007' })
    expect(e.agents.b).toMatchObject({ description: 'Fix the build [31mnow', type: 'agent', model: 'm', name: 'n' })
    const long = upsertListed({}, [], [listed({ id: 'c', description: 'x'.repeat(500) })], T0, pick)
    expect([...(long.agents.c?.description ?? '')].length).toBe(200)
  })
})

describe('ensureRow', () => {
  test('a new id with no hint is a pending workflow row', async () => {
    const r = ensureRow({ x: row({ id: 'x' }) }, ['x'], 'w', T0, pick)
    expect(r.added).toBe(true)
    expect(r.order).toEqual(['x', 'w'])
    expect(r.agents.w).toEqual({
      id: 'w',
      description: '',
      type: 'workflow',
      buddy: { key: 'k-workflow', variant: 1 },
      status: 'pending',
      statusSince: T0,
      startedAt: T0,
      toolCount: 0,
      turnCount: 0,
      isListed: false,
    })
  })
  test('a hint gives the type, description and the other fields', async () => {
    const r = ensureRow({}, [], 'a', T0, pick, { type: 'Explore', description: 'look', model: 'm', name: 'n', parentId: 'p' })
    expect(r.agents.a).toMatchObject({ type: 'Explore', description: 'look', model: 'm', name: 'n', parentId: 'p', status: 'pending', isListed: false })
    expect(r.agents.a?.buddy.key).toBe('k-explore')
  })
  test('a hint with only some fields leaves the others out', async () => {
    const r = ensureRow({}, [], 'a', T0, pick, { description: 'x' })
    expect(r.agents.a?.type).toBe('workflow')
    expect(hasUndefined(r.agents.a ?? {})).toBe(false)
    expect('model' in (r.agents.a ?? {})).toBe(false)
  })
  test('a known id gives no change', async () => {
    const agents = { a: row({ id: 'a' }) }
    const order = ['a']
    const r = ensureRow(agents, order, 'a', T0, pick, { type: 'Plan' })
    expect(r.added).toBe(false)
    expect(r.agents).toBe(agents)
    expect(r.order).toBe(order)
  })
})

describe('turn and tool events', () => {
  test('onTurnStart: running, one more turn, statusSince only on a change, no endedAt', async () => {
    const a = onTurnStart(row({ id: 'a', status: 'pending', turnCount: 2 }), T0 + 5)
    expect(a.status).toBe('running')
    expect(a.turnCount).toBe(3)
    expect(a.statusSince).toBe(T0 + 5)
    const b = onTurnStart(row({ id: 'b', status: 'running' }), T0 + 5)
    expect(b.statusSince).toBe(T0)
    const c = onTurnStart(row({ id: 'c', status: 'completed', endedAt: T0 }), T0 + 5)
    expect('endedAt' in c).toBe(false)
    expect(hasUndefined(c)).toBe(false)
  })
  test('onTurnComplete on a listed row keeps the status', async () => {
    const r = onTurnComplete(row({ id: 'a', currentTool: 'Read a.ts' }), 'answer', '\n  All done here.  \nmore', T0 + 9)
    expect(r.status).toBe('running')
    expect(r.lastText).toBe('All done here.')
    expect(r.lastReason).toBe('answer')
    expect('currentTool' in r).toBe(false)
    expect(hasUndefined(r)).toBe(false)
  })
  test('onTurnComplete with an empty answer keeps the last text', async () => {
    const r = onTurnComplete(row({ id: 'a', lastText: 'before' }), 'answer', '', T0)
    expect(r.lastText).toBe('before')
  })
  test('onTurnComplete with no reason leaves lastReason out', async () => {
    const r = onTurnComplete(row({ id: 'a', lastReason: 'error' }), undefined, 'x', T0)
    expect('lastReason' in r).toBe(false)
    expect(hasUndefined(r)).toBe(false)
  })
  test('onTurnComplete on an unlisted row ends it by the reason', async () => {
    const cases: [AgentRow['lastReason'], DenStatus][] = [
      ['answer', 'completed'],
      ['error', 'failed'],
      ['refusal', 'failed'],
      ['aborted', 'killed'],
    ]
    for (const [reason, status] of cases) {
      const r = onTurnComplete(row({ id: 'w', isListed: false, type: 'workflow' }), reason, 'ok', T0 + 7)
      expect(r.status).toBe(status)
      expect(r.endedAt).toBe(T0 + 7)
      expect(r.statusSince).toBe(T0 + 7)
    }
  })
  test('onToolStart: current tool, one more tool, running', async () => {
    const r = onToolStart(row({ id: 'a', status: 'idle', toolCount: 4 }), 'Read a.ts', T0 + 3)
    expect(r.currentTool).toBe('Read a.ts')
    expect(r.toolCount).toBe(5)
    expect(r.status).toBe('running')
    expect(r.statusSince).toBe(T0 + 3)
    const s = onToolStart(row({ id: 'b' }), 'Grep x', T0 + 3)
    expect(s.statusSince).toBe(T0)
  })
  test('the event functions do not change the input row', async () => {
    const base = row({ id: 'a', status: 'pending', currentTool: 'x', endedAt: T0 })
    const before = JSON.stringify(base)
    onTurnStart(base, T0 + 1)
    onTurnComplete(base, 'error', 'boom', T0 + 1)
    onToolStart(base, 'y', T0 + 1)
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('toolLabel', () => {
  test('path tools show the basename', async () => {
    expect(toolLabel('Read', { file_path: '/repo/src/a.ts' })).toBe('Read a.ts')
    expect(toolLabel('Edit', { file_path: 'src\\win\\x.ts' })).toBe('Edit x.ts')
    expect(toolLabel('Write', { file_path: 'b.md' })).toBe('Write b.md')
    expect(toolLabel('NotebookEdit', { notebook_path: '/n/book.ipynb' })).toBe('NotebookEdit book.ipynb')
  })
  test('Bash shows the first line of a multi-line command', async () => {
    expect(toolLabel('Bash', { command: '\n  npm test\necho done' })).toBe('Bash npm test')
  })
  test('Grep, Glob, WebSearch, Agent and Skill show their main argument', async () => {
    expect(toolLabel('Grep', { pattern: 'TODO' })).toBe('Grep TODO')
    expect(toolLabel('Glob', { pattern: '**/*.ts' })).toBe('Glob **/*.ts')
    expect(toolLabel('WebSearch', { query: 'pixel art' })).toBe('WebSearch pixel art')
    expect(toolLabel('Agent', { description: 'Find bugs' })).toBe('Agent Find bugs')
    expect(toolLabel('Skill', { skill: 'pdf' })).toBe('Skill pdf')
  })
  test('WebFetch shows the host, and a bad URL gives the tool name', async () => {
    expect(toolLabel('WebFetch', { url: 'https://docs.claude.com/a/b?c=1' })).toBe('WebFetch docs.claude.com')
    expect(toolLabel('WebFetch', { url: 'not a url' })).toBe('WebFetch')
    expect(toolLabel('WebFetch', {})).toBe('WebFetch')
  })
  test('an mcp tool shows server·tool; an unknown tool shows its name', async () => {
    expect(toolLabel('mcp__github__create_issue', { title: 'x' })).toBe('github·create_issue')
    expect(toolLabel('TodoWrite', { todos: [] })).toBe('TodoWrite')
    expect(toolLabel('Read', {})).toBe('Read')
    expect(toolLabel('Read', { file_path: 42 })).toBe('Read')
  })
  test('a long input is cut to 48 code points', async () => {
    const out = toolLabel('Bash', { command: 'echo ' + '😀'.repeat(80) })
    expect([...out]).toHaveLength(48)
    expect(out.endsWith('…')).toBe(true)
    expect(out.includes('�')).toBe(false)
  })
  test('reserved keys never reach a label; control characters are removed', async () => {
    const e = { tool: 'Read', tool_use_id: 'u1', agentId: 'a1', requestMeta: { x: 1 }, consent: 'yes', file_path: 'a.ts' }
    expect(toolLabel('Read', e)).toBe('Read a.ts')
    expect(toolLabel('TodoWrite', e)).toBe('TodoWrite')
    expect(toolLabel('Grep', { pattern: 'a\u001b[2Jb\tc' })).toBe('Grep a[2Jb c')
  })
})

type Msg = Parameters<typeof messagesToLog>[0][number]
const user = (text: string): Msg => ({ role: 'user', text, toolUses: [] })
const asst = (text: string, toolUses: Msg['toolUses'] = []): Msg => ({ role: 'assistant', text, toolUses })
const kinds = (lines: LogLine[]): string[] => lines.map(l => `${l.kind}|${l.text}`)

describe('messagesToLog', () => {
  test('the brief first, then text, then each tool with its result, in order', async () => {
    const msgs: Msg[] = [
      user('Find the bug\nin the parser'),
      asst('I look at the parser.', [{ tool: 'Read', input: { file_path: 'src/p.ts' }, text: 'line one\nline two\nline three' }]),
      user(''),
      user('Also check the lexer'),
      asst('Found it.'),
    ]
    expect(kinds(messagesToLog(msgs, 100, T0))).toEqual([
      'status|brief: Find the bug',
      'text|I look at the parser.',
      'tool|▸ Read p.ts',
      'result|  line one',
      'result|  line two',
      'status|message: Also check the lexer',
      'text|Found it.',
    ])
  })
  test('every line has at = now', async () => {
    const lines = messagesToLog([user('x'), asst('y')], 100, T0 + 1)
    expect(lines.every(l => l.at === T0 + 1)).toBe(true)
  })
  test('assistant text keeps at most 6 lines, then …', async () => {
    const text = ['1', '2', '', '3', '4', '5', '6', '7', '8'].join('\n')
    const lines = messagesToLog([asst(text)], 100, T0)
    expect(lines.map(l => l.text)).toEqual(['1', '2', '3', '4', '5', '6', '…'])
    expect(lines.every(l => l.kind === 'text')).toBe(true)
  })
  test('an error result gives error lines; a tool in flight gives only its tool line', async () => {
    const lines = messagesToLog(
      [
        asst('', [
          { tool: 'Bash', input: { command: 'make' }, text: '\nboom\n\nmore\nmost', isError: true },
          { tool: 'Grep', input: { pattern: 'x' } },
        ]),
      ],
      100,
      T0,
    )
    expect(kinds(lines)).toEqual(['tool|▸ Bash make', 'error|  boom', 'error|  more', 'tool|▸ Grep x'])
  })
  test('control characters in text and results are removed', async () => {
    const lines = messagesToLog([asst('\u001b[1mbold\u001b[0m', [{ tool: 'Bash', input: { command: 'x' }, text: 'a\tb\u0007' }])], 100, T0)
    expect(lines.map(l => l.text)).toEqual(['[1mbold[0m', '▸ Bash x', '  a  b'])
  })
  test('max keeps the last lines', async () => {
    const msgs = [user('brief'), asst('a\nb\nc\nd')]
    expect(messagesToLog(msgs, 2, T0).map(l => l.text)).toEqual(['c', 'd'])
    expect(messagesToLog(msgs, 0, T0)).toEqual([])
  })
  test('resultLines matches the result lines of messagesToLog', async () => {
    expect(resultLines('line one\nline two\nline three', 'result', T0)).toEqual([
      { at: T0, kind: 'result', text: '  line one' },
      { at: T0, kind: 'result', text: '  line two' },
    ])
    expect(resultLines('', 'error', T0)).toEqual([])
  })
})

describe('currentFromMessages', () => {
  test('counts every tool use; the tool in flight is the last one with no text in the last assistant message', async () => {
    const msgs: Msg[] = [
      user('go'),
      asst('First.\nSecond line.', [{ tool: 'Read', input: { file_path: 'a.ts' }, text: 'x' }]),
      asst('', [
        { tool: 'Grep', input: { pattern: 'TODO' } },
        { tool: 'Glob', input: { pattern: '*.md' } },
      ]),
    ]
    expect(currentFromMessages(msgs)).toEqual({ toolCount: 3, currentTool: 'Glob *.md', lastText: 'Second line.' })
  })
  test('a tool with no text in an earlier assistant message is not current', async () => {
    const msgs: Msg[] = [asst('', [{ tool: 'Grep', input: { pattern: 'x' } }]), asst('Done.')]
    const out = currentFromMessages(msgs)
    expect(out).toEqual({ toolCount: 1, lastText: 'Done.' })
    expect(hasUndefined(out)).toBe(false)
  })
  test('no messages give a count of 0 and nothing else', async () => {
    expect(currentFromMessages([])).toEqual({ toolCount: 0 })
  })
})

describe('liveBuddies, expire and dropEnded', () => {
  const agents = {
    a: row({ id: 'a', buddy: { key: 'digby', variant: 0 } }),
    b: row({ id: 'b', status: 'completed', endedAt: T0, buddy: { key: 'bolt', variant: 0 } }),
    c: row({ id: 'c', status: 'failed', endedAt: T0 + 5_000, buddy: { key: 'pip', variant: 0 } }),
    d: row({ id: 'd', status: 'idle', buddy: { key: 'moss', variant: 2 } }),
  }
  const order = ['a', 'b', 'c', 'd']
  test('liveBuddies gives the refs of live rows only', async () => {
    const refs: BuddyRef[] = liveBuddies(agents)
    expect(refs).toEqual([
      { key: 'digby', variant: 0 },
      { key: 'moss', variant: 2 },
    ])
  })
  test('liveBuddies leaves out the demo rows, live or not', async () => {
    const withDemo = { ...agents, [DEMO_PREFIX + 'running']: row({ id: DEMO_PREFIX + 'running', buddy: { key: 'bricks', variant: 0 } }) }
    expect(liveBuddies(withDemo)).toEqual([
      { key: 'digby', variant: 0 },
      { key: 'moss', variant: 2 },
    ])
  })
  test('expire removes ended rows at or past keepMs', async () => {
    const r = expire(agents, order, T0 + 10_000, 10_000)
    expect(r.removed).toEqual(['b'])
    expect(r.order).toEqual(['a', 'c', 'd'])
    expect(Object.keys(r.agents)).toEqual(['a', 'c', 'd'])
    expect(Object.keys(agents)).toHaveLength(4)
  })
  test('expire never removes keepId', async () => {
    const r = expire(agents, order, T0 + 20_000, 10_000, 'b')
    expect(r.removed).toEqual(['c'])
  })
  test('expire with nothing to remove returns the inputs', async () => {
    const r = expire(agents, order, T0 + 1, 10_000, null)
    expect(r.removed).toEqual([])
    expect(r.agents).toBe(agents)
    expect(r.order).toBe(order)
  })
  test('dropEnded removes every ended row and its log', async () => {
    const logs: Record<string, LogLine[]> = { a: [{ at: 1, kind: 'text', text: 'a' }], b: [{ at: 1, kind: 'text', text: 'b' }] }
    const r = dropEnded(agents, order, logs)
    expect(r.removed).toEqual(['b', 'c'])
    expect(r.order).toEqual(['a', 'd'])
    expect(Object.keys(r.agents)).toEqual(['a', 'd'])
    expect(Object.keys(r.logs)).toEqual(['a'])
    expect(Object.keys(logs)).toEqual(['a', 'b'])
  })
  test('dropEnded with no ended rows returns the inputs', async () => {
    const live = { a: row({ id: 'a' }) }
    const logs = {}
    const r = dropEnded(live, ['a'], logs)
    expect(r.removed).toEqual([])
    expect(r.agents).toBe(live)
    expect(r.logs).toBe(logs)
  })
})

describe('summary and time', () => {
  test('summary counts in status order and leaves zero counts out', async () => {
    expect(summary({})).toBeUndefined()
    const agents = {
      a: row({ id: 'a', status: 'completed' }),
      b: row({ id: 'b', status: 'idle' }),
      c: row({ id: 'c', status: 'running' }),
      d: row({ id: 'd', status: 'running' }),
      e: row({ id: 'e', status: 'completed' }),
      f: row({ id: 'f', status: 'completed' }),
    }
    expect(summary(agents)).toBe('🐾 2 busy · 1 napping · 3 done')
    expect(summary({ a: row({ id: 'a', status: 'killed' }), b: row({ id: 'b', status: 'pending' }) })).toBe('🐾 1 hatching · 1 stopped')
  })
  test('formatElapsed at its edges', async () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(8_400)).toBe('8s')
    expect(formatElapsed(59_999)).toBe('59s')
    expect(formatElapsed(60_000)).toBe('1m 00s')
    expect(formatElapsed(125_000)).toBe('2m 05s')
    expect(formatElapsed(3_599_999)).toBe('59m 59s')
    expect(formatElapsed(3_600_000)).toBe('1h 00m')
    expect(formatElapsed(3_780_000)).toBe('1h 03m')
    expect(formatElapsed(-5)).toBe('0s')
    expect(formatElapsed(Number.NaN)).toBe('0s')
  })
  test('elapsedOf runs to endedAt, or to now while live, never below 0', async () => {
    expect(elapsedOf(row({ id: 'a', startedAt: T0 }), T0 + 4_000)).toBe(4_000)
    expect(elapsedOf(row({ id: 'a', startedAt: T0, endedAt: T0 + 1_000 }), T0 + 9_000)).toBe(1_000)
    expect(elapsedOf(row({ id: 'a', startedAt: T0 + 5 }), T0)).toBe(0)
  })
})

describe('asciiFrameFor and animKey', () => {
  test('off stays on frame 0', async () => {
    for (const s of ['running', 'completed', 'killed'] as const) {
      expect(asciiFrameFor(row({ id: 'a', status: s }), T0 + 9_000, 7, 'off')).toBe(0)
    }
  })
  test('completed hops for 1.5 s and rests on frame 3', async () => {
    const r = row({ id: 'a', status: 'completed', statusSince: T0 })
    expect(asciiFrameFor(r, T0, 9, 'full')).toBe(0)
    expect(asciiFrameFor(r, T0 + 499, 9, 'full')).toBe(0)
    expect(asciiFrameFor(r, T0 + 500, 9, 'full')).toBe(1)
    expect(asciiFrameFor(r, T0 + 1_200, 9, 'calm')).toBe(2)
    expect(asciiFrameFor(r, T0 + 60_000, 9, 'full')).toBe(3)
    expect(asciiFrameFor(r, T0 - 1_000, 9, 'full')).toBe(0)
  })
  test('killed sways on 2 frames; calm runs at half speed', async () => {
    const k = row({ id: 'a', status: 'killed' })
    expect([0, 1, 2, 3].map(f => asciiFrameFor(k, T0, f, 'full'))).toEqual([0, 1, 0, 1])
    expect([0, 1, 2, 3].map(f => asciiFrameFor(k, T0, f, 'calm'))).toEqual([0, 0, 1, 1])
    const r = row({ id: 'b', status: 'running' })
    expect(asciiFrameFor(r, T0, 5, 'full')).toBe(5)
    expect(asciiFrameFor(r, T0, 5, 'calm')).toBe(2)
  })
  test('animKey is stable for a den at rest and moves while a row animates', async () => {
    const rest = {
      a: row({ id: 'a', status: 'completed', statusSince: T0, startedAt: T0 - 60_000, endedAt: T0 }),
      b: row({ id: 'b', status: 'killed', statusSince: T0, startedAt: T0 - 5_000, endedAt: T0 }),
    }
    const now = T0 + 120_000
    expect(animKey(rest, now, 4, { animations: 'off' })).toBe(animKey(rest, now, 5, { animations: 'off' }))
    const done = { a: rest.a }
    expect(animKey(done, now, 4)).toBe(animKey(done, now, 5))
    expect(animKey(done, now, 4)).toBe(animKey(done, now + 30_000, 4))
    expect(animKey(done, now, 0)).toBe('a:completed:3:-:1m 00s')
    const live = { r: row({ id: 'r', status: 'running', startedAt: T0 - 10_000, statusSince: T0 - 10_000 }) }
    expect(animKey(live, T0, 4)).not.toBe(animKey(live, T0, 5))
    expect(animKey(live, T0, 0)).toBe('r:running:0:-:10s')
    expect(animKey({}, T0, 0)).toBe('')
  })
  test('animKey shows the spawn and leave transitions', async () => {
    const fresh = { r: row({ id: 'r', status: 'running', startedAt: T0, statusSince: T0 }) }
    expect(animKey(fresh, T0 + 100, 0)).toBe('r:running:0:spawn:0s')
    const old = { a: row({ id: 'a', status: 'completed', statusSince: T0, startedAt: T0, endedAt: T0 }) }
    expect(animKey(old, T0 + 9_000, 0, { keepFinishedMs: 10_000 })).toBe('a:completed:3:leave:0s')
  })
})

describe('treeOrder', () => {
  test('children go after their parent and its earlier children, up to depth 3', async () => {
    const agents = {
      a: row({ id: 'a' }),
      b: row({ id: 'b' }),
      c: row({ id: 'c', parentId: 'a' }),
      d: row({ id: 'd', parentId: 'a' }),
      e: row({ id: 'e', parentId: 'c' }),
      f: row({ id: 'f', parentId: 'e' }),
      g: row({ id: 'g', parentId: 'f' }),
      h: row({ id: 'h', parentId: 'nobody' }),
    }
    expect(treeOrder(agents, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'ghost', 'a'])).toEqual([
      { id: 'a', depth: 0 },
      { id: 'c', depth: 1 },
      { id: 'e', depth: 2 },
      { id: 'f', depth: 3 },
      { id: 'g', depth: 3 },
      { id: 'd', depth: 1 },
      { id: 'b', depth: 0 },
      { id: 'h', depth: 0 },
    ])
  })
  test('a child seen before its parent still goes under it', async () => {
    const agents = { c: row({ id: 'c', parentId: 'p' }), p: row({ id: 'p' }) }
    expect(treeOrder(agents, ['c', 'p'])).toEqual([
      { id: 'p', depth: 0 },
      { id: 'c', depth: 1 },
    ])
  })
  test('a parent cycle still shows each id one time', async () => {
    const agents = { a: row({ id: 'a', parentId: 'b' }), b: row({ id: 'b', parentId: 'a' }) }
    const out = treeOrder(agents, ['a', 'b'])
    expect(out.map(x => x.id).sort()).toEqual(['a', 'b'])
  })
})

describe('sameLog', () => {
  test('compares kind and text, not at', async () => {
    const a: LogLine[] = [{ at: 1, kind: 'tool', text: '▸ Read a.ts' }]
    expect(sameLog(a, [{ at: 99, kind: 'tool', text: '▸ Read a.ts' }])).toBe(true)
    expect(sameLog(a, [{ at: 1, kind: 'result', text: '▸ Read a.ts' }])).toBe(false)
    expect(sameLog(a, [{ at: 1, kind: 'tool', text: '▸ Read b.ts' }])).toBe(false)
    expect(sameLog(a, [])).toBe(false)
    expect(sameLog([], [])).toBe(true)
  })
})

describe('closeEffect', () => {
  const panes = { den: 'agent-den', log: 'agent-den-log' }
  test('the person closing the den hides it; a plugin or unload close does not', async () => {
    expect(closeEffect('agent-den', 'person', panes)).toEqual({ hideDen: true })
    expect(closeEffect('agent-den', 'plugin', panes)).toEqual({})
    expect(closeEffect('agent-den', 'unload', panes)).toEqual({})
  })
  test('any close of the log clears the selection', async () => {
    expect(closeEffect('agent-den-log', 'person', panes)).toEqual({ clearSelected: true })
    expect(closeEffect('agent-den-log', 'plugin', panes)).toEqual({ clearSelected: true })
    expect(closeEffect('agent-den-log', 'unload', panes)).toEqual({ clearSelected: true })
  })
  test('another pane gives nothing', async () => {
    expect(closeEffect('other', 'person', panes)).toEqual({})
  })
})

describe('demoState', () => {
  test('seven unlisted rows, one for each status, with logs', async () => {
    const d = demoState(T0)
    const statuses: DenStatus[] = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed']
    expect(d.order).toEqual(statuses.map(s => DEMO_PREFIX + s))
    expect(d.order.map(id => d.agents[id]?.status)).toEqual(statuses)
    expect(d.order.map(id => d.agents[id]?.buddy.key)).toEqual(['digby', 'bricks', 'bolt', 'pip', 'bristle', 'mochi', 'nib'])
    expect(d.order.map(id => d.agents[id]?.type)).toEqual(['Explore', 'Plan', 'general-purpose', 'claude-code-guide', 'security-review', 'workflow', 'teammate'])
    for (const id of d.order) {
      const r = d.agents[id]
      expect(r?.isListed).toBe(false)
      expect(r?.statusSince).toBe(T0)
      expect(r?.startedAt).toBeLessThanOrEqual(T0)
      expect(r?.description.length).toBeGreaterThan(0)
      expect(hasUndefined(r ?? {})).toBe(false)
      expect(isEnded(r?.status ?? 'running') ? r?.endedAt : 'live').toBe(isEnded(r?.status ?? 'running') ? T0 : 'live')
      const n = d.logs[id]?.length ?? 0
      expect(n >= 3 && n <= 6).toBe(true)
    }
    expect(d.agents['demo-running']?.currentTool).toBe('Grep TODO')
    expect(d.logs['demo-failed']?.some(l => l.kind === 'error')).toBe(true)
    expect(d.agents['demo-completed']?.lastReason).toBe('answer')
    expect(d.agents['demo-killed']?.lastReason).toBe('aborted')
  })
})
