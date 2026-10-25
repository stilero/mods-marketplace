// agent-den tracker: pure functions over AgentRow and LogLine. No $, no clock, no I/O.
//
// register.tsx feeds these the agent list, hook events and session messages, and writes what they return.
// Rules: never mutate an input; return the same object when nothing changed and new objects for changed
// rows only; never put `undefined` in a row (the host can refuse it), so optional fields are left out with
// a rest pattern or `delete` on a copy. Text from agents goes through cleanText before it reaches a line.
import type { AgentRow, BuddyRef, DenStatus, LogLine } from '../types'
import { transitionFor } from './art'
import type { Animations } from './art'
import { STATUS_LABEL, STATUS_ORDER } from './theme'

/** One entry of $.agent.list(), as the tracker reads it. */
export type ListedAgent = { id: string; description: string; type: string; status: DenStatus; parentId?: string; name?: string }
/** Picks a buddy for a new row; `taken` holds the refs of live rows. */
export type PickFn = (type: string, taken: BuddyRef[]) => BuddyRef
/** What register knows about an id that no list names yet. */
export type RowHint = { type?: string; description?: string; model?: string; name?: string; parentId?: string }

type Rows = Record<string, AgentRow>
type Reason = AgentRow['lastReason']
type ToolUseLike = { readonly tool: string; readonly input: Readonly<Record<string, unknown>>; readonly text?: string; readonly isError?: true }
type MessageLike = { readonly role: string; readonly text: string; readonly toolUses: readonly ToolUseLike[] }

/** Ids of the demo rows (/agent-den demo). They are never read from session.messages. */
export const DEMO_PREFIX = 'demo-'

// A log line longer than this is cut: one minified file must not fill the pane.
const MAX_LINE = 300

/** pending, running, waiting and idle. */
export function isLive(s: DenStatus): boolean {
  return s === 'pending' || s === 'running' || s === 'waiting' || s === 'idle'
}

/** completed, failed and killed. */
export function isEnded(s: DenStatus): boolean {
  return s === 'completed' || s === 'failed' || s === 'killed'
}

/** Removes control characters (ESC included) and turns a tab into 2 spaces; keeps newlines. */
export function cleanText(text: string): string {
  // A pane title with a control character is refused, and ESC would let agent output style the terminal.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\t/g, '  ').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
}

// Cuts by code points, so an emoji is never split into U+FFFD; the result has at most `max` code points.
const cut = (s: string, max: number): string => {
  const cps = [...s]
  if (cps.length <= max) return s
  return max <= 0 ? '' : cps.slice(0, max - 1).join('') + '…'
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

// An engine string a card draws (description, type, name): one clean line. A desktop refuses a whole
// drawing that has a control character in a Text, so the den would show nothing.
const plain = (s: string, max: number): string => cut(collapse(cleanText(s)), max)
const DESC_MAX = 200
const NAME_MAX = 60

/** The first non-empty line of a text, cleaned, trimmed and collapsed, cut to `max` code points with '…'. */
export function firstLine(text: string, max: number): string {
  for (const line of cleanText(text).split('\n')) {
    const t = collapse(line)
    if (t !== '') return cut(t, max)
  }
  return ''
}

// The non-empty lines of a text, cleaned, with trailing spaces removed.
const nonEmptyLines = (text: string): string[] =>
  cleanText(text)
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '')

/** The ended status for a turn that stopped for `reason`: answer (or none) → completed, error|refusal → failed, aborted → killed. */
function endedStatusFor(reason: Reason): DenStatus {
  if (reason === 'error' || reason === 'refusal') return 'failed'
  if (reason === 'aborted') return 'killed'
  return 'completed'
}

/** The buddy refs of live rows: a new agent never gets one of these. Demo rows do not hold a buddy. */
export function liveBuddies(agents: Readonly<Rows>): BuddyRef[] {
  return Object.values(agents)
    .filter(r => isLive(r.status) && !r.id.startsWith(DEMO_PREFIX))
    .map(r => r.buddy)
}

const sameBuddy = (a: BuddyRef, b: BuddyRef): boolean => a.key === b.key && a.variant === b.variant

// Shallow row equality (buddy by value), so upsertListed reports `changed` only for a real change.
function sameRow(a: AgentRow, b: AgentRow): boolean {
  const ka = Object.keys(a) as (keyof AgentRow)[]
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if (k === 'buddy') {
      if (!sameBuddy(a.buddy, b.buddy)) return false
    } else if (a[k] !== b[k]) return false
  }
  return true
}

// Sets or removes an optional string field on a fresh copy.
function setOpt<K extends 'name' | 'parentId' | 'model'>(row: AgentRow, key: K, value: string | undefined): void {
  if (value === undefined || value === '') delete row[key]
  else row[key] = value
}

// Moves a copy to a new status: statusSince on a change, endedAt kept or set when ended, removed when live.
function withStatus(row: AgentRow, status: DenStatus, now: number): AgentRow {
  const next: AgentRow = { ...row, status }
  if (status !== row.status) next.statusSince = now
  if (isEnded(status)) next.endedAt = row.endedAt ?? now
  else delete next.endedAt
  return next
}

// A list entry with its strings made safe to draw; an empty type becomes 'agent'.
function cleanListed(a: ListedAgent): ListedAgent {
  const out: ListedAgent = { ...a, description: plain(a.description, DESC_MAX), type: plain(a.type, NAME_MAX) || 'agent' }
  if (a.name === undefined) delete out.name
  else out.name = plain(a.name, NAME_MAX)
  return out
}

/** Merges one $.agent.list() result into the rows: new live ids, status changes, and listed rows that dropped out. `added` holds only live rows. */
export function upsertListed(
  agents: Readonly<Rows>,
  order: readonly string[],
  list: readonly ListedAgent[],
  now: number,
  pick: PickFn,
): { agents: Rows; order: string[]; changed: boolean; added: string[] } {
  const out: Rows = { ...agents }
  const nextOrder = [...order]
  const added: string[] = []
  const addedBuddies: BuddyRef[] = []
  const listedIds = new Set<string>()
  let changed = false

  for (const raw of list) {
    if (listedIds.has(raw.id)) continue
    listedIds.add(raw.id)
    const a = cleanListed(raw)
    const old = agents[a.id]
    if (old === undefined) {
      // An ended agent with no row is never added: the list keeps a subagent some time after it ends, so
      // a row that clear or expiry removed would come back on the next poll (and auto-open the den after
      // a /clear). turn.start and tool.call make the row of every run the mod hears.
      if (isEnded(a.status)) continue
      const buddy = pick(a.type, [...liveBuddies(agents), ...addedBuddies])
      const row: AgentRow = {
        id: a.id,
        description: a.description,
        type: a.type,
        buddy,
        status: a.status,
        statusSince: now,
        startedAt: now,
        toolCount: 0,
        turnCount: 0,
        isListed: true,
      }
      setOpt(row, 'name', a.name)
      setOpt(row, 'parentId', a.parentId)
      out[a.id] = row
      if (!nextOrder.includes(a.id)) nextOrder.push(a.id)
      added.push(a.id)
      addedBuddies.push(buddy)
      changed = true
      continue
    }
    let row = withStatus({ ...old, description: a.description, type: a.type, isListed: true }, a.status, now)
    setOpt(row, 'name', a.name)
    setOpt(row, 'parentId', a.parentId)
    // A workflow row (an id no list named) that a list names now: its real type gets its own buddy, one time.
    if (old.isListed === false && old.type === 'workflow' && a.type !== 'workflow') {
      const others = Object.values(out).filter(r => r.id !== a.id && isLive(r.status)).map(r => r.buddy)
      row = { ...row, buddy: pick(a.type, [...others, ...addedBuddies]) }
    }
    if (!sameRow(old, row)) {
      out[a.id] = row
      changed = true
    }
  }

  for (const id of Object.keys(agents)) {
    const row = agents[id]
    if (row === undefined || listedIds.has(id) || row.isListed !== true) continue
    // Demo and workflow rows (isListed false) never reach here: they end only by turn.complete, clear or expiry.
    if (isLive(row.status)) {
      out[id] = { ...withStatus(row, endedStatusFor(row.lastReason), now), statusSince: now, endedAt: now, isListed: false }
    } else {
      out[id] = { ...row, isListed: false }
    }
    changed = true
  }

  if (!changed) return { agents: agents as Rows, order: order as string[], changed, added }
  return { agents: out, order: nextOrder, changed, added }
}

/** Makes a pending, unlisted row for an id that no row has yet (a hook event came first, or a workflow agent). */
export function ensureRow(
  agents: Readonly<Rows>,
  order: readonly string[],
  id: string,
  now: number,
  pick: PickFn,
  hint?: RowHint,
): { agents: Rows; order: string[]; added: boolean } {
  if (agents[id] !== undefined) return { agents: agents as Rows, order: order as string[], added: false }
  const type = hint?.type === undefined ? 'workflow' : plain(hint.type, NAME_MAX) || 'agent'
  const row: AgentRow = {
    id,
    description: plain(hint?.description ?? '', DESC_MAX),
    type,
    buddy: pick(type, liveBuddies(agents)),
    status: 'pending',
    statusSince: now,
    startedAt: now,
    toolCount: 0,
    turnCount: 0,
    isListed: false,
  }
  setOpt(row, 'model', hint?.model === undefined ? undefined : plain(hint.model, NAME_MAX))
  setOpt(row, 'name', hint?.name === undefined ? undefined : plain(hint.name, NAME_MAX))
  setOpt(row, 'parentId', hint?.parentId)
  return { agents: { ...agents, [id]: row }, order: order.includes(id) ? [...order] : [...order, id], added: true }
}

/** A turn of the agent started: running, one more turn, no endedAt. */
export function onTurnStart(row: AgentRow, now: number): AgentRow {
  const next = withStatus(row, 'running', now)
  next.turnCount = row.turnCount + 1
  return next
}

/** A turn of the agent ended: no current tool, the answer's first line, and the reason; an unlisted row ends by the reason. */
export function onTurnComplete(row: AgentRow, reason: Reason, answer: string, now: number): AgentRow {
  let next: AgentRow = { ...row }
  delete next.currentTool
  delete next.lastReason
  if (reason !== undefined) next.lastReason = reason
  const line = firstLine(answer, 80)
  if (line !== '') next.lastText = line
  // A listed row keeps its status: the list says when it ends. An unlisted one (workflow) has no list.
  if (!row.isListed) {
    const status = endedStatusFor(reason)
    next = isLive(row.status) ? { ...next, status, statusSince: now, endedAt: now } : withStatus(next, status, now)
  }
  return next
}

/** A tool call of the agent started: the current tool, one more tool, running. */
export function onToolStart(row: AgentRow, label: string, now: number): AgentRow {
  const next = withStatus(row, 'running', now)
  next.currentTool = label
  next.toolCount = row.toolCount + 1
  return next
}

const basename = (p: string): string => p.split(/[\\/]/).filter(s => s !== '').pop() ?? ''

/** A short label for a tool call: "Read a.ts", "Bash npm test", "Grep TODO"; at most 48 code points. */
export function toolLabel(tool: string, input: Readonly<Record<string, unknown>>): string {
  // Only named keys are read, so reserved keys (tool_use_id, agentId, requestMeta, consent) never reach a label.
  const str = (key: string): string => {
    const v = input[key]
    return typeof v === 'string' ? v : ''
  }
  let name = tool
  let arg = ''
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      arg = basename(str('file_path') || str('notebook_path'))
      break
    case 'Bash':
      arg = firstLine(str('command'), 200)
      break
    case 'Grep':
    case 'Glob':
      arg = str('pattern')
      break
    case 'WebFetch':
      try {
        arg = new URL(str('url')).host
      } catch {
        arg = ''
      }
      break
    case 'WebSearch':
      arg = str('query')
      break
    case 'Agent':
    case 'Task':
      arg = str('description')
      break
    case 'Skill':
      arg = str('skill')
      break
    default:
      if (tool.startsWith('mcp__')) {
        const [srv = '', ...rest] = tool.slice(5).split('__')
        if (srv !== '' && rest.length > 0) name = `${srv}·${rest.join('__')}`
      }
  }
  const text = collapse(cleanText(arg === '' ? name : `${name} ${arg}`))
  return cut(text, 48)
}

/** The result or error lines of a tool: up to 2 non-empty lines, each with 2 spaces in front. */
export function resultLines(text: string, kind: 'result' | 'error', now: number): LogLine[] {
  return nonEmptyLines(text)
    .slice(0, 2)
    .map(l => ({ at: now, kind, text: cut('  ' + l, MAX_LINE) }))
}

/** An agent's transcript as log lines: the brief, messages, text, tools and their results; the last `max` lines. */
export function messagesToLog(msgs: readonly MessageLike[], max: number, now: number): LogLine[] {
  const lines: LogLine[] = []
  let hasBrief = false
  for (const m of msgs) {
    if (m.role === 'user') {
      // A user message with empty text holds only tool results: those show under their tool line.
      const t = firstLine(m.text, 200)
      if (t !== '') {
        lines.push({ at: now, kind: 'status', text: (hasBrief ? 'message: ' : 'brief: ') + t })
        hasBrief = true
      }
    } else {
      const text = nonEmptyLines(m.text)
      for (const l of text.slice(0, 6)) lines.push({ at: now, kind: 'text', text: cut(l, MAX_LINE) })
      if (text.length > 6) lines.push({ at: now, kind: 'text', text: '…' })
    }
    for (const use of m.toolUses) {
      lines.push({ at: now, kind: 'tool', text: '▸ ' + toolLabel(use.tool, use.input) })
      if (use.text !== undefined) lines.push(...resultLines(use.text, use.isError === true ? 'error' : 'result', now))
    }
  }
  return max > 0 ? lines.slice(-max) : []
}

/** What the card shows from a transcript: the tool in flight, the last text line, and the tool count. */
export function currentFromMessages(msgs: readonly MessageLike[]): { currentTool?: string; lastText?: string; toolCount: number } {
  const out: { currentTool?: string; lastText?: string; toolCount: number } = { toolCount: 0 }
  for (const m of msgs) out.toolCount += m.toolUses.length
  const assistant = msgs.filter(m => m.role === 'assistant')
  const last = assistant[assistant.length - 1]
  if (last !== undefined) {
    const inFlight = last.toolUses.filter(u => u.text === undefined)
    const use = inFlight[inFlight.length - 1]
    if (use !== undefined) out.currentTool = toolLabel(use.tool, use.input)
  }
  for (let i = assistant.length - 1; i >= 0; i--) {
    const lines = nonEmptyLines(assistant[i]?.text ?? '')
    const line = lines[lines.length - 1]
    if (line !== undefined) {
      out.lastText = firstLine(line, 80)
      break
    }
  }
  return out
}

// Removes ids from rows and order.
function removeIds(agents: Readonly<Rows>, order: readonly string[], gone: readonly string[]) {
  const set = new Set(gone)
  const nextAgents: Rows = {}
  for (const [id, row] of Object.entries(agents)) if (!set.has(id)) nextAgents[id] = row
  return { agents: nextAgents, order: order.filter(id => !set.has(id)), set }
}

/** Removes ended rows that ended `keepMs` ago or more; never removes `keepId` (the selected row). */
export function expire(
  agents: Readonly<Rows>,
  order: readonly string[],
  now: number,
  keepMs: number,
  keepId?: string | null,
): { agents: Rows; order: string[]; removed: string[] } {
  // A row with no endedAt counts from statusSince, so it can never stay forever.
  const removed = Object.values(agents)
    .filter(r => isEnded(r.status) && r.id !== keepId && now - (r.endedAt ?? r.statusSince) >= keepMs)
    .map(r => r.id)
  if (removed.length === 0) return { agents: agents as Rows, order: order as string[], removed }
  const r = removeIds(agents, order, removed)
  return { agents: r.agents, order: r.order, removed }
}

/** Removes every ended row and its log (/agent-den clear, session.end). */
export function dropEnded(
  agents: Readonly<Rows>,
  order: readonly string[],
  logs: Readonly<Record<string, LogLine[]>>,
): { agents: Rows; order: string[]; logs: Record<string, LogLine[]>; removed: string[] } {
  const removed = Object.values(agents)
    .filter(r => isEnded(r.status))
    .map(r => r.id)
  if (removed.length === 0) return { agents: agents as Rows, order: order as string[], logs: logs as Record<string, LogLine[]>, removed }
  const r = removeIds(agents, order, removed)
  const nextLogs: Record<string, LogLine[]> = {}
  for (const [id, lines] of Object.entries(logs)) if (!r.set.has(id)) nextLogs[id] = lines
  return { agents: r.agents, order: r.order, logs: nextLogs, removed }
}

/** The status-line text: "🐾 2 busy · 1 napping · 3 done"; undefined with no rows. */
export function summary(agents: Readonly<Rows>): string | undefined {
  const rows = Object.values(agents)
  if (rows.length === 0) return undefined
  const parts: string[] = []
  for (const s of STATUS_ORDER) {
    const n = rows.filter(r => r.status === s).length
    if (n > 0) parts.push(`${n} ${STATUS_LABEL[s]}`)
  }
  return '🐾 ' + parts.join(' · ')
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** "8s", "2m 05s", "1h 03m"; negative or not finite gives "0s". */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${pad2(s % 60)}s`
  return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`
}

/** How long the agent ran: up to its end, or up to now while live. Never negative. */
export function elapsedOf(row: AgentRow, now: number): number {
  return Math.max(0, (row.endedAt ?? now) - row.startedAt)
}

/** The ASCII frame to draw: `calm` runs at half speed, `off` stays on frame 0, completed hops once and rests on 3. */
export function asciiFrameFor(row: AgentRow, now: number, frame: number, animations: Animations): number {
  if (animations === 'off') return 0
  if (row.status === 'completed') return Math.min(3, Math.floor(Math.max(0, now - row.statusSince) / 500))
  const f = animations === 'calm' ? Math.floor(frame / 2) : frame
  return row.status === 'killed' ? f % 2 : f
}

/** What the drawing shows at (now, frame): the ticker writes frame or now only when this changes. */
export function animKey(
  agents: Readonly<Rows>,
  now: number,
  frame: number,
  opts?: { animations?: Animations; keepFinishedMs?: number },
): string {
  const animations = opts?.animations ?? 'full'
  const keepMs = opts?.keepFinishedMs ?? 600_000
  return Object.values(agents)
    .map(row => {
      // % 4: the key changes on every frame while a row animates, and stays put for a row at rest.
      const f = asciiFrameFor(row, now, frame, animations) % 4
      const t = transitionFor(row, now, keepMs) ?? '-'
      return `${row.id}:${row.status}:${f}:${t}:${formatElapsed(elapsedOf(row, now))}`
    })
    .join('|')
}

/** The draw order: `order`, with each child right after its parent (and the parent's earlier children), depth up to 3. */
export function treeOrder(agents: Readonly<Rows>, order: readonly string[]): { id: string; depth: number }[] {
  const ids = [...new Set(order)].filter(id => agents[id] !== undefined)
  const known = new Set(ids)
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const id of ids) {
    const parent = agents[id]?.parentId
    if (parent !== undefined && parent !== id && known.has(parent)) {
      const list = children.get(parent) ?? []
      list.push(id)
      children.set(parent, list)
    } else roots.push(id)
  }
  const out: { id: string; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (id: string, depth: number): void => {
    if (seen.has(id)) return
    seen.add(id)
    out.push({ id, depth })
    for (const child of children.get(id) ?? []) walk(child, Math.min(3, depth + 1))
  }
  for (const id of roots) walk(id, 0)
  // A parent cycle (a → b → a) has no root: draw what is left at depth 0, so every id shows one time.
  for (const id of ids) walk(id, 0)
  return out
}

/** True when two logs show the same lines (kind and text; `at` is ignored). */
export function sameLog(a: readonly LogLine[], b: readonly LogLine[]): boolean {
  if (a.length !== b.length) return false
  return a.every((l, i) => l.kind === b[i]?.kind && l.text === b[i]?.text)
}

/** What a ui.close means for the state: the person closed the den → hide it; the log closed → no selection. */
export function closeEffect(
  id: string,
  kind: 'plugin' | 'person' | 'unload',
  panes: { den: string; log: string },
): { hideDen?: true; clearSelected?: true } {
  if (id === panes.den && kind === 'person') return { hideDen: true }
  if (id === panes.log) return { clearSelected: true }
  return {}
}

type DemoSpec = {
  status: DenStatus
  key: string
  type: string
  description: string
  agoMs: number
  extra: Partial<Pick<AgentRow, 'currentTool' | 'lastText' | 'lastReason' | 'model'>>
  lines: [LogLine['kind'], string][]
}

const DEMO: readonly DemoSpec[] = [
  {
    status: 'pending',
    key: 'digby',
    type: 'Explore',
    description: 'Map the auth module',
    agoMs: 3_000,
    extra: {},
    lines: [
      ['status', 'brief: Find every place that reads the session token'],
      ['tool', '▸ Glob src/auth/**'],
      ['result', '  src/auth/session.ts'],
    ],
  },
  {
    status: 'running',
    key: 'bricks',
    type: 'Plan',
    description: 'Plan the cache rewrite',
    agoMs: 95_000,
    extra: { currentTool: 'Grep TODO', model: 'claude-opus-5-5' },
    lines: [
      ['status', 'brief: Plan a rewrite of the cache layer'],
      ['tool', '▸ Read cache.ts'],
      ['result', '  export class Cache {'],
      ['text', 'The cache has two stores. I check where each one is read.'],
      ['tool', '▸ Grep TODO'],
    ],
  },
  {
    status: 'waiting',
    key: 'bolt',
    type: 'general-purpose',
    description: 'Run the test suite',
    agoMs: 140_000,
    extra: { lastText: 'Waiting for the permission to run npm test.' },
    lines: [
      ['status', 'brief: Run the tests and report the failures'],
      ['tool', '▸ Read package.json'],
      ['result', '  "test": "vitest run"'],
      ['tool', '▸ Bash npm test'],
      ['text', 'Waiting for the permission to run npm test.'],
    ],
  },
  {
    status: 'idle',
    key: 'pip',
    type: 'claude-code-guide',
    description: 'Answer a hooks question',
    agoMs: 200_000,
    extra: { lastText: 'Hooks run in the order they were added.' },
    lines: [
      ['status', 'brief: How do hooks order their calls?'],
      ['tool', '▸ WebFetch docs.claude.com'],
      ['result', '  Hooks run in the order they were added.'],
      ['text', 'Hooks run in the order they were added.'],
    ],
  },
  {
    status: 'completed',
    key: 'bristle',
    type: 'security-review',
    description: 'Review the login form',
    agoMs: 260_000,
    extra: { lastText: 'No problems found in the login form.', lastReason: 'answer' },
    lines: [
      ['status', 'brief: Review the login form for injection risks'],
      ['tool', '▸ Read login.tsx'],
      ['result', '  export function Login() {'],
      ['tool', '▸ Grep dangerouslySetInnerHTML'],
      ['result', '  No matches found'],
      ['text', 'No problems found in the login form.'],
    ],
  },
  {
    status: 'failed',
    key: 'mochi',
    type: 'workflow',
    description: 'Migrate the database',
    agoMs: 180_000,
    extra: { lastText: 'The migration failed.', lastReason: 'error' },
    lines: [
      ['status', 'brief: Run the database migration'],
      ['tool', '▸ Bash npm run migrate'],
      ['error', '  Error: relation "users" already exists'],
      ['tool', '▸ Read 0042_users.sql'],
      ['result', '  CREATE TABLE users ('],
      ['text', 'The migration failed.'],
    ],
  },
  {
    status: 'killed',
    key: 'nib',
    type: 'teammate',
    description: 'Watch the build',
    agoMs: 120_000,
    extra: { lastText: 'Stopped by the lead.', lastReason: 'aborted' },
    lines: [
      ['status', 'brief: Watch the build and report when it is green'],
      ['tool', '▸ Bash npm run build'],
      ['result', '  build started'],
      ['text', 'Stopped by the lead.'],
    ],
  },
]

/** Seven demo rows, one for each status, with fake logs (/agent-den demo). Unlisted, so the poll never ends them. */
export function demoState(now: number): { agents: Rows; order: string[]; logs: Record<string, LogLine[]> } {
  const agents: Rows = {}
  const order: string[] = []
  const logs: Record<string, LogLine[]> = {}
  for (const d of DEMO) {
    const id = DEMO_PREFIX + d.status
    const tools = d.lines.filter(([kind]) => kind === 'tool').length
    // statusSince = now, so each one-shot transition plays one time when the demo opens.
    const row: AgentRow = {
      id,
      description: d.description,
      type: d.type,
      buddy: { key: d.key, variant: 0 },
      status: d.status,
      statusSince: now,
      startedAt: now - d.agoMs,
      toolCount: tools,
      turnCount: d.status === 'pending' ? 0 : 1,
      isListed: false,
      ...d.extra,
    }
    if (isEnded(d.status)) row.endedAt = now
    agents[id] = row
    order.push(id)
    logs[id] = d.lines.map(([kind, text]) => ({ at: now, kind, text }))
  }
  return { agents, order, logs }
}
