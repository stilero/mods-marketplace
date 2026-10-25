# prompt-coach

A Claude Code mod that teaches good prompting. Quill, a little pixel owl with reading glasses, reads the prompt that starts a piece of work and shows, in its own pane, which parts of a good brief it covers and what to add. The aim is more time planning up front and fewer rounds of fixing the implementation afterwards.

A good brief has five parts:

| Part | What it says |
|---|---|
| **Goal** | What are we building or changing |
| **Why** | The background: the problem, who it is for |
| **Constraints** | Libraries to use or avoid, conventions, what not to touch |
| **Done when** | How we know it is finished: tests, behaviour to observe |
| **Reuse** | Existing code, patterns or docs to build on |

Not every part applies to every prompt. A small model (Haiku by default) decides which parts apply to *this* prompt, so a bug fix is not asked for a "why" and a brand-new project is not asked what to reuse. Questions, follow-ups ("yes, continue") and tiny fully specified edits are not coached at all.

## What you get

- **Hints mode** (default). The prompt is sent at once. When Quill finishes reading it, the Prompt coach pane opens with the checklist (`✓` covered, `✗` missing with a question tailored to your prompt, `–` does not apply) as notes for next time. A complete brief gets a short "nice brief ✓" toast and no pane.
- **Gate mode**. A brief that leaves out a part that applies waits in the pane until you pick:
  - **improve it** (`i`): your prompt comes back to the prompt box with a heading and a question for each missing part (`## Done when` / `- <Which test proves it works?>`). Replace the questions with answers and send. Quill reads it again and shows the before → after score.
  - **send anyway** (`s`): the prompt goes as typed.
  - **let Claude ask** (`a`): the prompt goes with a request for Claude to ask you about the missing parts before it plans or implements anything.
  A complete brief goes straight through.
- **Not spammy**. Quill reads the first task prompt of each conversation: at session start, after `/clear` and after a compaction. A resumed conversation is not read. `/prompt-coach next` or the pane's "read my next prompt" button asks for one more read.
- **A little progress line**: the share of applicable parts your last ten briefs covered, kept across sessions.

The look follows [cache-thermo](../cache-thermo/): calm mint, honey and rose on a dark panel, round dim borders, pixel art on the desktop and one-cell ASCII in the terminal.

## Install

At the prompt of a terminal session:

```
/plugin install prompt-coach --marketplace stilero/mods-marketplace
```

From a shell: `claude plugin install prompt-coach --marketplace stilero/mods-marketplace`. In Claude Code Desktop: `+` next to the prompt → Plugins → Add marketplace → Add plugin.

## Commands

| Command | Effect |
|---|---|
| `/prompt-coach` | One-line status: mode, whether the next prompt will be read, model, your stats |
| `/prompt-coach next` | Read the next prompt, whatever the trigger |
| `/prompt-coach open` | Open the Prompt coach pane (shows the five parts when there is nothing read yet) |
| `/prompt-coach mode gate` / `hints` / `off` | Switch mode for this session; the setting below stays the default |

## Configuration (`/config` rows)

| Field | Default | Purpose |
|---|---|---|
| Mode | `hints` | `hints` sends at once and coaches for next time; `gate` holds a brief that leaves out a part that applies |
| When to coach | `conversation` | `conversation`: the first task prompt of each conversation. `every`: every task prompt typed while Claude is idle (practice mode, one model call per prompt) |
| Coach model | `haiku` | The model that reads the prompt: an alias or a full model id |
| Minimum prompt length | 20 | Shorter prompts are never read |

## How it works

- `prompt.submit` skips slash commands, meta prompts, prompts typed while a turn runs, and short ones. When Quill is armed it calls `$.model.complete` with a fixed rubric (`hooks/analyze.ts`). The prompt is fenced as data, and the reply is strict JSON: `isTask`, a headline, and a status, note and question for each part.
- Hints mode does not await the read. Gate mode awaits it and returns `{ drop }` for a weak brief, keeping the text in plugin state until a button resubmits it with `$.prompt.submit({ asUser: true })` or hands it back with `$.prompt.fill`.
- A failed or unparseable read fails open: the prompt goes through, a toast says so, and Quill disarms until the next conversation.
- Arming lives in `$.state`: set on a fresh `session.start`, on `session.end` with reason `clear`, and on a main-thread `session.compact`; cleared once a task prompt has been coached.
- Stats live in `$.store` under `stats`.

## Development

```bash
claude plugin validate plugins/prompt-coach
claude plugin test plugins/prompt-coach
(cd plugins/prompt-coach && node scripts/build-preview.mjs)   # writes scripts/preview-art.html
```

Run `claude --plugin-dir plugins/prompt-coach` to try it in one terminal session.
