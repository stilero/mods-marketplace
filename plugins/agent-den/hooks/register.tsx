// agent-den: one animated pixel buddy per subagent, in a pane beside the chat, and a second pane with
// the output of the buddy you click. The rules that shape this file (docs/agent-den-PRD.md, 3 and 11):
// - Never hook agent.spawn or the main loop's turn.step, and keep the spawn tools out of the tool.call
//   matcher: a hook whose frame an agent's spawn ran in does not hear that agent's events.
// - Render hooks only read atoms. Every write is in a hook, the ticker or a press handler.
// - Every read-merge-write of agents/order/logs runs in serial(). No next(e) and no slow $ op inside it.
// - State values are never undefined: tracker.ts leaves optional fields out instead.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, LogLine } from '../types'
import { ASCII_W, EMPTY_DEN_ASCII, SPINNER, buddyAscii, buddySvg, emptyDenSvg, transitionFor } from './art'
import { parseBuddyMap, pickBuddy, resolveBuddy } from './buddies'
import type { ResolvedBuddy } from './buddies'
import { readOptions } from './options'
import { forgetAgent, resetRuntime, rt, serial } from './runtime'
import { CARD_HOVER_BG, STATUS_DOT, STATUS_LABEL, STATUS_ORDER, THEME, statusColor } from './theme'
import {
  DEMO_PREFIX,
  animKey,
  asciiFrameFor,
  cleanText,
  closeEffect,
  currentFromMessages,
  demoState,
  dropEnded,
  elapsedOf,
  ensureRow,
  expire,
  firstLine,
  formatElapsed,
  isEnded,
  isLive,
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
import type { ListedAgent, PickFn, RowHint } from './tracker'

const BUILD = '0.1.0'
const PANE = 'agent-den'
const LOG_PANE = 'agent-den-log'
const COMMAND = 'agent-den'
const USAGE = 'Usage: /agent-den [show|hide|log <n|name>|clear|demo]'

const agentsAtom = atom({ plugin: 'agent-den', key: 'agents' } as const, {})
const orderAtom = atom({ plugin: 'agent-den', key: 'order' } as const, [])
const logsAtom = atom({ plugin: 'agent-den', key: 'logs' } as const, {})
const selectedIdAtom = atom({ plugin: 'agent-den', key: 'selectedId' } as const, null)
const isDenHiddenAtom = atom({ plugin: 'agent-den', key: 'isDenHidden' } as const, false)
const hasAutoOpenedAtom = atom({ plugin: 'agent-den', key: 'hasAutoOpened' } as const, false)
const frameAtom = atom({ plugin: 'agent-den', key: 'frame' } as const, 0)
const nowAtom = atom({ plugin: 'agent-den', key: 'now' } as const, 0)

const debug = ($: EngineInterface, text: string): void => $.ui.log(`agent-den: ${text}`, { to: 'debug' })

const keepMs = (): number => rt.opts.keepFinishedMinutes * 60_000

/** The fields of a list entry that a new row takes, with no undefined values. */
function listedHint(a: ListedAgent): RowHint {
  return {
    type: a.type,
    description: a.description,
    ...(a.name !== undefined ? { name: a.name } : {}),
    ...(a.parentId !== undefined ? { parentId: a.parentId } : {}),
  }
}

/** What a hook knows of an agent id: a row of ours, a list entry, or neither. */
type Lookup = { kind: 'row' } | { kind: 'listed'; hint: RowHint } | { kind: 'unlisted' }

/**
 * Looks up an id that a hook event carries. An id the mod does not know yet is looked up in
 * $.agent.list() first (outside serial): the subagent's first event usually comes before the next poll.
 * An id that no list names is a workflow agent or one of the engine's own forks (compaction, memory).
 */
async function lookUp($: EngineInterface, id: string): Promise<Lookup> {
  if ((await read($, agentsAtom))[id] !== undefined) return { kind: 'row' }
  try {
    const listed = (await $.agent.list()).find(a => a.id === id)
    if (listed !== undefined) return { kind: 'listed', hint: listedHint(listed) }
  } catch (err) {
    debug($, `agent.list failed: ${String(err)}`)
  }
  return { kind: 'unlisted' }
}

/**
 * The last hook event (turn.start, tool.call, turn.complete) of each row, and the tool calls each row has
 * in flight. Module state like rt: after a hot reload a row counts from statusSince again.
 */
const heardAt: Record<string, number> = {}
const toolsInFlight: Record<string, number> = {}

/** Forgets a removed row: its log reads (forgetAgent) and its last event. */
function forgetRow(id: string): void {
  forgetAgent(id)
  delete heardAt[id]
}

/**
 * The live unlisted rows (not demo rows) that no hook event reached for keepFinishedMinutes and that have no
 * tool call in flight. No list ends such a row, so a missed turn.complete would keep it busy for good.
 */
function staleUnlistedIds(agents: Readonly<Record<string, AgentRow>>, now: number): string[] {
  return Object.values(agents)
    .filter(r => !r.isListed && isLive(r.status) && !r.id.startsWith(DEMO_PREFIX) && (toolsInFlight[r.id] ?? 0) === 0)
    .filter(r => now - Math.max(heardAt[r.id] ?? -Infinity, r.statusSince) >= keepMs())
    .map(r => r.id)
}

/** A stale unlisted row ends as completed, with no tool on its card. */
function endStale(row: AgentRow, now: number): AgentRow {
  const { currentTool: _gone, ...rest } = row
  return { ...rest, status: 'completed', statusSince: now, endedAt: now }
}

/** Appends lines to one agent's log, capped at maxLogLines. Call it inside serial(). */
async function appendLog($: EngineInterface, id: string, lines: readonly LogLine[]): Promise<void> {
  if (lines.length === 0) return
  await update($, logsAtom, logs => ({ ...logs, [id]: [...(logs[id] ?? []), ...lines].slice(-rt.opts.maxLogLines) }))
}

/** The pane title of an agent's log: no control characters, no tabs (a title with one is refused). */
function logTitle(row: AgentRow): string {
  const name = resolveBuddy(row.buddy).displayName
  const desc = firstLine(row.description, 40)
  return cleanText(desc === '' ? name : `${name} · ${desc}`).replace(/\s+/g, ' ')
}

/** Every open of the den goes through here: each open sets the options anew, so all of them pass closeOnEscape and rows. */
async function openDen($: EngineInterface): Promise<void> {
  try {
    const count = (await read($, orderAtom)).length
    const opened = await $.ui.open({ id: PANE, title: 'Agent den', closeOnEscape: true, rows: Math.min(4 + 4 * Math.max(1, count), 22) })
    // An open the person did not ask for waits undrawn on a narrow terminal; /agent-den shows it.
    if (!opened.isPlaced) debug($, `the den waits undrawn: ${opened.reason}`)
  } catch (err) {
    debug($, `opening the den failed: ${String(err)}`)
  }
}

/** Selects an agent and opens its log pane. Only a press or a command calls this, so the pane takes the keyboard. */
async function openLog($: EngineInterface, id: string): Promise<void> {
  await update($, selectedIdAtom, () => id)
  const row = (await read($, agentsAtom))[id]
  try {
    const opened = await $.ui.open({
      id: LOG_PANE,
      title: row === undefined ? 'Agent log' : logTitle(row),
      focus: true,
      closeOnEscape: true,
      rows: 18,
    })
    if (!opened.isPlaced) debug($, `the log pane waits undrawn: ${opened.reason}`)
  } catch (err) {
    debug($, `opening the log pane failed: ${String(err)}`)
  }
}

/** Closes a pane of ours; a missing pane or a refusal is only logged. */
async function closePane($: EngineInterface, id: string): Promise<void> {
  try {
    await $.ui.close({ id })
  } catch (err) {
    debug($, `closing ${id} failed: ${String(err)}`)
  }
}

/** Opens the den one time per conversation, on the first agent, unless the person hid it or turned autoOpen off. */
async function autoOpen($: EngineInterface): Promise<void> {
  if (!rt.opts.autoOpen) return
  // Check and set in serial(): the poll and a hook can find a new agent at the same time.
  // Set before the open: an open that waits undrawn still counts, the engine draws it when the terminal grows.
  const isFirst = await serial(async () => {
    if ((await read($, isDenHiddenAtom)) || (await read($, hasAutoOpenedAtom))) return false
    await update($, hasAutoOpenedAtom, () => true)
    return true
  })
  if (isFirst) await openDen($)
}

/** The rows and order without `ids`. */
function withoutIds(
  agents: Readonly<Record<string, AgentRow>>,
  order: readonly string[],
  ids: readonly string[],
): { agents: Record<string, AgentRow>; order: string[] } {
  return {
    agents: Object.fromEntries(Object.entries(agents).filter(([id]) => !ids.includes(id))),
    order: order.filter(id => !ids.includes(id)),
  }
}

/** The ids of the demo rows (/agent-den demo). */
const demoIds = (agents: Readonly<Record<string, AgentRow>>): string[] => Object.keys(agents).filter(id => id.startsWith(DEMO_PREFIX))

/**
 * The live demo rows that are keepFinishedMinutes old, except `keepId` (the selected row). A live demo row
 * has no list entry and no turn.complete, so without this it would hold its buddy and the status line for good.
 */
function staleDemoIds(agents: Readonly<Record<string, AgentRow>>, now: number, keepId: string | null): string[] {
  return demoIds(agents).filter(id => {
    const row = agents[id]
    return row !== undefined && isLive(row.status) && id !== keepId && now - row.statusSince >= keepMs()
  })
}

/** Drops the ended rows, every demo row and their logs (`/agent-den clear`, a /clear or a resume). Gives the count. */
async function dropEndedRows($: EngineInterface): Promise<number> {
  return serial(async () => {
    const agents = await read($, agentsAtom)
    const demo = demoIds(agents)
    const kept = withoutIds(agents, await read($, orderAtom), demo)
    const r = dropEnded(kept.agents, kept.order, await read($, logsAtom))
    const removed = [...demo, ...r.removed]
    if (removed.length === 0) return 0
    await update($, agentsAtom, () => r.agents)
    await update($, orderAtom, () => r.order)
    await update($, logsAtom, () => Object.fromEntries(Object.entries(r.logs).filter(([id]) => !demo.includes(id))))
    for (const id of removed) forgetRow(id)
    const selected = await read($, selectedIdAtom)
    if (selected !== null && removed.includes(selected)) await update($, selectedIdAtom, () => null)
    return removed.length
  })
}

/** Picks a buddy for a new row with the person's buddyMap (rt.buddyMap is set in register). */
const pick: PickFn = (type, taken) => pickBuddy(type, taken, rt.buddyMap)

/** Makes the row when it is new (ensureRow), changes it with `change` and writes it. Call it inside serial(). Gives true for a new row. */
async function changeRow(
  $: EngineInterface,
  id: string,
  now: number,
  hint: RowHint,
  change: (row: AgentRow) => AgentRow,
): Promise<boolean> {
  const made = ensureRow(await read($, agentsAtom), await read($, orderAtom), id, now, pick, hint)
  const row = made.agents[id]
  if (row === undefined) return false
  // An ended agent can wake up under the same id: read its log again from the start.
  if (isEnded(row.status)) forgetAgent(id)
  const changed = change(row)
  await update($, agentsAtom, () => ({ ...made.agents, [id]: changed }))
  if (made.added) await update($, orderAtom, () => made.order)
  return made.added
}

/** One $.agent.list() read: new rows, status merges, dropped rows, expiry, and the auto-open. */
async function poll($: EngineInterface): Promise<void> {
  let list: readonly ListedAgent[] | null = null
  try {
    list = await $.agent.list()
  } catch (err) {
    // Keep the rows as they are; expiry still runs.
    debug($, `agent.list failed: ${String(err)}`)
  }
  const now = await $.clock.now()
  const added = await serial(async () => {
    const agents = await read($, agentsAtom)
    const order = await read($, orderAtom)
    const up = list === null ? { agents, order, changed: false, added: [] as string[] } : upsertListed(agents, order, list, now, pick)
    const selectedId = await read($, selectedIdAtom)
    const ended = expire(up.agents, up.order, now, keepMs(), selectedId)
    // A live demo row goes after keepFinishedMinutes, like the demo's ended rows.
    const demo = staleDemoIds(ended.agents, now, selectedId)
    const ex = demo.length === 0 ? ended : { ...withoutIds(ended.agents, ended.order, demo), removed: [...ended.removed, ...demo] }
    // A workflow row that missed its turn.complete ends here; expiry removes it keepFinishedMinutes later.
    const stale = staleUnlistedIds(ex.agents, now)
    const rows: Record<string, AgentRow> = stale.length === 0 ? ex.agents : { ...ex.agents }
    for (const id of stale) {
      const row = rows[id]
      if (row !== undefined) rows[id] = endStale(row, now)
    }
    for (const [id, row] of Object.entries(rows)) {
      const was = agents[id]
      if (was !== undefined && isEnded(was.status) && isLive(row.status)) forgetAgent(id)
    }
    if (up.changed || ex.removed.length > 0 || stale.length > 0) await update($, agentsAtom, () => rows)
    if (up.added.length > 0 || ex.removed.length > 0) await update($, orderAtom, () => ex.order)
    if (ex.removed.length > 0) {
      const removed = ex.removed
      await update($, logsAtom, logs => Object.fromEntries(Object.entries(logs).filter(([id]) => !removed.includes(id))))
      for (const id of removed) forgetRow(id)
    }
    return up.added
  })
  if (added.length > 0) await autoOpen($)
}

/** One read of an agent's messages. A deny or an empty answer keeps the log the mod has. */
async function readLog($: EngineInterface, id: string, now: number): Promise<void> {
  rt.logReadAt[id] = now
  // A tool.call that starts while the read is out is newer than the transcript the read gives.
  const toolsBefore = (await read($, agentsAtom))[id]?.toolCount ?? 0
  const msgs = await $.session.messages({ agentId: id }).catch((err: unknown) => {
    debug($, `session.messages failed for ${id}: ${String(err)}`)
    return null
  })
  if (msgs === null) return
  if (!Array.isArray(msgs)) {
    rt.deniedUntil[id] = now + 10_000
    return
  }
  if (msgs.length === 0) return
  const lines = messagesToLog(msgs, rt.opts.maxLogLines, now)
  const cur = currentFromMessages(msgs)
  await serial(async () => {
    if (!sameLog((await read($, logsAtom))[id] ?? [], lines)) await update($, logsAtom, logs => ({ ...logs, [id]: lines }))
    const row = (await read($, agentsAtom))[id]
    if (row === undefined) return
    const toolCount = Math.max(row.toolCount, cur.toolCount)
    // The transcript says which tool is in flight: none means the agent thinks or writes text.
    const currentTool = row.toolCount > toolsBefore ? row.currentTool : cur.currentTool
    const lastText = cur.lastText ?? row.lastText
    if (toolCount === row.toolCount && currentTool === row.currentTool && lastText === row.lastText) return
    const { currentTool: _old, ...rest } = row
    const merged: AgentRow = {
      ...rest,
      toolCount,
      ...(currentTool !== undefined ? { currentTool } : {}),
      ...(lastText !== undefined ? { lastText } : {}),
    }
    await update($, agentsAtom, agents => ({ ...agents, [id]: merged }))
  })
}

/**
 * At most 2 session.messages calls a tick: the selected live agent (each 1 s), the ended agents one
 * time after they end, then the other live agents round-robin (each 3 s). Demo and workflow rows are
 * never read: a workflow agent's messages are always denied.
 */
async function refreshLogs($: EngineInterface, now: number): Promise<void> {
  const agents = await read($, agentsAtom)
  const order = await read($, orderAtom)
  const selectedId = await read($, selectedIdAtom)
  const canRead = (id: string): boolean => {
    const row = agents[id]
    return row !== undefined && !id.startsWith(DEMO_PREFIX) && row.type !== 'workflow' && !((rt.deniedUntil[id] ?? 0) > now)
  }
  const due: string[] = []
  const lastRead = (id: string): number => rt.logReadAt[id] ?? -Infinity
  if (selectedId !== null && canRead(selectedId)) {
    const row = agents[selectedId]
    if (row !== undefined && isLive(row.status) && now - lastRead(selectedId) >= 1000) due.push(selectedId)
  }
  for (const id of order) {
    if (due.length >= 2) break
    const row = agents[id]
    if (row !== undefined && isEnded(row.status) && rt.finalRead[id] !== true && canRead(id) && !due.includes(id)) due.push(id)
  }
  const others = order.filter(id => id !== selectedId && canRead(id) && isLive(agents[id]?.status ?? 'completed'))
  for (let i = 0; i < others.length && due.length < 2; i++) {
    const at = (rt.logCursor + i) % others.length
    const id = others[at]
    if (id === undefined || due.includes(id) || now - lastRead(id) < 3000) continue
    due.push(id)
    rt.logCursor = at + 1
  }
  for (const id of due) {
    const row = agents[id]
    await readLog($, id, now)
    // One read after the end is enough, whatever it answered: a finished agent can deny for good.
    if (row !== undefined && isEnded(row.status)) rt.finalRead[id] = true
  }
}

/** Every 500 ms: poll every second tick, refresh the logs, the status line, and now/frame only when the drawing would change. */
async function tick($: EngineInterface): Promise<void> {
  if (rt.isTicking) return
  rt.isTicking = true
  try {
    rt.ticks += 1
    if (rt.ticks % 2 === 1) await poll($)
    const now = await $.clock.now()
    await refreshLogs($, now)
    const agents = await read($, agentsAtom)
    const text = summary(agents)
    if (text !== rt.lastStatusText) {
      rt.lastStatusText = text
      $.ui.status(text)
    }
    const panes = await $.ui.panes()
    if (!panes.some(p => p.id === PANE || p.id === LOG_PANE)) return
    // Idle costs nothing: write only when the next frame or the clock changes what a pane draws.
    const frame = await read($, frameAtom)
    const o = { animations: rt.opts.animations, keepFinishedMs: keepMs() }
    const still = animKey(agents, now, frame, o)
    const moved = animKey(agents, now, frame + 1, o)
    // `calm` draws a new ASCII frame every second frame: look two frames ahead, or the frame never leaves 0.
    const isMoving = moved !== still || (rt.opts.animations === 'calm' && animKey(agents, now, frame + 2, o) !== still)
    if (isMoving) {
      await update($, frameAtom, () => frame + 1)
      await update($, nowAtom, () => now)
      rt.lastKey = moved
    } else if (still !== rt.lastKey) {
      await update($, nowAtom, () => now)
      rt.lastKey = still
    }
  } finally {
    rt.isTicking = false
  }
}

/** Puts seven demo buddies in the den, one for each status, and shows it. */
async function runDemo($: EngineInterface): Promise<void> {
  const demo = demoState(await $.clock.now())
  await serial(async () => {
    await update($, agentsAtom, agents => ({ ...agents, ...demo.agents }))
    await update($, orderAtom, order => [...order, ...demo.order.filter(id => !order.includes(id))])
    await update($, logsAtom, logs => ({ ...logs, ...demo.logs }))
  })
  await update($, isDenHiddenAtom, () => false)
  await openDen($)
}

export const register: Register = (on, options) => {
  rt.opts = readOptions(options)
  rt.buddyMap = parseBuddyMap(rt.opts.buddyMap)

  on('session.start', async ($, e, next) => {
    // Also runs after a hot reload: the state survives, the timers do not.
    resetRuntime()
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Agent den: show, hide, log <n>, clear, demo',
        argumentHint: '[show|hide|log <n>|clear|demo]',
      })
    } catch (err) {
      debug($, `registering /${COMMAND} failed: ${String(err)}`)
    }
    rt.timer?.cancel()
    rt.timer = $.clock.every(500, () => {
      void tick($).catch(err => debug($, `tick failed: ${String(err)}`))
    })
    try {
      await poll($)
    } catch (err) {
      debug($, `the first poll failed: ${String(err)}`)
    }
    $.ui.log(`agent-den v${BUILD} ready`, { to: 'debug' })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    const r = await next(e)
    try {
      const now = await $.clock.now()
      const found = await lookUp($, id)
      // In a subagent, e.text is the brief: the description of a workflow row and the first log line.
      // An unlisted id with no brief makes no row: a workflow agent's run starts with one, and the engine's
      // forks (compaction, memory) are no subagents. No event tells a fork with a prompt from a workflow
      // agent; if such a row misses its turn.complete, poll() ends it (staleUnlistedIds).
      const hint: RowHint | null =
        found.kind === 'listed' ? found.hint : found.kind === 'row' || e.text.trim() !== '' ? { description: firstLine(e.text, 60) } : null
      const added = await serial(async () => {
        if (hint === null && (await read($, agentsAtom))[id] === undefined) return false
        const isNew = await changeRow($, id, now, hint ?? {}, row => onTurnStart(row, now))
        heardAt[id] = now
        if (((await read($, logsAtom))[id] ?? []).length === 0 && e.text.trim() !== '') {
          await appendLog($, id, [{ at: now, kind: 'status', text: `brief: ${firstLine(e.text, 200)}` }])
        }
        return isNew
      })
      if (added) await autoOpen($)
    } catch (err) {
      debug($, `turn.start for ${id} failed: ${String(err)}`)
    }
    return r
  }).catch(($, e, next) => next(e))

  // Agent, Task, Workflow and Skill can start agents: a hook that wraps them would not hear those agents.
  on('tool.call', { tool: /^(?!(Agent|Task|Workflow|Skill)$)/ }, async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    // Set only when the row took this call: the end of the call removes it from the card again.
    let started: string | undefined
    try {
      const now = await $.clock.now()
      // The tool's arguments sit on e itself; toolLabel reads only named keys for each tool.
      const label = toolLabel(String(e.tool), e as unknown as Readonly<Record<string, unknown>>)
      // Only a known or listed id gets a row here. An unlisted id is a workflow agent, whose turn.start
      // makes its row from the brief, or an engine fork (compaction, memory), which is no subagent.
      const found = await lookUp($, id)
      const hint = found.kind === 'listed' ? found.hint : found.kind === 'row' ? {} : null
      const added = await serial(async () => {
        if (hint === null && (await read($, agentsAtom))[id] === undefined) return null
        const isNew = await changeRow($, id, now, hint ?? {}, row => onToolStart(row, label, now))
        heardAt[id] = now
        await appendLog($, id, [{ at: now, kind: 'tool', text: `▸ ${label}` }])
        return isNew
      })
      if (added !== null) {
        started = label
        // A stale-row check never ends a row while one of its calls runs (a long Bash, a held permission).
        toolsInFlight[id] = (toolsInFlight[id] ?? 0) + 1
      }
      if (added === true) await autoOpen($)
    } catch (err) {
      debug($, `tool.call for ${id} failed: ${String(err)}`)
    }
    // Outside serial: a held tool call must never block the other writers.
    let r: Awaited<ReturnType<typeof next>>
    try {
      r = await next(e)
    } finally {
      if (started !== undefined) {
        const n = (toolsInFlight[id] ?? 1) - 1
        if (n > 0) toolsInFlight[id] = n
        else delete toolsInFlight[id]
      }
    }
    // A call that no row took has no log.
    if (started === undefined) return r
    try {
      const now = await $.clock.now()
      // The same lines messagesToLog makes, so a later refresh gives no jump.
      const lines =
        r.deny !== undefined ? resultLines(r.deny, 'error', now) : resultLines(r.text ?? '', r.isError === true ? 'error' : 'result', now)
      await serial(async () => {
        // The row can be gone (clear, expiry): then its log is gone too.
        const row = (await read($, agentsAtom))[id]
        if (row === undefined) return
        heardAt[id] = now
        await appendLog($, id, lines)
        // The tool is done: the card stops showing it, unless a later call of the agent took its place.
        if (row.currentTool !== started) return
        const { currentTool: _done, ...rest } = row
        await update($, agentsAtom, agents => ({ ...agents, [id]: rest }))
      })
    } catch (err) {
      debug($, `logging a result for ${id} failed: ${String(err)}`)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    try {
      const now = await $.clock.now()
      // Cleaned like every engine string a pane draws: a control character makes a desktop refuse the drawing.
      const model = firstLine(e.usage?.model ?? '', 60)
      await serial(async () => {
        const row = (await read($, agentsAtom))[id]
        if (row === undefined) return
        heardAt[id] = now
        const done = onTurnComplete(row, e.reason, e.answer, now)
        const ended = model !== '' ? { ...done, model } : done
        await update($, agentsAtom, agents => ({ ...agents, [id]: ended }))
      })
    } catch (err) {
      debug($, `turn.complete for ${id} failed: ${String(err)}`)
    }
    // Never a text of our own: it would show under the answer.
    return next(e)
  }).catch(($, e, next) => next(e))

  // Esc or the engine closing a pane. A Button's own $.ui.close does not reach this hook, so each press writes its own state.
  on('ui.close', async ($, e, next) => {
    const effect = closeEffect(e.id, e.origin.kind, { den: PANE, log: LOG_PANE })
    if (effect.hideDen === true) await update($, isDenHiddenAtom, () => true)
    if (effect.clearSelected === true) await update($, selectedIdAtom, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    // A /clear or a resume goes on in this process under another conversation.
    if (e.reason === 'clear' || e.reason === 'resume') {
      try {
        await dropEndedRows($)
      } catch (err) {
        debug($, `dropping the ended rows failed: ${String(err)}`)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', async ($, e, next) => {
    const name = String(e.command)
    if (name !== COMMAND && !name.endsWith(`:${COMMAND}`)) return next(e)
    // Keep the case of the rest: `log <name>` matches names as typed.
    const [head = '', ...rest] = String(e.args ?? '').trim().split(/\s+/)
    switch (head.toLowerCase()) {
      case '': {
        // Close only a den the person can see: one that waits undrawn is opened (and so drawn) instead.
        const isShown = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
        if (isShown) {
          await update($, isDenHiddenAtom, () => true)
          await closePane($, PANE)
          return { text: 'Agent den hidden. /agent-den shows it again.' }
        }
        await update($, isDenHiddenAtom, () => false)
        await openDen($)
        return { text: 'Agent den shown.' }
      }
      case 'show':
        await update($, isDenHiddenAtom, () => false)
        await openDen($)
        return { text: 'Agent den shown.' }
      case 'hide':
        await update($, isDenHiddenAtom, () => true)
        await closePane($, PANE)
        return { text: 'Agent den hidden. /agent-den show brings it back.' }
      case 'log': {
        const target = rest.join(' ')
        if (target === '') return { text: 'Usage: /agent-den log <n|name>' }
        const agents = await read($, agentsAtom)
        const tree = treeOrder(agents, await read($, orderAtom))
        let id: string | undefined
        if (/^\d+$/.test(target)) {
          id = tree[Number(target) - 1]?.id
        } else {
          const t = target.toLowerCase()
          const named = (row: AgentRow): boolean => row.name?.toLowerCase() === t || resolveBuddy(row.buddy).displayName.toLowerCase() === t
          id =
            tree.find(n => agents[n.id] !== undefined && named(agents[n.id] as AgentRow))?.id ??
            tree.find(n => agents[n.id]?.description.toLowerCase().includes(t) === true)?.id
        }
        const row = id === undefined ? undefined : agents[id]
        if (id === undefined || row === undefined) return { text: `agent-den: no buddy matches "${target}".` }
        await openLog($, id)
        return { text: `Showing the output of ${resolveBuddy(row.buddy).displayName}.` }
      }
      case 'clear': {
        const n = await dropEndedRows($)
        return { text: n === 0 ? 'No finished or demo buddies to clear.' : `Cleared ${n} ${n === 1 ? 'buddy' : 'buddies'}.` }
      }
      case 'demo':
        await runDemo($)
        return { text: 'Seven demo buddies, one for each status. /agent-den clear removes them.' }
      default:
        return { text: USAGE }
    }
  }).catch(($, e, next) => (next.called ? next(e) : { text: `agent-den: the command failed: ${next.error.message ?? next.error.kind}` }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const agents = await read($, agentsAtom)
    const order = await read($, orderAtom)
    const frame = await read($, frameAtom)
    const now = (await read($, nowAtom)) || (await $.clock.now())
    const animations = rt.opts.animations
    const keep = keepMs()
    const cards = treeOrder(agents, order).flatMap(({ id, depth }) => {
      const row = agents[id]
      return row === undefined ? [] : [{ id, depth, row, b: resolveBuddy(row.buddy) }]
    })
    const counts = STATUS_ORDER.map(s => ({ s, n: cards.filter(c => c.row.status === s).length })).filter(c => c.n > 0)

    const onHide = async (): Promise<void> => {
      // Our own $.ui.close does not run our ui.close hook: write the state here.
      await update($, isDenHiddenAtom, () => true)
      await closePane($, PANE)
    }
    const statusLine = (row: AgentRow): string =>
      `${STATUS_DOT[row.status]} ${STATUS_LABEL[row.status]} · ${formatElapsed(elapsedOf(row, now))} · ${row.type}`
    const activity = (row: AgentRow): string =>
      row.status === 'running'
        ? `${SPINNER[frame % SPINNER.length] ?? ''} ${row.currentTool ?? 'thinking…'}`
        : (row.lastText ?? '')
    const spriteColor = (row: AgentRow, b: ResolvedBuddy): string =>
      row.status === 'failed' || row.status === 'killed' ? statusColor(row.status) : b.accent

    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const header = (
      <Box gap={2} justifyContent="space-between">
        <Box gap={2} flexWrap="wrap" flexShrink={1}>
          <Text weight="bold" color={THEME.accent}>
            Agent den
          </Text>
          {counts.map(c => (
            <Text color={statusColor(c.s)}>{`${STATUS_DOT[c.s]} ${c.n} ${STATUS_LABEL[c.s]}`}</Text>
          ))}
        </Box>
        <Button key="hide" hotkey="x" role="dismiss" plain dimColor onPress={() => void onHide()}>
          hide
        </Button>
      </Box>
    )
    const emptyText = 'No buddies out yet. They show up when Claude starts a subagent.'
    const demoButton = (
      <Button key="demo" hotkey="d" plain dimColor onPress={() => void runDemo($)}>
        demo
      </Button>
    )
    const hotkey = (i: number): string | undefined => (i < 9 ? String(i + 1) : undefined)
    // About 34 columns a card, never wider than the pane leaves (paddingX and the child indent).
    const cardWidth = (depth: number): number => Math.max(20, Math.min(34, e.props.bodyColumns - 2 - 2 * depth))

    if (e.surface !== 'terminal' && 'Svg' in els) {
      const { Svg } = els
      if (cards.length === 0) {
        return (
          <Box flexDirection="column" paddingX={1} gap={1}>
            {header}
            <Box gap={2} alignItems="center">
              <Svg source={emptyDenSvg(96)} alt="An empty den: the buddies are asleep" width={96} height={96} isInteractive />
              <Box flexDirection="column" flexShrink={1} gap={1}>
                <Text color={THEME.dim}>{emptyText}</Text>
                <Box>{demoButton}</Box>
              </Box>
            </Box>
          </Box>
        )
      }
      return (
        <Box flexDirection="column" paddingX={1} gap={1}>
          {header}
          <Box flexWrap="wrap" gap={1}>
            {cards.map(({ id, depth, row, b }, i) => {
              const transition = transitionFor(row, now, keep)
              const isLeaving = transition === 'leave'
              return (
                <Box
                  key={`card-${id}`}
                  width={cardWidth(depth)}
                  marginLeft={2 * depth}
                  borderStyle="round"
                  borderColor={b.accent}
                  borderDimColor
                  hover={{ borderColor: statusColor(row.status), backgroundColor: CARD_HOVER_BG }}
                  paddingX={1}
                  gap={1}
                  alignItems="center"
                >
                  {/* Only stable inputs go into the SVG: a changed source reloads it and restarts the loops. */}
                  <Svg
                    source={buddySvg(b, row.status, {
                      sizePx: 48,
                      transition,
                      animations,
                      bubble: row.status === 'running' ? 'thinking' : undefined,
                    })}
                    alt={`${b.displayName} the ${b.species}, ${STATUS_LABEL[row.status]}`}
                    width={48}
                    height={48}
                    isInteractive
                  />
                  <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                    <Text weight="bold" color={b.accent} dimColor={isLeaving} wrap="truncate-end">
                      {b.displayName}
                    </Text>
                    <Text color={THEME.ink} dimColor={isLeaving} wrap="truncate-end">
                      {row.description}
                    </Text>
                    <Text color={statusColor(row.status)} dimColor={isLeaving} tabular wrap="truncate-end">
                      {statusLine(row)}
                    </Text>
                    <Text color={THEME.dim} wrap="truncate-end">
                      {activity(row)}
                    </Text>
                    <Box>
                      <Button key={`open-${id}`} hotkey={hotkey(i)} dimColor={isLeaving} onPress={() => void openLog($, id)}>
                        output ›
                      </Button>
                    </Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    if (cards.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1}>
          {header}
          <Box gap={1}>
            <Box flexDirection="column" width={ASCII_W} flexShrink={0}>
              {EMPTY_DEN_ASCII.map(line => (
                <Text color={THEME.ghost}>{line}</Text>
              ))}
            </Box>
            <Box flexDirection="column" flexShrink={1}>
              <Text color={THEME.dim}>{emptyText}</Text>
              <Box>{demoButton}</Box>
            </Box>
          </Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        {cards.map(({ id, depth, row, b }, i) => {
          const isLeaving = transitionFor(row, now, keep) === 'leave'
          const color = spriteColor(row, b)
          const sprite = buddyAscii(b, row.status, asciiFrameFor(row, now, frame, animations), animations)
          // The row Button holds one line: name and description, cut to what the pane leaves beside the sprite.
          const room = e.props.bodyColumns - ASCII_W - 4 - 2 * depth - [...b.displayName].length - 5
          const desc = room > 1 ? firstLine(row.description, room) : ''
          const act = activity(row)
          return (
            <Box key={`row-${id}`} gap={1} paddingLeft={2 * depth}>
              <Box flexDirection="column" width={ASCII_W} flexShrink={0}>
                {sprite.map(line => (
                  <Text color={color} dimColor={isLeaving}>
                    {line}
                  </Text>
                ))}
              </Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Box>
                  <Button key={`open-${id}`} plain hotkey={hotkey(i)} dimColor={isLeaving} onPress={() => void openLog($, id)}>
                    {b.displayName} <Text dimColor>{desc}</Text>
                  </Button>
                </Box>
                <Text color={statusColor(row.status)} dimColor wrap="truncate-end">
                  {act === '' ? statusLine(row) : `${statusLine(row)} · ${act}`}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e) => {
    const selectedId = await read($, selectedIdAtom)
    const row = selectedId === null ? undefined : (await read($, agentsAtom))[selectedId]
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    if (selectedId === null || row === undefined) {
      return (
        <Box paddingX={1}>
          <Text color={THEME.dim}>Pick a buddy in the den</Text>
        </Box>
      )
    }
    const id = selectedId
    const frame = await read($, frameAtom)
    const now = (await read($, nowAtom)) || (await $.clock.now())
    const animations = rt.opts.animations
    const b = resolveBuddy(row.buddy)
    const lines = (await read($, logsAtom))[id] ?? []
    const shown = lines.slice(-Math.max(5, (e.props.scroll.bodyRows || 30) - 8))
    const transition = transitionFor(row, now, keepMs())
    const accent = row.status === 'failed' || row.status === 'killed' ? statusColor(row.status) : b.accent

    const onBack = async (): Promise<void> => {
      await update($, selectedIdAtom, () => null)
      // The person asked for the den: it is no longer hidden.
      await update($, isDenHiddenAtom, () => false)
      await openDen($)
      await closePane($, LOG_PANE)
    }
    const onClose = async (): Promise<void> => {
      // Our own $.ui.close does not run our ui.close hook: clear the selection here.
      await update($, selectedIdAtom, () => null)
      await closePane($, LOG_PANE)
    }
    const onView = async (): Promise<void> => {
      if (id.startsWith(DEMO_PREFIX)) {
        $.ui.toast('This is a demo buddy.')
        return
      }
      try {
        const r = await $.ui.view({ agentId: id })
        if (r.deny !== undefined) $.ui.toast(`agent-den: no transcript to show: ${firstLine(r.deny, 200)}`)
      } catch (err) {
        $.ui.toast(`agent-den: no transcript to show: ${firstLine(String(err), 200)}`)
      }
    }

    const facts = [
      `${STATUS_DOT[row.status]} ${STATUS_LABEL[row.status]} · ${formatElapsed(elapsedOf(row, now))}`,
      row.model === undefined ? row.type : `${row.type} · ${row.model}`,
      `${row.toolCount} ${row.toolCount === 1 ? 'tool' : 'tools'} · ${row.turnCount} ${row.turnCount === 1 ? 'turn' : 'turns'}`,
    ]
    const buttons = (
      <Box gap={2}>
        <Button key="back" hotkey="b" plain dimColor onPress={() => void onBack()}>
          ‹ back
        </Button>
        {row.type === 'workflow' ? null : (
          <Button key="view" hotkey="t" plain onPress={() => void onView()}>
            full transcript
          </Button>
        )}
        <Button key="close" hotkey="x" role="dismiss" plain dimColor onPress={() => void onClose()}>
          close
        </Button>
      </Box>
    )
    const waiting = `Waiting for ${b.displayName} to say something…`

    if (e.surface !== 'terminal' && 'Svg' in els) {
      const { Svg, Code } = els
      const sprite = (status: AgentRow['status'], sizePx: number, t: typeof transition) => (
        <Svg
          source={buddySvg(b, status, { sizePx, transition: t, animations, bubble: status === 'running' ? 'thinking' : undefined })}
          alt={`${b.displayName} the ${b.species}, ${STATUS_LABEL[status]}`}
          width={sizePx}
          height={sizePx}
          isInteractive
        />
      )
      // Code takes at most 100,000 characters: keep the newest lines that fit in 90,000.
      let source = ''
      for (let i = shown.length - 1; i >= 0; i--) {
        const text = shown[i]?.text ?? ''
        const nextSource = source === '' ? text : `${text}\n${source}`
        if (nextSource.length > 90_000) break
        source = nextSource
      }
      return (
        <Box flexDirection="column" paddingX={1} gap={1}>
          <Box gap={2} alignItems="center">
            {sprite(row.status, 72, transition)}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Text weight="bold" color={accent} wrap="truncate-end">
                {b.displayName}
              </Text>
              <Text color={THEME.ink} wrap="truncate-end">
                {row.description}
              </Text>
              {facts.map(f => (
                <Text color={THEME.dim} tabular wrap="truncate-end">
                  {f}
                </Text>
              ))}
            </Box>
          </Box>
          {buttons}
          {shown.length === 0 ? (
            <Box gap={2} alignItems="center">
              {sprite('running', 48, null)}
              <Text color={THEME.dim}>{waiting}</Text>
            </Box>
          ) : (
            <Code language="text" wrap="wrap" source={source} />
          )}
        </Box>
      )
    }

    const asciiOf = (status: AgentRow['status']): string[] =>
      buddyAscii(b, status, asciiFrameFor({ ...row, status }, now, frame, animations), animations)
    const lineColor = (kind: LogLine['kind']): string =>
      kind === 'tool' ? b.accent : kind === 'error' ? THEME.cold : kind === 'status' ? THEME.ghost : THEME.ink
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box gap={1}>
          <Box flexDirection="column" width={ASCII_W} flexShrink={0}>
            {asciiOf(row.status).map(line => (
              <Text color={accent}>{line}</Text>
            ))}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box gap={1}>
              <Text weight="bold" color={accent}>
                {b.displayName}
              </Text>
              <Box flexShrink={1}>
                <Text dimColor wrap="truncate-end">
                  {firstLine(row.description, 200)}
                </Text>
              </Box>
            </Box>
            <Text color={THEME.dim} wrap="truncate-end">
              {facts.join(' · ')}
            </Text>
            {buttons}
          </Box>
        </Box>
        {shown.length === 0 ? (
          <Box gap={1}>
            <Box flexDirection="column" width={ASCII_W} flexShrink={0}>
              {asciiOf('running').map(line => (
                <Text color={b.accent}>{line}</Text>
              ))}
            </Box>
            <Text color={THEME.dim}>{waiting}</Text>
          </Box>
        ) : (
          shown.map(l => (
            <Text color={lineColor(l.kind)} dimColor={l.kind === 'result'} wrap="truncate-end">
              {l.text}
            </Text>
          ))
        )}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
