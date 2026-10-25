// agent-den state contract. Every $.state key the mod reads or writes is declared here.
// Types only: no imports, no values. A row value is never `undefined`; optional fields are left out instead.

export type DenStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
export type BuddyRef = { key: string; variant: number } // variant 0 = the roster original
export type AgentRow = {
  id: string
  description: string
  type: string // AgentInfo.type, or 'workflow' / 'agent' when unlisted
  name?: string // AgentInfo.name (SendMessage address)
  model?: string
  parentId?: string
  buddy: BuddyRef
  status: DenStatus
  statusSince: number // ms; start of the one-shot transition
  startedAt: number
  endedAt?: number
  currentTool?: string // short label, e.g. "Read src/a.ts"
  toolCount: number
  turnCount: number
  lastText?: string // last assistant text line (speech bubble)
  lastReason?: 'answer' | 'aborted' | 'refusal' | 'error'
  isListed: boolean // seen in $.agent.list() on the last poll
}
export type LogLine = { at: number; kind: 'tool' | 'result' | 'text' | 'error' | 'status'; text: string }
declare module 'claude-code' {
  interface PluginState {
    'agent-den': {
      agents: Record<string, AgentRow>
      order: string[] // first-seen order
      logs: Record<string, LogLine[]> // last read log per agent, capped at maxLogLines
      selectedId: string | null
      isDenHidden: boolean // the person hid the den: no auto-open again this session
      hasAutoOpened: boolean
      frame: number // terminal animation frame counter
      now: number // last tick time (drives elapsed + transitions)
    }
  }
}
