# agent-den: PRD and build spec

Status: approved plan, ready to build. A fresh session or agent can build the mod from this file alone.

## 1. Context

It is hard to see which subagents run and what they do, especially in the VS Code extension. `agent-den` is a Claude Code mod (a function-hooks plugin) with these features:

- It shows a pane with one animated **buddy** for each subagent. The pane shows the status of each agent (pending, running, waiting, idle, completed, failed, killed).
- It opens a second pane with the **terminal output** of an agent when you click its buddy.
- It is **easy to hide**: a hide button, Esc and a slash command.
- It works in the **terminal**, in **Claude Code Desktop** and in **VS Code**, from one hooks module.
- It looks like `cache-thermo`: pixel-art mascots, a calm pastel palette, SVG on GUI surfaces and ASCII in the terminal.
- **Animation is a primary design element.** Each status has its own loop, and each status change plays a one-shot transition.

Decisions from the person:

- Name: `agent-den` (folder, slash command `/agent-den`, pane title "Agent den").
- The den opens by itself on the first subagent of a session. After the person hides it, it stays hidden until they open it again.
- A buddy is picked by agent type first, then by order. Agents that run at the same time never share a buddy. Past the roster, a recoloured variant is made on the fly.

## 2. Reference material

| What | Where |
|---|---|
| Style to copy (art helpers, palette, band/pane code, tests) | `plugins/cache-thermo/hooks/{art.ts,theme.ts,register.tsx,runtime.ts,options.ts,mod.test.ts}` |
| A second pane mod (pane open/render, command, terminal vs desktop drawing) | `plugins/prompt-coach/hooks/register.tsx`, `plugins/prompt-coach/scripts/build-preview.mjs` |
| The API types (about 22,000 lines; grep, do not read all) | the engine lays them in `<mod>/.claude-plugin/types/claude-code/index.d.ts` once a session loads the mod. Before that, use the copy from the `plugin-authoring` skill (`types/claude-code.d.ts` under the skill's base directory). |
| Long-form API notes | `reference.md` in the same skill folder |

Useful type names to grep: `AgentInfo`, `AgentStatus`, `'agent.list'`, `SessionMessage`, `ToolUseSummary`, `TurnStartInput`, `TurnCompleteFields`, `PaneOpenArgs`, `UiPane`, `'ui.close'`, `ButtonProps`, `BoxHoverProps`, `SvgProps`, `CodeProps`, `Elements`, `MountedMembers`, `declare module 'claude-code/testing'`.

## 3. Engine facts that shape the design (verified in the types)

1. **No subagent lifecycle event exists.** There is `agent.spawn` (before start), `turn.start` / `turn.step` / `turn.complete` and `tool.call` with an optional `agentId`, and the observer `classic.SubagentStart` / `classic.SubagentStop`.
2. **The nesting rule (critical).** The engine skips a hook for an agent's `turn.start`, `turn.step` and `tool.call` when the agent's spawn ran inside that hook's frame. So:
   - A `tool.call` hook that runs for the main loop's `Agent` call and awaits `next` does **not** hear any tool call of that subagent.
   - **Rule:** this mod's `tool.call` hook uses a matcher that excludes the spawn tools: `on('tool.call', { tool: /^(?!(Agent|Task)$)/ }, hook)`.
   - **Rule:** do **not** hook `agent.spawn` or the main loop's `turn.step`. The Agent call can run while the step streams.
   - `turn.complete` is heard by every hook, so it is safe.
3. **`$.agent.list()`** returns `AgentInfo { id, description, type, status, parentId?, name?, teammateId?, spawnedBy? }`. Ended agents **drop out of the list** some seconds later, so the mod keeps its own record in `$.state`. Workflow agents are **not** listed. Their events carry ids that no list names.
4. **`$.session.messages({ agentId })`** resolves `SessionMessage[]` (`{ role, text, toolUses: ToolUseSummary[], toolResults? }`) or `{ deny }`. Tell the two apart with `Array.isArray`. It can deny a finished agent, so cache the last log that was read.
5. **`$.ui.view({ agentId })`** puts the full transcript of the agent in the main view. It works only from the person's own input, for example a Button press.
6. **Panes:**
   - `$.ui.open({ id, title, rows?, columns?, focus?, closeOnEscape? })` resolves `{ isPlaced }`. There is one pane per id; several panes show as tabs.
   - `$.ui.close({ id })` closes a pane, and `$.ui.panes()` lists the open panes.
   - Every close raises `ui.close` with `origin.kind` `'plugin' | 'person' | 'unload'`. Use it to learn that the person hid the pane.
   - Pane props: `{ title, isFocused, bodyColumns, placement: 'dock'|'inline', scroll, view }`. Size the tree to `e.props.bodyColumns`.
7. **Elements per surface** (`$.ui.resolve(e)`):

   | Surface | Elements |
   |---|---|
   | terminal | Box, Text, Button, Input, Select, Link, Code, Markdown, Client, Raster, Image |
   | desktop | Box, Text, Button, Input, Select, **Svg**, Link, Code, Markdown, Client |
   | vscode | the desktop table without Client |
   | mobile | Box, Text, Button, **Svg**, Link, Code, Markdown |

   So the rule is to draw `Svg` when `e.surface !== 'terminal'`. Note that `cache-thermo` checks only `'desktop'`.
8. **Button rules:**
   - The only clickable element is `Button`.
   - A whole row is one Button. Its children can be strings and `Text` only, and it needs a `key` when it has children.
   - Every Button in a list needs its own `key`. A `hotkey` is one digit or lowercase letter.
   - `role="dismiss"` marks a close control. `variant="primary"` marks the main action.
9. **Hover:** a keyed `Box` gets `hover: { borderColor, backgroundColor, borderStyle }` styles.
10. **Svg:** `isInteractive` runs SMIL and `:hover`. Scripts and event attributes are stripped. The limit is 131,072 characters of source.
11. **State:** a render hook never writes. Write from handlers or other events with `update($, atom, fn)`. Every `$.state` key must be declared in the contract `types/index.d.ts`. `$.clock.every(ms, fn)` timers are dropped on a hot reload, so start them in `session.start`.
12. **Tests** (`claude plugin test <dir>`):
    - The `on(...)` hooks in a test stand for the engine. An op on `$` is answered `{ value }`, for example `on('agent.list', () => ({ value: [...] }))`, `on('session.messages', () => ({ value: [...] }))`, `on('ui.open', () => ({ value: { isPlaced: true } }))`, `on('ui.close', () => ({ value: undefined }))`.
    - `mock.clock(on, { now })`, `mock.store(on)`.
    - `$.ui.mount({ plugin, surface, component: 'Pane', requestId, props })` returns a drawing with `find`, `findAll`, `press({ key })`, `drawn()` and `unmount()`. Loop the test over `['terminal', 'desktop', 'vscode'] as const`.

## 4. Files

```
plugins/agent-den/
  .claude-plugin/plugin.json   name, version 0.1.0, description, "types": "./types/index.d.ts", userConfig, author, keywords
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           all hooks, ticker, command, both pane renders
  hooks/tracker.ts             pure functions over AgentRow / LogLine (no $)
  hooks/buddies.ts             roster data, variants, pickBuddy, parseBuddyMap
  hooks/art.ts                 SVG (SMIL) and ASCII frames built from buddy data
  hooks/theme.ts               THEME, STATUS_LABEL, STATUS_DOT, statusColor
  hooks/options.ts             readOptions(options) → Opts (copy cache-thermo's pattern)
  hooks/runtime.ts             rt: opts + module-only guards (nothing a drawing reads)
  hooks/tracker.test.ts        pure tests
  hooks/art.test.ts            pure tests: sizes, widths, glyph rules, SVG length
  hooks/mod.test.ts            engine tests with claude-code/testing
  types/index.d.ts             PluginState contract
  scripts/build-preview.mjs    builds preview-art.html from art.ts (adapt prompt-coach's)
  scripts/preview-art.html     generated: every buddy × status × transition
  README.md, CHANGELOG.md
  tsconfig.json                { "extends": "./.claude-plugin/types/tsconfig.json", "include": ["hooks/**/*", "types/**/*"] }
```

Also update the repo `.claude-plugin/marketplace.json` (a new entry) and the table in the root `README.md`.

Every module is an ES module with no Node and no DOM. A hooks module cannot import JSON and cannot use `import()`.

## 5. Module contracts (the builders must keep to these names)

### 5.1 `types/index.d.ts`

```ts
export type DenStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
export type BuddyRef = { key: string; variant: number }      // variant 0 = the roster original
export type AgentRow = {
  id: string
  description: string
  type: string                 // AgentInfo.type, or 'workflow' / 'agent' when unlisted
  name?: string                // AgentInfo.name (SendMessage address)
  model?: string
  parentId?: string
  buddy: BuddyRef
  status: DenStatus
  statusSince: number          // ms; start of the one-shot transition
  startedAt: number
  endedAt?: number
  currentTool?: string         // short label, e.g. "Read src/a.ts"
  toolCount: number
  turnCount: number
  lastText?: string            // last assistant text line (speech bubble)
  lastReason?: 'answer' | 'aborted' | 'refusal' | 'error'
  isListed: boolean            // seen in $.agent.list() on the last poll
}
export type LogLine = { at: number; kind: 'tool' | 'result' | 'text' | 'error' | 'status'; text: string }
declare module 'claude-code' {
  interface PluginState {
    'agent-den': {
      agents: Record<string, AgentRow>
      order: string[]                       // first-seen order
      logs: Record<string, LogLine[]>       // last read log per agent, capped at maxLogLines
      selectedId: string | null
      isDenHidden: boolean                  // the person hid the den: no auto-open again this session
      hasAutoOpened: boolean
      frame: number                         // terminal animation frame counter
      now: number                           // last tick time (drives elapsed + transitions)
    }
  }
}
```

### 5.2 `hooks/buddies.ts`

```ts
export type Buddy = {
  key: string            // 'digby'
  name: string           // 'Digby'
  species: string        // 'mole'
  body: string[]         // 16 rows × 16 chars. '.' transparent; 'E' eye cells, 'M' mouth cells; other letters → palette
  palette: Record<string, string>
  accent: string         // card border / name colour
  prop?: string[]        // optional 16×16 accessory layer drawn over the body (same palette rules)
  ascii: { hat: string; arms?: [string, string] } // 1-cell-wide glyphs only; hat sits above the shared face
  types?: string[]       // agent types this buddy is the default for (case-insensitive)
}
export type ResolvedBuddy = Buddy & { displayName: string; variant: number }
export const ROSTER: readonly Buddy[]
export function resolveBuddy(ref: BuddyRef): ResolvedBuddy          // variant > 0: palette hue rotated by variant*47°, name + ' II'/' III'/…
export function pickBuddy(type: string, taken: readonly BuddyRef[], map: Readonly<Record<string, string>>): BuddyRef
export function parseBuddyMap(text: string): Record<string, string> // "Explore=digby, my-agent=moss" → { explore: 'digby', 'my-agent': 'moss' }
```

Roster (10). Each one is cute, chubby, has big eyes, and has a clear silhouette at 16×16:

| key | name | species | default types |
|---|---|---|---|
| digby | Digby | mole with a tiny miner lamp | Explore |
| bricks | Bricks | beaver with a pencil | Plan |
| bolt | Bolt | round robot with an antenna | general-purpose, claude |
| pip | Pip | bookworm with glasses | claude-code-guide |
| bristle | Bristle | hedgehog | names that contain review, security, audit |
| mochi | Mochi | slime blob | workflow |
| nib | Nib | fox kit | – |
| moss | Moss | frog | – |
| puff | Puff | cloud | – |
| tansy | Tansy | bunny | – |

`pickBuddy` works as follows, and it is deterministic:

1. Look up the type (lowercased) in `map`.
2. If it is not there, take the first roster buddy whose `types` matches. `bristle` matches by substring.
3. If that buddy key is taken by a live agent, use the first roster buddy that is not taken, in roster order.
4. If all are taken, use the type's buddy (or `ROSTER[0]`) with the lowest variant `n ≥ 1` that is not taken.

### 5.3 `hooks/art.ts`

```ts
export type Animations = 'full' | 'calm' | 'off'
export type Transition = 'spawn' | 'complete' | 'fail' | 'leave' | null
export const TRANSITION_MS = 1500
export function transitionFor(row: Pick<AgentRow, 'status' | 'statusSince' | 'endedAt'>, now: number, keepFinishedMs: number): Transition
export function buddySvg(b: ResolvedBuddy, status: DenStatus, opts: { sizePx: number; transition: Transition; animations: Animations; bubble?: string }): string
export function emptyDenSvg(sizePx: number): string              // a sleeping den / burrow for the empty state
export function buddyAscii(b: ResolvedBuddy, status: DenStatus, frame: number, animations: Animations): string[] // exactly 3 rows, each ASCII_W wide
export const ASCII_W: number
export const SPINNER: readonly string[]                          // one-cell braille spinner frames
```

Copy the helpers from `cache-thermo/hooks/art.ts`: `runs`, `pixels`, `flicker`, `disc`. Each mod is self-contained, so do not import across plugins. Use the same constraints: integer pixel grid, `shape-rendering="crispEdges"`, SMIL only, no scripts, no event attributes, no external references, a `<title>`, and an id prefix unique per call, so that two SVGs on one page do not clash.

**Faces from templates.** `E` and `M` cells in the body are replaced at draw time by mood templates, so one body gives every status:

| status | eyes | mouth | loop animation | effect |
|---|---|---|---|---|
| pending | closed | – | egg wobble (rotate ±4°) | the buddy peeks out of a cracked egg shell |
| running | open, blink every 3 s | smile | bounce 1 px + squash, 0.5 s | sparks or sweat drop; optional speech bubble with 3 typing dots |
| waiting | open, look left/right | flat | foot tap | small hourglass, sand falls |
| idle | closed (`-`) | small | breathe (scale 1→1.04, 3 s) | `z` pixels float up and fade |
| completed | happy `^ ^` | big smile | slow blink | small ✓ badge (mint) |
| failed | `x x` | frown | slump 1 px | small rain cloud with drops |
| killed | hollow | flat | ghost sway, greyscale, opacity 0.55 | – |

One-shot transitions use `fill="freeze"`. They play while `now - statusSince < TRANSITION_MS`:

- `spawn`: pop in (scale 0 → 1.15 → 1) out of the egg.
- `complete`: a jump of 3 px plus a 6-pixel confetti burst.
- `fail`: a head shake.
- `leave`: fade out and slide out in the last 1.5 s before a finished row expires.

`calm`: no bounce, no confetti, and slower loops. `off`: a static SVG.

**Terminal (`buddyAscii`).** 3 rows: the hat/ears row, the face row and the arms/feet row. Use only glyphs that are one cell wide in every terminal: ASCII plus `｡ ◕ ‿ ᵔ ᶻ`, and the braille spinner. Never use emoji or East Asian ambiguous-width marks (see `cache-thermo/hooks/art.ts` lines 556–586). Each status has 2–4 frames, picked by `frame`:

- running: bob up and down and alternate the arms.
- idle: `zᶻ` drifts.
- waiting: the eyes move left and right.
- completed: one 3-frame hop after `statusSince`, then rest.
- failed: `x_x` with a drip.
- killed: a ghost outline.

Pad every row to `ASCII_W`.

### 5.4 `hooks/theme.ts`

`THEME` is the cache-thermo colours plus `accent` and `ghost`: `{ hot: '#6ee7b7', warm: '#fcd34d', cold: '#fb7185', ink: '#dfe7ef', dim: '#8a93a6', panel: '#0f1420', ember: '#ffb27a', frost: '#93c5fd', accent, ghost }`.

`STATUS_LABEL: Record<DenStatus, string>` uses friendly words: pending "hatching", running "busy", waiting "waiting", idle "napping", completed "done", failed "oops", killed "stopped".

`STATUS_DOT` uses `● ◐ ○ ✦ ✓ ✗ ·`.

`statusColor(s)` gives: running = hot, waiting = warm, idle = frost, completed = hot, failed = cold, killed = dim, pending = ember.

### 5.5 `hooks/tracker.ts` (pure, fully unit-tested)

```ts
type ListedAgent = { id: string; description: string; type: string; status: DenStatus; parentId?: string; name?: string }
export function upsertListed(agents: Record<string, AgentRow>, order: string[], list: readonly ListedAgent[], now: number,
  pick: (type: string, taken: BuddyRef[]) => BuddyRef): { agents: Record<string, AgentRow>; order: string[]; changed: boolean; added: string[] }
  // new ids → rows (status from list, statusSince = now); known ids → status merged (statusSince/endedAt set on change, isListed true);
  // rows that were listed and are now missing while not ended → status from lastReason (answer→completed, error|refusal→failed, aborted→killed, none→completed), endedAt = now
export function ensureRow(agents, order, id: string, now: number, pick, hint?: { type?: string; description?: string; model?: string }): { agents; order; added: boolean }
export function onTurnStart(row: AgentRow, now: number): AgentRow     // running, turnCount+1
export function onTurnComplete(row: AgentRow, reason: AgentRow['lastReason'], answer: string, now: number): AgentRow // clear currentTool, lastText from answer; status unchanged unless unlisted (then ended per reason)
export function onToolStart(row: AgentRow, label: string, now: number): AgentRow  // currentTool, toolCount+1, status running
export function toolLabel(tool: string, input: Readonly<Record<string, unknown>>): string // "Read a.ts", "Bash npm test", "Grep TODO", "Edit x.ts"; ≤ 48 chars
export function messagesToLog(msgs: readonly { role: string; text: string; toolUses: readonly { tool: string; input: Record<string, unknown>; text?: string; isError?: true }[] }[], max: number, now: number): LogLine[]
  // user text (the brief) → 'status' "brief: …" first line; assistant text → 'text' lines; each toolUse → 'tool' "▸ <label>", then 'result'/'error' first 2 lines indented
export function currentFromMessages(msgs): { currentTool?: string; lastText?: string; toolCount: number }
export function isLive(s: DenStatus): boolean        // pending|running|waiting|idle
export function liveBuddies(agents): BuddyRef[]
export function expire(agents, order, now: number, keepMs: number): { agents; order; removed: string[] }  // ended rows older than keepMs
export function summary(agents): string | undefined   // "🐾 2 busy · 1 napping · 3 done"; undefined when no rows
export function formatElapsed(ms: number): string    // "8s", "2m 05s", "1h 03m"
export function animKey(agents, now: number, frame: number): string  // what the terminal drawing would show; ticker bumps frame only when this changes
```

### 5.6 `hooks/options.ts`

`Opts` has these fields: `{ autoOpen: boolean; keepFinishedMinutes: number; animations: Animations; buddyMap: string; maxLogLines: number }`. The defaults are `true, 10, 'full', '', 300`. Read and clamp them like `cache-thermo/hooks/options.ts`.

## 6. Hooks (`register.tsx`)

The constants are `PANE = 'agent-den'`, `LOG_PANE = 'agent-den-log'` and `COMMAND = 'agent-den'`. The atoms are `atom({ plugin: 'agent-den', key } as const, initial)` for each state key.

1. **`session.start`**:
   - Register `/agent-den` with the argument hint `[show|hide|log <n>|clear|demo]`.
   - Start `$.clock.every(500, tick)`.
   - Run one `poll($)`. It rebuilds the rows after a hot reload.
   - Log `agent-den vX ready` to debug.
2. **`turn.start`** with `e.agentId`: `ensureRow` (an unknown id becomes type `workflow`), then `onTurnStart`. Write the state after `next(e)` resolves. Return `next(e)` at once for the main loop.
3. **`tool.call`** with the matcher `{ tool: /^(?!(Agent|Task)$)/ }`:
   - Skip it when `e.agentId === undefined`.
   - Otherwise run `onToolStart` with `toolLabel(e.tool, input)`, and append a live `tool` log line.
   - `const r = await next(e)`, then append a `result` or `error` line. Return `r`.
   - Add `.catch(($, e, next) => next(e))`. The mod must never block a tool.
4. **`turn.complete`** with `agentId`: run `onTurnComplete(row, e.reason, e.answer, now)`.
5. **`ui.close`**: when `e.id === PANE` and `origin.kind === 'person'`, set `isDenHidden = true`. When `e.id === LOG_PANE`, set `selectedId = null`. Always `return next(e)`.
6. **`session.end`** with `reason === 'clear'`: drop the ended rows, every `demo-*` row and their logs.
7. **`command.run`** (the same name check as cache-thermo, which accepts `plugin:agent-den`):
   - no argument: toggle the den. Open it and set `isDenHidden = false`, or close it.
   - `show` / `hide`: open or close the den.
   - `log <n|name>`: select that agent and open the log pane.
   - `clear`: drop the ended rows and every `demo-*` row, live or ended.
   - `demo`: insert 7 demo rows, one per status, with fake log lines, under ids `demo-*`. The poll must not mark the `demo-*` ids as ended.
   - Each case returns `{ text }`.
   - Add the cache-thermo `.catch` pattern.
8. **`tick`** (every 500 ms; it must never throw out of the timer):
   - Every second tick, run `poll($)`. It does `$.agent.list()`, `upsertListed`, `expire`, and auto-open on the first added agent when `rt.opts.autoOpen && !isDenHidden && !hasAutoOpened`.
   - Refresh the logs from `$.session.messages({ agentId })`: the selected agent every 1 s while it is live, and the other live agents every 3 s (round-robin, at most 2 calls a tick). Run `messagesToLog` and `currentFromMessages`, and write the state only when the result changed.
   - `$.ui.status(summary(agents))`, only when the text changes.
   - Write `now` when the drawn elapsed text or a transition changes. Write `frame + 1` only while a terminal-visible animation runs and `animKey` changed. When nothing animates, nothing is written, so idle panes cost nothing.
9. **`openDen($)`** is `$.ui.open({ id: PANE, title: 'Agent den', rows: Math.min(4 + 4*rows, 22) })` inside a try/catch with a debug log. **`openLog($, id)`** sets `selectedId` first, then runs `$.ui.open({ id: LOG_PANE, title: '<Buddy> · <description>', closeOnEscape: true, rows: 18 })`.

### 6.1 Den pane render (`{ component: 'Pane', requestId: PANE }`)

- **Header row:** the den name, then counts per status as coloured dots (`● 2 busy  ◐ 1 waiting  ✓ 3 done`), then a `hide` Button (`key="hide"`, `hotkey="x"`, `role="dismiss"`, `plain`, `dimColor`). The hide Button runs `$.ui.close({ id: PANE })` and sets `isDenHidden = true`.
- **Empty state:** `emptyDenSvg` (GUI) or a small ASCII burrow, with the text "No buddies out yet. They show up when Claude starts a subagent." and a `demo` Button.
- **One card per agent** in `order`, with child agents under their parent and indented by 2:
  - The **GUI** card (`e.surface !== 'terminal'`) is a keyed `Box` (`key={'card-'+id}`) with `borderStyle="round"`, `borderColor={accent}`, `borderDimColor` and `hover={{ borderColor: statusColor, backgroundColor: '#151c2c' }}`. Inside it, from left to right:
    - an `Svg` (48 px, `isInteractive`, a fitting `alt`),
    - a column with the name and the description, then `STATUS_DOT label · elapsed · type`, then `currentTool` with a spinner glyph while running or `lastText`,
    - a `Button` (`key={'open-'+id}`, `hotkey` 1–9 for the first nine) with the label "output ›", which runs `openLog`.
  - **Terminal** card: the whole row is one `Button` (`key={'open-'+id}`, `plain`, `hotkey` 1–9) beside a fixed-width column of the 3 ASCII rows. The Button holds the name, the description and a dim `Text` status line. The ASCII rows are coloured by the buddy accent, or by `statusColor` for failed and killed agents.
  - A finished row in its `leave` window draws dim.
- Draw the cards in a wrapped grid on GUI surfaces (`flexWrap="wrap"`, card width about 34 columns). Draw them in rows in the terminal. Limit the rows to `e.props.bodyColumns`.

### 6.2 Log pane render (`{ component: 'Pane', requestId: LOG_PANE }`)

- **Header:** a large sprite (an `Svg` of 64 px, or ASCII), the name, the description, the status and elapsed time, the type and model, and the counts of tools and turns.
- **Buttons:** `back` (`key="back"`, `hotkey="b"`) opens the den and closes the log. `full transcript` (`key="view"`, `hotkey="t"`) runs `$.ui.view({ agentId })`, and shows a toast on `{ deny }`. `close` (`key="close"`, `role="dismiss"`, `hotkey="x"`).
- **Body:** the log lines, the newest last. Fit them to `e.props.scroll.bodyRows` when known (else 30).
  - On GUI surfaces: one `Code` block (`language="text"`, `wrap="wrap"`). The source has the `▸` tool lines, the indented results and the text.
  - In the terminal: one `Text` per line. Tool lines use the buddy accent, results are dim, and errors use `THEME.cold`.
- With no lines yet, show the text "Waiting for <Name> to say something…" with the running sprite.
- `selectedId === null`, or an id with no row, gives a short "Pick a buddy in the den" text.

## 7. userConfig (`plugin.json`)

| key | type | default | title / description |
|---|---|---|---|
| autoOpen | boolean | true | Open the den when the first subagent starts |
| keepFinishedMinutes | number | 10 | Finished buddies stay this long, then wave goodbye |
| animations | string, options full/calm/off | full | `calm` drops the bounce and the confetti; `off` is static |
| buddyMap | string | "" | Pin agent types to buddies, e.g. `Explore=digby, my-agent=moss` |
| maxLogLines | number | 300 | Lines kept per agent log |

The author is `{ "name": "Daniel Eliasson", "email": "daniel@stilero.com" }`. The keywords are `["subagents", "agents", "panel", "buddies", "animation", "mod"]`.

## 8. Tests

**`tracker.test.ts`** and **`art.test.ts`** test the pure functions:

- `upsertListed` covers new rows, status changes, dropped rows that end by `lastReason`, and demo ids that stay.
- `pickBuddy` checks four cases:
  - Explore gives digby.
  - A second live Explore agent gets the next free buddy.
  - An 11th live agent gets variant 1.
  - The map override wins.
- `toolLabel` is checked for the main tools. `messagesToLog` is checked for its order and caps.
- `buddyAscii` checks every buddy × status × 4 frames: 3 rows, each exactly `ASCII_W` wide, and only allowed glyphs (no emoji, and none of `• ⌒ ˘ °`).
- `buddySvg` checks every buddy × status × transition: it starts with `<svg`, holds `<title>`, has no `<script` and no ` on` attributes, and is shorter than 131,072 characters.

**`mod.test.ts`** (claude-code/testing) uses a `world(on)` helper like cache-thermo's. It answers `agent.list`, `session.messages`, `ui.open`, `ui.close`, `ui.panes`, `ui.status`, `ui.toast`, `ui.log`, `ui.view`, `command.register`, `command.run`, `session.start`, `tool.call` and `turn.complete`. The tests check these behaviours:

1. A listed agent appears after one tick. The den auto-opens once, and does not open a second time for a second agent.
2. After the person closes the den (the `ui.close` origin `person`), a new agent does not reopen it. `/agent-den show` reopens it.
3. A subagent's `tool.call` (with `agentId`) sets `currentTool` and adds log lines. A main-loop call changes nothing.
4. An agent that drops out of the list after `turn.complete` with reason `answer` ends as `completed`.
5. The den renders on terminal, desktop and vscode: the terminal has no `Svg`, and desktop and vscode have an `Svg` per card.
6. A press on `open-<id>` sets `selectedId` and opens `agent-den-log`. The log pane shows the lines from `session.messages`. A press on `close` closes it, and `back` reopens the den.
7. A press on `hide` closes the den and sets `isDenHidden`.
8. `/agent-den demo` gives 7 cards. `/agent-den clear` removes all 7 of them.

## 9. Verification commands

```bash
claude plugin validate .
claude plugin validate plugins/agent-den
claude plugin test plugins/agent-den
npx -y -p typescript@5.6 tsc -p plugins/agent-den --noEmit   # after a session has laid .claude-plugin/types; else a temp tsconfig outside the folder that includes the skill's claude-code.d.ts + hooks + types
node plugins/agent-den/scripts/build-preview.mjs              # then open scripts/preview-art.html in a browser
```

Manual check: run `claude --plugin-dir plugins/agent-den` and ask Claude to "start 3 Explore agents in parallel and one background general-purpose agent". On the terminal, Desktop and VS Code (the last two from a folder marketplace install), check these points:

- The buddies hatch and animate.
- The statuses change.
- A click opens the output.
- Esc and `hide` close the panes.
- `/agent-den show` brings the den back.
- `/agent-den demo` works.

## 10. Out of scope for 0.1.0

- Stopping or messaging an agent from the pane. `TaskStop` and `$.session.send` exist, so this can come later.
- Sounds.
- An AbovePrompt band.
- Token counts. These need the `turn.step` hook, which the nesting rule makes risky.

## 11. Build amendments (from the planning round)

The planning round checked sections 1-10 against the types of Claude Code 2.1.304 and against two probe plugins. This section records the corrections and the decisions. **Where this section and sections 1-10 disagree, this section wins.**

### 11.1 Engine corrections

1. **The `tool.call` matcher excludes four tools.** A workflow agent starts inside the main loop's `Workflow` call. A forked skill can start inside a `Skill` call. A hook that wraps these calls can hide the agents' events. Use this matcher:
   ```ts
   on('tool.call', { tool: /^(?!(Agent|Task|Workflow|Skill)$)/ }, hook).catch(($, e, next) => next(e))
   ```
   The cost: a subagent's own `Skill` call gets no live log line. The `session.messages` refresh adds the line later.
2. **Tool arguments are on `e`, not on `e.input`.** For example, `e.file_path` and `e.command`. Call `toolLabel(String(e.tool), e as unknown as Readonly<Record<string, unknown>>)`. The keys `tool`, `tool_use_id`, `agentId`, `requestMeta` and `consent` are reserved. `toolLabel` reads only named keys for each tool, so these keys never get into a label.
3. **`next(e)` of `tool.call` gives one of three shapes:** `{ deny }`, `{ isError: true, text? }` or `{ result, text? }`. A `deny` gives an `error` line. `isError` gives an `error` line from `text`. All other results give `result` lines from `text`.
4. **`AgentInfo` has no `model`.** Take the model from `turn.complete` `e.usage?.model`.
5. **An ended agent can become live again under the same id.** A row that goes live again loses `endedAt` and gets a new `statusSince`.
6. **Workflow agents are always denied.** `$.session.messages` and `$.ui.view` both deny an agent that a workflow run filed. So:
   - Never call `session.messages` for a row with `type === 'workflow'` or for an id that starts with `demo-`.
   - Do not show the `full transcript` Button for a `workflow` row.
   - A deny or an empty array never replaces the current log.
7. **In a subagent, `turn.start` `e.text` is the brief.** Use it as the description of a workflow row and as the first log line.
8. **A Button's `$.ui.close` does not run the mod's own `ui.close` hook** (the recursion skip). Each press handler that closes a pane must write its own state. A `$.ui.close` from `command.run` runs the hook with origin `plugin`.
9. **An open that the person did not ask for can stay undrawn.** The auto-open from the timer waits undrawn below 144 terminal columns, and `$.ui.panes()` lists it with `isPlaced: false`. An open from a command or a press is placed at any width.
10. **Esc closes the den.** The den opens with `closeOnEscape: true`. Esc gives `ui.close` with origin `person`, and the mod then sets `isDenHidden = true`. Each `$.ui.open` sets its options again, so every open of the den passes `closeOnEscape: true` and `rows`.
11. **`focus`, `closeOnEscape` and Button `plain` have the literal type `true`.** Do not pass a `boolean` variable.
12. **Hotkeys work only while the pane holds the focus.** The log pane opens with `focus: true`, because a press or a command opens it. The den never passes `focus`, because the person types in the composer.
13. **`session.end` with `reason === 'resume'` acts the same as `clear`.**
14. **The `turn.complete` hook always returns `next(e)`.** A text of its own shows under the answer.
15. **The engine draws a pane title only as a tab** when more than one pane is open. Both panes draw their own header row.
16. **Surface guard.** A surface that is not known at compile time can lack `Svg`. Draw the GUI branch only when `e.surface !== 'terminal'` and `'Svg' in $.ui.resolve(e)`. Draw the terminal branch in all other cases.
17. **`Text bold` is deprecated** (it reads as semibold). Write `weight="bold"`. Use `tabular` for the elapsed time.
18. **`Svg` needs `alt`.** SMIL runs only with `isInteractive`. Every `Svg` gets `isInteractive`, `alt`, `width` and `height`.
19. **Control characters.** A pane title with a control character is refused. A `.slice()` through an emoji gives U+FFFD. Remove control characters from all log text and titles, and cut text by code points.
20. **State values are never `undefined`.** The host can refuse such a value. Remove an optional field with a rest pattern or with `delete` on a copy. Never write `{ ...row, currentTool: undefined }`.
21. **Atom keys are literals in the source:** `atom({ plugin: 'agent-den', key: 'agents' } as const, {})`.
22. **The contract file exports types only.** Do not add `export {}`.
23. **`next.error` is a `HookFailure` object.** `String(next.error)` gives `[object Object]`. The `command.run` catch is:
    ```ts
    .catch(($, e, next) => (next.called ? next(e) : { text: `agent-den: the command failed: ${next.error.message ?? next.error.kind}` }))
    ```
24. **`ui.close`, `command.run` and `ui.render` are gating hooks.** Validate reports a gating hook that has no `.catch`. Every hook has a `.catch`.
25. **`/clear` makes new state.** The new conversation starts with `isDenHidden` and `hasAutoOpened` set to `false`, and no `session.start` fires. The timer from the first `session.start` continues and reads the new state.

### 11.2 Changed and added exports (difference from section 5)

`types/index.d.ts` does not change.

`hooks/art.ts`:
```ts
// changed: the Pick also has startedAt
export function transitionFor(row: Pick<AgentRow, 'status' | 'statusSince' | 'startedAt' | 'endedAt'>, now: number, keepFinishedMs: number): Transition
// added
export const EMPTY_DEN_ASCII: readonly string[]       // 3 rows, each ASCII_W wide
export function faceBoxes(body: readonly string[]): { eyes: [{ x: number; y: number }, { x: number; y: number }]; mouth: { x: number; y: number } } | null
export function isSafeGlyphs(text: string): boolean
```
`ASCII_W` is 13. `SPINNER` is `['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']`.

`transitionFor` uses these rules, in this order:
1. The status is ended, `endedAt` is set, and `now >= endedAt + keepFinishedMs - TRANSITION_MS`: `'leave'`.
2. The status is live and `now - startedAt < TRANSITION_MS`: `'spawn'`. It uses `startedAt`, so a `pending` to `running` change does not stop the pop.
3. `now - statusSince < TRANSITION_MS`: `completed` gives `'complete'`, `failed` gives `'fail'`, `killed` gives `null`.
4. In all other cases: `null`.

`hooks/buddies.ts` (added):
```ts
export function rotateHue(hex: string, degrees: number): string   // greys (saturation < 0.15) stay
export function variantName(name: string, variant: number): string // 1 → 'Digby II', 2 → 'Digby III', to X, then 'Digby 12'
```

`hooks/theme.ts` (added): `THEME.accent = '#c4b5fd'`, `THEME.ghost = '#9aa3b5'`, `STATUS_ORDER = ['running','waiting','idle','pending','completed','failed','killed']`, `CARD_HOVER_BG = '#151c2c'`. `STATUS_DOT` is running `●`, waiting `◐`, idle `○`, pending `✦`, completed `✓`, failed `✗`, killed `·`.

`hooks/runtime.ts` (new contract):
```ts
export const rt: {
  opts: Opts; buddyMap: Record<string, string>; timer: { cancel(): void } | null
  ticks: number; isTicking: boolean; lastStatusText: string | undefined | null; lastKey: string
  logReadAt: Record<string, number>; logCursor: number
  finalRead: Record<string, true>; deniedUntil: Record<string, number>
}
export function resetRuntime(): void                    // resets all but opts, buddyMap and timer
export function forgetAgent(id: string): void           // removes the id from logReadAt, finalRead and deniedUntil
export function serial<T>(fn: () => Promise<T>): Promise<T>
```
`serial` is `const p = queue.then(() => fn()); queue = p.catch(() => undefined); return p`. Never call `next(e)` or a `$` op that waits on the person inside `serial`.

`hooks/tracker.ts` (changed and added):
```ts
export type ListedAgent = { id: string; description: string; type: string; status: DenStatus; parentId?: string; name?: string }
export type PickFn = (type: string, taken: BuddyRef[]) => BuddyRef
export type RowHint = { type?: string; description?: string; model?: string; name?: string; parentId?: string }
export function isEnded(s: DenStatus): boolean
export function expire(agents, order, now: number, keepMs: number, keepId?: string | null): { agents; order; removed: string[] } // never expires keepId
export function elapsedOf(row: AgentRow, now: number): number
export function animKey(agents, now: number, frame: number, opts?: { animations?: Animations; keepFinishedMs?: number }): string
export function asciiFrameFor(row: AgentRow, now: number, frame: number, animations: Animations): number
export function treeOrder(agents, order): { id: string; depth: number }[]
export function sameLog(a: readonly LogLine[], b: readonly LogLine[]): boolean
export function firstLine(text: string, max: number): string
export function cleanText(text: string): string
export function closeEffect(id: string, kind: 'plugin' | 'person' | 'unload', panes: { den: string; log: string }): { hideDen?: true; clearSelected?: true }
export function dropEnded(agents, order, logs): { agents; order; logs; removed: string[] }
export const DEMO_PREFIX = 'demo-'
export function demoState(now: number): { agents: Record<string, AgentRow>; order: string[]; logs: Record<string, LogLine[]> }
```
`ensureRow` takes `hint?: RowHint`. The other signatures of section 5.5 do not change.

### 11.3 Decisions

- **Path tools show the basename.** `Read src/a.ts` gives `Read a.ts`.
- **A row that the list names later.** `rowFor` asks `$.agent.list()` before it makes a `workflow` row. If the list names a `workflow` row later, `upsertListed` gives it the listed type and picks its buddy one time again.
- **Dropped rows.** Only rows with `isListed === true` end when they drop out of the list. Demo rows and workflow rows end by `turn.complete`, `clear` or expiry. A live demo row also goes after `keepFinishedMinutes`. A live workflow row also ends as `completed` when no hook event reached it for `keepFinishedMinutes` and it has no tool call in flight. Then expiry removes it `keepFinishedMinutes` later. A list entry that is ended and has no row makes no row.
- **Unlisted ids (workflow agents and engine forks).** An id that has no row and that `$.agent.list()` does not name is unlisted. `tool.call` makes no row for an unlisted id: it writes no log lines and does not open the den. `turn.start` makes a row for an unlisted id only when `e.text` (the brief) is not empty. The engine's own forks (compaction, memory) thus get no buddy. A workflow agent gets its row from the brief on its `turn.start`.
- **The log pane sprite is 72 px**, not 64 px. The art grid is 24 units, and 72 / 24 is a whole number.
- **Log pane hotkeys:** `t` for `full transcript`, `b` for `back`, `x` for `close`. Hotkeys belong to one pane, so `x` in the den and in the log pane do not clash. **Den hotkeys:** `1`-`9` for cards, `d` for demo, `x` for hide.
- **The `/agent-den` toggle** closes the den only when `$.ui.panes()` lists it with `isPlaced: true`. In all other cases it opens the den.
- **`openDen` logs the reason** to debug when the result is `{ isPlaced: false }`. The auto-open still sets `hasAutoOpened = true`.
- **One ticker.** `session.start` cancels `rt.timer` before it starts a new `$.clock.every`.
- **After a hot reload** the mod sends the status again and reads each ended agent one more time. This is intended.
- **The SVG source is stable.** The id prefix is a hash of the inputs. `lastText`, `currentTool`, the time and counters never go into `buddySvg`. The `bubble` value is `'thinking'` while running.

### 11.4 Test changes (difference from section 8)

- The test `$` has no `$.ui.close`, and a test cannot make origin `person`. Test 2 presses `hide`, adds a new agent and advances the clock: the den does not open again. Then `/agent-den show` opens it. `tracker.test.ts` tests the `person` origin through `closeEffect`.
- A subagent `tool.call` with `agentId` in an object literal fails tsc. Put the input in a variable first, then call `$.tool.call(sub)`.
- Every mount target has `component: 'Pane'` and `requestId`. Unmount a pane before you mount it again.
- `world(on)` also answers `turn.start` and `session.end`. `ui.panes` answers full `UiPane` objects.
- An added test: `/agent-den log 1` opens the log pane.
- An added test: with the option `animations: 'off'`, the desktop `Svg` source has no `<animate`.

### 11.5 Declined for 0.1.0

- `classic.SubagentStart` and `classic.SubagentStop`. The `agent.list` poll gives the status and the type.
- `$.ui.scroll` in the log pane. The pane draws only the lines that fit.
- `Shaped<T>` for the atoms. No older shape exists.
- `Raster` for the terminal sprite. The ASCII frames are the terminal design.
- An `Esc` test through `ui.key`. The kit behaviour is not probed.

### 11.6 Expected validate result

`claude plugin validate` passes with two warnings: LICENSE_MISSING and ICON_MISSING. cache-thermo has the same warnings.
