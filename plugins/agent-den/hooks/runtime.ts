// Module-level runtime the hooks share. Nothing here must survive a hot reload:
// everything a drawing reads lives in $.state (see types/index.d.ts). These are guards, cursors and caches.
import type { Opts } from './options'

export const rt: {
  opts: Opts
  /** parseBuddyMap(opts.buddyMap), set in register(). */
  buddyMap: Record<string, string>
  /** The one $.clock.every ticker; session.start cancels it before it starts a new one. */
  timer: { cancel(): void } | null
  /** Tick counter since session.start (odd ticks poll the agent list). */
  ticks: number
  /** Guard: a tick never overlaps the one before. */
  isTicking: boolean
  /** The last text sent to $.ui.status; null = never sent. */
  lastStatusText: string | undefined | null
  /** animKey of the last now/frame write. */
  lastKey: string
  /** Last session.messages read per agent id. */
  logReadAt: Record<string, number>
  /** Round-robin index over the live agents that are not selected. */
  logCursor: number
  /** Ended agents whose last log is read (one read after the end). */
  finalRead: Record<string, true>
  /** Back-off after a { deny }: no read before this time. */
  deniedUntil: Record<string, number>
} = {
  opts: { autoOpen: true, keepFinishedMinutes: 10, animations: 'full', buddyMap: '', maxLogLines: 300 },
  buddyMap: {},
  timer: null,
  ticks: 0,
  isTicking: false,
  lastStatusText: null,
  lastKey: '',
  logReadAt: {},
  logCursor: 0,
  finalRead: {},
  deniedUntil: {},
}

/** Resets everything but opts, buddyMap and timer (session.start, hot reload). */
export function resetRuntime(): void {
  // After a hot reload, lastStatusText = null sends the status again and finalRead = {} reads each
  // ended agent one more time. This is intended: both are cheap and make the drawing match the state.
  rt.ticks = 0
  rt.isTicking = false
  rt.lastStatusText = null
  rt.lastKey = ''
  rt.logReadAt = {}
  rt.logCursor = 0
  rt.finalRead = {}
  rt.deniedUntil = {}
}

/** Removes an id from logReadAt, finalRead and deniedUntil (a row expired, dropped or came back to life). */
export function forgetAgent(id: string): void {
  delete rt.logReadAt[id]
  delete rt.finalRead[id]
  delete rt.deniedUntil[id]
}

let queue: Promise<unknown> = Promise.resolve()

/** Runs fn after every earlier serial() call settles: one writer at a time for agents/order/logs. */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  // Never call next(e) or a slow $ op (one that waits on the person) inside fn: a held tool call
  // would block every later writer. A failure rejects this call only; the queue goes on.
  const p = queue.then(() => fn())
  queue = p.catch(() => undefined)
  return p
}
