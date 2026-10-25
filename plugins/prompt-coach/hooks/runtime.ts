// Module-level runtime the hooks share. Nothing here must survive a hot reload:
// everything a drawing reads lives in $.state (see types/index.d.ts).
import type { Opts } from './options'

export const rt: {
  opts: Opts
  /** True while Quill reads a prompt, so a second prompt is not read on top of it. */
  isReading: boolean
  /**
   * True from a /clear until the next prompt. $.state belongs to the conversation, and the one a /clear
   * starts raises no session.start, so its first prompt arms Quill there.
   */
  isCleared: boolean
} = {
  opts: { mode: 'hints', trigger: 'conversation', model: 'haiku', minChars: 20 },
  isReading: false,
  isCleared: false,
}
