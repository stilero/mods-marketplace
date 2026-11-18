/** True once "pay ransom" was pressed: the band shows the lesson. */
export type Paid = boolean

declare module 'claude-code' {
  interface PluginState {
    'security-advisor': {
      /** The terminal animation's frame counter. */
      frame: number
      paid: Paid
      /** True once a prompt was blocked: the band above the prompt shows the screen. */
      pwned: boolean
    }
  }
}
