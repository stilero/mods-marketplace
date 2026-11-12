# Changelog

## 0.1.0 (2026-11-12)

- First version. Cog weighs the first prompt of each conversation (start, `/clear`, compaction) with Haiku: how demanding the work is, and the lowest model and effort that will do it well.
- Gate mode (default): a prompt that fits another model or effort waits in the band above the prompt with three choices: use the advised setup (Cog runs `/model` and `/effort`, then sends the prompt), send anyway, or keep the prompt.
- Hints mode: the prompt goes at once, and the band shows the advice with a button that switches for the next prompt.
- Advice in both directions: shift down when a lower setup is enough, shift up when the work needs more. `Gate on` selects which of the two holds the prompt.
- The Model advisor pane opens in the band's place when another mod keeps the band or the band is collapsed.
- `/model-advisor [next|open|switch|send|keep|mode gate|hints|off]`, a configurable model ladder, an effort tolerance, and stats of the shifts taken.
- Cog is pixel art with SMIL animation on the desktop and in VS Code, and two-frame ASCII in the terminal.
