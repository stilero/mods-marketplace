export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Complexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'deep'

/** What the advisor model says about one prompt. */
export type Reading = {
  /** False for greetings, follow-ups and prompts that lean on a conversation the advisor cannot see: no advice. */
  isWork: boolean
  complexity: Complexity
  /** The lowest model that will do the work well: a name from the ladder. */
  model: string
  effort: Effort
  /** What kind of work this is. */
  headline: string
  /** Why this model and effort fit. */
  reason: string
}

/** The session's setup when the prompt was weighed. */
export type Setup = {
  /** The main loop's model, as /model shows it. */
  model: string
  /** Its name on the ladder; null for a model the ladder does not hold. */
  tier: string | null
  /** Null while the session's effort is not known (no request yet, none saved). */
  effort: Effort | null
  /** CLAUDE_CODE_EFFORT_LEVEL names the effort: /effort cannot change it, so no effort is advised. */
  isEffortPinned: boolean
}

/** down: a lower model or effort is enough. up: the work needs more. */
export type Direction = 'down' | 'up'

/** A setup that fits the prompt better than the session's. */
export type Advice = {
  /** When it was given, in the clock's milliseconds: names it for the band and the pane. */
  id: number
  direction: Direction
  /** The model to switch to; null keeps the session's model. */
  model: string | null
  /** The effort to switch to; null keeps the session's effort. */
  effort: Effort | null
  reading: Reading
  setup: Setup
  /** The conversation already holds turns, so a model switch re-caches it. */
  isMidConversation: boolean
}

/** A prompt the gate holds until the person picks. */
export type Held = { text: string; advice: Advice }

export type AdvisorMode = 'gate' | 'hints' | 'off'

/** What the band (or the pane) shows: nothing (idle), the read in progress, a held prompt, or advice for the next prompt. */
export type AdvisorView = 'idle' | 'reading' | 'held' | 'hint'

export type AdvisorStats = {
  /** Prompts weighed, across sessions. */
  weighed: number
  /** Prompts whose setup already fitted. */
  fit: number
  /** Switches taken to a lower setup. */
  down: number
  /** Switches taken to a higher setup. */
  up: number
}

declare module 'claude-code' {
  interface PluginState {
    'model-advisor': {
      armed: boolean
      view: AdvisorView
      advice: Advice | null
      held: Held | null
      modeOverride: AdvisorMode | null
      /** The effort of the main loop's last request, or the one this mod set. */
      effort: Effort | null
      /** Flips once a second while the band shows, for the terminal's two-frame art. */
      frame: number
      stats: AdvisorStats | null
    }
  }
}
