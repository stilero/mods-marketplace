// Module-level runtime the hooks share. Nothing here must survive a hot reload:
// everything a drawing reads lives in $.state (see types/index.d.ts).
import { DEFAULT_LADDER } from './options'
import type { Opts } from './options'

export const rt: {
  opts: Opts
  /** True while Cog weighs a prompt, so a second prompt is not weighed on top of it. */
  isReading: boolean
  /**
   * True from a /clear until the next prompt. $.state belongs to the conversation, and the one a /clear
   * starts raises no session.start, so its first prompt arms Cog there.
   */
  isCleared: boolean
  /** The id of the advice the band above the prompt last drew, 0 for none: tells whether the band shows it. */
  bandShows: number
  /** True while the pane this mod opened as the band's stand-in is open. */
  isPaneOpen: boolean
} = {
  opts: {
    mode: 'gate',
    gateOn: 'both',
    trigger: 'conversation',
    model: 'haiku',
    ladder: [...DEFAULT_LADDER],
    effortTolerance: 1,
    minChars: 20,
  },
  isReading: false,
  isCleared: false,
  bandShows: 0,
  isPaneOpen: false,
}
