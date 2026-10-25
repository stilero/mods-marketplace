export type CriterionKey = 'goal' | 'why' | 'constraints' | 'done' | 'reuse'
export type CriterionStatus = 'present' | 'missing' | 'n/a'

export type Criterion = {
  status: CriterionStatus
  /** What the prompt says, why the part does not apply, or what is absent. */
  note: string
  /** For a missing part: one question, specific to this prompt, that would fill it. */
  ask: string
}

export type Analysis = {
  /** False for questions, follow-ups and tiny fully specified edits: those are not coached. */
  isTask: boolean
  headline: string
  criteria: Record<CriterionKey, Criterion>
}

/** How many parts apply to the prompt and how many of those it covers. */
export type Score = { applicable: number; present: number }

/** A prompt the gate holds until the person picks. */
export type Held = { text: string; analysis: Analysis }

export type CoachMode = 'hints' | 'gate' | 'off'

/**
 * What the pane shows: the five parts (idle), the read in progress, the checklist as a hint for next time,
 * a complete brief, a held prompt, a prompt being improved in the composer, or one sent with Claude asking.
 */
export type CoachView = 'idle' | 'reading' | 'hint' | 'passed' | 'held' | 'improving' | 'asking'

export type CoachStats = {
  /** Task prompts coached, across sessions. */
  checked: number
  /** Coverage (present / applicable) of the last ten coached prompts, oldest first. */
  recent: number[]
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': {
      armed: boolean
      view: CoachView
      analysis: Analysis | null
      held: Held | null
      /** The score before an "improve it", shown as before → after on the next read. */
      before: Score | null
      modeOverride: CoachMode | null
      stats: CoachStats | null
    }
  }
}
