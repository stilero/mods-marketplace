# agent-den

A Claude Code mod that shows your subagents. The Agent den is a pane with one animated pixel buddy for each subagent. You see at a glance which agents run, wait, nap or are done, and which tool each one runs now. Click a buddy to open its output in a second pane. The mod works in the terminal, in Claude Code Desktop and in VS Code.

Spec and design: [docs/agent-den-PRD.md](../../docs/agent-den-PRD.md).

## What you get

- **The den.** One card for each subagent: the buddy, its name and the task description, the status, the elapsed time, the agent type, and the current tool (with a spinner) or the last line the agent wrote. Child agents show under their parent. The header counts the agents for each status: `● 2 busy  ◐ 1 waiting  ✓ 3 done`.
- **Ten buddies.** Digby the mole, Bricks the beaver, Bolt the robot, Pip the bookworm, Bristle the hedgehog, Mochi the slime, Nib the fox kit, Moss the frog, Puff the cloud and Tansy the bunny. The agent type picks the buddy first (Explore gets Digby, Plan gets Bricks, a review agent gets Bristle), then the order. Two agents that run at the same time never share a buddy. Past ten, a recoloured variant comes in ("Digby II").
- **Animation.** Each status has its own loop: an egg that wobbles (hatching), a bounce with sparks (busy), an hourglass (waiting), floating `z`s (napping), a check badge (done), a rain cloud (oops) and a grey ghost (stopped). Each status change plays a one-shot: the buddy hatches, jumps with confetti, shakes its head, or fades out before a finished card leaves. Desktop and VS Code draw SVG; the terminal draws three-row ASCII frames.
- **The output pane.** Click `output ›` on a card (or press its number while the den has the keyboard) to see the agent's tool calls, the first lines of each result and the text it wrote. `full transcript` opens the agent's own transcript in the main view.
- **Easy to hide.** The `hide` button, Esc, or `/agent-den hide`. A hidden den stays hidden until you open it again.
- **A status line**, for example `🐾 2 busy · 1 napping · 3 done`.

The look follows [cache-thermo](../cache-thermo/): calm pastels on a dark panel, round dim borders, pixel art on the desktop and one-cell ASCII in the terminal.

## Install

At the prompt of a terminal session:

```
/plugin install agent-den --marketplace stilero/mods-marketplace
```

From a shell: `claude plugin install agent-den --marketplace stilero/mods-marketplace`. In Claude Code Desktop: `+` next to the prompt → Plugins → Add marketplace → Add plugin.

## Commands

| Command | Effect |
|---|---|
| `/agent-den` | Show the den, or hide it when it shows |
| `/agent-den show` / `hide` | Show or hide the den |
| `/agent-den log <n>` | Open the output of the agent at position `n` in the den (1 is the first card) |
| `/agent-den log <name>` | The same, by the agent's name, the buddy's name, or a word of the description |
| `/agent-den clear` | Remove the finished buddies and the demo buddies now |
| `/agent-den demo` | Show seven demo buddies, one for each status |

Keys in the den: `1`-`9` open the output of a card, `x` hides the den, `d` starts the demo in an empty den. Keys in the output pane: `b` goes back to the den, `t` opens the full transcript, `x` closes the pane.

## Settings (`/config` rows)

| Field | Default | Purpose |
|---|---|---|
| Open automatically | on | Open the den when the first subagent of a conversation starts |
| Keep finished buddies (minutes) | 10 | A finished buddy stays this long, then waves goodbye (0.5 to 240) |
| Animations | `full` | `calm` drops the bounce and the confetti and slows the loops; `off` is static |
| Buddy map | empty | Pin agent types to buddies, for example `Explore=digby, my-agent=moss` |
| Max log lines | 300 | Lines kept for each agent's output (20 to 5000) |

## How it works

- The engine has no event for the life of a subagent. The mod polls `$.agent.list()` each second for the status, the type and the description of each agent. Ended agents drop out of that list some seconds later, so the mod keeps its own record in `$.state`.
- `turn.start`, `tool.call` and `turn.complete` with an `agentId` give the live changes: busy, the current tool, a log line for each tool call, and the end of a turn.
- The `tool.call` hook leaves out `Agent`, `Task`, `Workflow` and `Skill`. A hook that wraps the call that starts an agent does not hear that agent's own events.
- A ticker (500 ms) reads `$.session.messages({ agentId })` for the output pane: the selected agent each second, the other live agents each 3 seconds, at most two reads a tick.
- The ticker writes the clock and the animation frame to the state only when the drawing changes. A den at rest costs nothing.
- The SVG of a buddy depends only on its buddy, status, transition and settings. New text never restarts its animation.

## Limits

- Workflow agents are not in the agent list. They show as Mochi with the type `workflow` and have no `full transcript` button. A workflow agent gets its buddy from the brief at the start of its turn. It ends on `turn.complete`, or when no event reached it for `keepFinishedMinutes` and no tool call of it runs.
- The engine's own helper agents (compaction, memory) are not in the agent list and have no brief, so they get no buddy.
- The output of a workflow agent holds only the live lines: the brief, the tool calls and their results. The engine does not give their messages.
- Hotkeys work only while the pane holds the keyboard. The output pane takes the keyboard when it opens. The den does not, because you type in the prompt.
- A `/clear` starts a new conversation with new state, so a den that you hid can open again for the next subagent.
- On a terminal narrower than 144 columns, the automatic open waits undrawn. `/agent-den` shows the den at any width.
- A subagent's own `Skill` call gets no live log line. The next read of its messages adds it.

## Development

```bash
claude plugin validate plugins/agent-den
claude plugin test plugins/agent-den
node plugins/agent-den/scripts/build-preview.mjs   # writes scripts/preview-art.html: every buddy, status and transition
```

Type-check with a tsconfig that extends `.claude-plugin/types/tsconfig.json` (the engine lays that folder when a session loads the mod): `npx -y -p typescript@5.6 tsc -p plugins/agent-den`.

Run `claude --plugin-dir plugins/agent-den` to try it in one terminal session, then ask Claude to start a few Explore agents in parallel. `/agent-den demo` shows every status at once.
