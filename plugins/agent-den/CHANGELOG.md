# Changelog

## 0.1.0 (2026-10-23)

- First version. The Agent den pane shows one animated pixel buddy for each subagent, with its status (hatching, busy, waiting, napping, done, oops, stopped), its elapsed time, its type and the tool it runs now.
- Ten buddies (Digby, Bricks, Bolt, Pip, Bristle, Mochi, Nib, Moss, Puff, Tansy). A buddy is picked by agent type first, then by order. Agents that run at the same time never share a buddy: past the roster, a recoloured variant ("Digby II") is made.
- Each status has its own loop, and each status change plays a one-shot transition (hatch, a jump with confetti, a head shake, a fade out before a finished buddy leaves). SVG with SMIL on Desktop, VS Code and mobile; one-cell ASCII frames in the terminal. `animations: calm` drops the bounce and the confetti, `off` is static.
- Click a buddy (or press its number) to open its output in a second pane: the tool calls, the first lines of each result and the assistant text, refreshed from the agent's messages. `full transcript` opens the agent's own transcript in the main view.
- The den opens by itself on the first subagent of a session. Hide it with the `hide` button, Esc or `/agent-den hide`; it then stays hidden until you open it again.
- `/agent-den [show|hide|log <n>|clear|demo]`. `demo` shows seven buddies, one for each status.
- The status line shows a short summary, for example `🐾 2 busy · 1 napping · 3 done`.
