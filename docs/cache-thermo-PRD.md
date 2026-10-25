# cache-thermo — PRD / handoff

A Claude Code mod that makes the prompt cache visible, gates cold-cache runs, and keeps the cache warm while you are on a break.

Status: v0.2.0 built; band and break verified live in the desktop app, gate and terminal awaiting live checks. Owner: Daniel Eliasson (Stilero). Target: Claude Code 2.1.29x function-hooks plugin API (early access; the declaration file the engine lays beside the mod is the authority).

## 1. Problem

Claude Code sessions ride on Anthropic prompt caching. Every request re-reads the whole conversation prefix. While the cache entry is warm that read is cheap (0.025×–0.1× of the input price) and every read refreshes the entry's TTL for free. When the TTL lapses (5 minutes on API-key accounts, 1 hour on subscription accounts in this build) the next request re-writes the entire context at 1.25× (5-minute TTL) or 2× (1-hour TTL) of the input price. On a 400k-token context on Claude Fable 5.1 that is a silent ~$8 charge for one keystroke. Nothing in the default UI shows cache temperature, and nothing warns before the cold run.

## 2. Goals

1. Make cache temperature visible at all times: a horizontal thermometer above the prompt that ticks down with the TTL. Green while hot, yellow when close to cold, red when cold.
2. Prevent surprise cold runs: when the cache is cold and the user submits a prompt, turn the band above the prompt into an unmissable cold-cache view with the context size and the estimated re-cache cost and require a click to continue.
3. Make breaks cheap: one button that keeps the cache warm by issuing a cheap cache-read request just before the TTL lapses, with a visible break view in the band and an "I'm back" button. Typing a prompt also resumes.
4. Showcase that Claude Code can be modded: a loud retro look (pixel-art mascots, CRT colors, double borders, animation, 8-bit bleeps) that is clearly not the default UI.
5. Keep pricing configurable: a data file shipped with the plugin plus per-user overrides, so a new plugin version can follow price changes.
6. Distribute through a marketplace in this repository: one-line install.

Non-goals (v1): exact billing reconciliation, Bedrock/Vertex pricing tables, mobile surface, pausing subagent caches.

## 3. Decisions

| Topic | Decision |
|---|---|
| Name | `cache-thermo` (plugin name, `/cache-thermo` command, marketplace entry) |
| Gate policy | Gate only when the estimated re-cache cost ≥ a configurable USD threshold (default $0.25); smaller contexts pass silently |
| Mascots | Ember (fire sprite, fades as the cache cools) and Frostbit (ice imp, takes over when cold) |
| Surfaces | Terminal and desktop both supported; desktop (Claude Code Desktop) polished first with animated SVG, terminal gets block-art thermometer and ASCII mascots |
| Keep-warm primitive | `$.model.fork` (re-sends the main thread's last request, served from the prompt cache) |
| Gate surface | The band above the prompt, like the break view (Daniel does not want separate panels); toasts are text-only and cannot hold buttons |

## 4. User experience

### 4.1 Thermometer band (above the prompt)

- Appears after the first model response. Hidden while a survey holds the band, or after the user hides it (`/cache-thermo hide`, `show` brings it back).
- Zone by remaining fraction of the TTL: hot (> `warnFraction`) green `#39ff14`; warm (≤ `warnFraction`, > 0) yellow `#ffd400`; cold (0) red `#ff3860`. While a turn is running the band shows hot with a "working" pulse, because every request refreshes the cache.
- Terminal: `Ember` ASCII sprite, `CACHE ████████████░░░░░░ 41:12 left · 212k ctx · ~$8.48 to re-cache`, `[☕ Break]` (hotkey `b`) and `[x]` hide. Fill = `remaining/ttl × barColumns`.
- Desktop: an SVG pixel thermometer (tube, gradient fill clipped to the fraction, ticks at 25/50/75, Ember on the left whose flame shrinks with the fraction, Frostbit sliding in from the right when cold), a stats row in tabular digits, and the same buttons.
- Transition toasts, once per transition while idle: hot→warm "Ember is fading — cache cold in 4:58"; warm→cold "Cache is cold. Next prompt re-caches ~$8.48". Each with its bleep.

### 4.2 Cold-cache gate

- Trigger: the user submits a prompt while the cache is cold and the estimate ≥ `gateThresholdUsd`.
- Not gated: slash commands, hidden/meta prompts, prompts delivered into a running turn, prompts with image attachments (shown a warning toast instead, because media cannot be resubmitted later), the mod's own resubmission, and any situation where the mod has no clock yet. The gate fails open: if the hook throws, the prompt goes through.
- Band view (it takes the band over, even a hidden one, until the person picks): rose border, Frostbit, `❄ brrr, the cache went cold · re-cache ≈ $8.48`, `212,480 tokens · 21% of window · idle 1h 12m, 1h TTL lapsed`, the pricing basis (`2× write, 1h TTL, Claude Fable 5.1 list price`), and two buttons: `go ahead anyway · $8.48` (primary, hotkey `c`) and `keep my prompt` (hotkey `x`).
- Continue resubmits the stored text as the user's own prompt. Keep my prompt puts the text back in the composer. There is no Escape: a band has no close key.

### 4.3 Break mode

- Entered from the band button or `/cache-thermo break`. The band itself turns into the break view (no separate panel): Ember tending a campfire, `☕ on a break · keeping the cache warm · next nudge in 02:13`, a second line with nudges, spend and time away, and an `I'm back` button (hotkey `r`).
- While on a break the mod refreshes the cache when `remaining ≤ keepWarmLeadSeconds` by forking the last request with the prompt "Cache keep-alive ping from the cache-thermo mod. Reply with a single period and nothing else." Each refresh is logged with its `cache_read_input_tokens` so a miss is visible.
- Leaves on I'm back, `/cache-thermo resume`, the user's own prompt, `maxBreakHours` elapsed (then it deliberately lets the cache cool and says so), or an API error / nothing-to-fork. Totals persist across sessions in the plugin store.

### 4.4 Command

`/cache-thermo` status line; `/cache-thermo break | resume | hide | show`; `/cache-thermo cold` is a documented debug aid that marks the cache cold now so the gate can be demoed without waiting.

## 5. Mechanics

### 5.1 Cache clock

- `turn.step` (main loop only, `agentId` absent) records the request start time before streaming; its `stop` chunk's `usage` gives `input + cache_read + cache_creation + output` = context tokens and the model id. `warmUntil = requestStart + ttlMs` (the TTL is measured from the start of the request). `turn.complete` is the fallback when no stop chunk was seen.
- Resume and model-switch seeding through `classic.SessionStart` / `classic.PostModelSwitch` was dropped: the engine's security plugin sends those events past user-tier plugins (and logs a line about it at every start). The function-hooks API has no replacement (`$.session.messages()` carries no timestamps or usage), so the clock starts at the first response of the session.
- TTL: `cacheTtl` config `auto` picks 1h when `$.session.usage().rateLimits` is non-empty (subscription), else 5m (source `heuristic`), decided at each response because rate limits arrive with responses. The band says "1h ttl, assumed" while the TTL is a heuristic.
- A new prefix forgets the clock: `session.compact` (main loop, not `precompute`, not skipped) and `session.end` with reason `clear` or `resume` drop `clock` and `context` and end any break. The next request re-caches the new prefix however long the person waits, so the gate has nothing to save; the band returns with the next response.
- A 1 Hz ticker started in `session.start` writes `now` into plugin state (which redraws the band) and drives the break loop. No module-level state that matters survives a hot reload; everything a drawing reads lives in `$.state`.

### 5.2 Pricing and estimate

`plugins/cache-thermo/pricing.json` (list prices, `asOf` 2026-10-06):

| Model match | Input $/MTok | Output $/MTok | Cache read × |
|---|---|---|---|
| `^claude-fable-5-1` | 10 | 50 | 0.025 |
| `^claude-(fable|mythos)-5` | 10 | 50 | 0.1 |
| `^claude-opus-5-5` | 4 | 20 | 0.05 |
| `^claude-opus-(5|4-8|4-7|4-6)` | 5 | 25 | 0.1 |
| `^claude-sonnet-5-5` | 2 | 10 | 0.1 |
| `^claude-sonnet-5` | 2 | 10 | 0.1 |
| `^claude-sonnet-4-6` | 3 | 15 | 0.1 |
| `^claude-haiku-5-5` | 0.10 | 0.50 | 0.1 |
| `^claude-haiku-4-5` | 1 | 5 | 0.1 |
| fallback (unknown model, Opus tier assumed) | 5 | 25 | 0.1 |

Cache write multiplier: 1.25 for the 5-minute TTL, 2.0 for the 1-hour TTL.

`estimateRecache = contextTokens × inputPrice × writeMultiplier[ttl] / 1e6`. The per-user `inputPriceOverrideUsdPerMTok` replaces the table price when > 0. Model ids are matched by prefix after stripping a provider path such as `us.anthropic.`; a fallback match is flagged "unknown model" in the dialog. Subscription users (rate limits reported) see dollars marked "API-equiv" because their dollars are notional; with `showCostOnSubscription` off they see token counts only, and the gate still uses the notional dollars against `gateThresholdUsd`. The engine's own `estimated_cache_write_usd` reaches only classic hooks, which user-tier plugins do not get, so the mod's table is the only estimate.

Keep-warm cost per refresh = `cache_read_input_tokens × inputPrice × readMultiplier / 1e6 + output_tokens × outputPrice / 1e6`.

### 5.3 Configuration (`userConfig`, shown as `/config` rows)

| Field | Type | Default | Purpose |
|---|---|---|---|
| `cacheTtl` | `auto` / `5m` / `1h` | `auto` | TTL used by the clock when the engine has not reported one |
| `gateThresholdUsd` | number | 0.25 | gate shows only when estimate ≥ this; 0 gates every cold prompt |
| `warnFraction` | number | 0.2 | band turns yellow when remaining ≤ this fraction of TTL |
| `keepWarmLeadSeconds` | number | 90 | break mode refreshes when remaining ≤ this (clamped to ≥ 30 s and ≤ TTL/2) |
| `maxBreakHours` | number | 4 | break mode stops refreshing after this long |
| `inputPriceOverrideUsdPerMTok` | number | 0 | when > 0 replaces the table's input price for the current model |
| `sounds` | boolean | true | play the 8-bit bleeps (macOS only) |
| `showCostOnSubscription` | boolean | true | show API-equivalent dollars to subscription users; off shows tokens only |

### 5.4 Plugin state contract (`types/index.d.ts`)

```ts
'cache-thermo': {
  clock: { lastRequestStartedAt: number; warmUntil: number; ttlMs: number; ttl: '5m' | '1h'; ttlSource: 'config' | 'heuristic' } | null
  context: { tokens: number; window: number; model: string; isSubscription: boolean } | null
  now: number
  gate: { text: string; estimate: Estimate; lastRequestAgoMs: number } | null
  brk: { since: number; refreshes: number; spentUsd: number; nextRefreshAt: number; inFlight: boolean; lastReadTokens: number } | null
  isBandHidden: boolean
  lastZone: 'hot' | 'warm' | 'cold' | 'working' | null
}
```

## 6. Repository layout

```
.claude-plugin/marketplace.json        lists ./plugins/cache-thermo
README.md                              marketplace intro + install lines
docs/cache-thermo-PRD.md               this document
plugins/cache-thermo/
  .claude-plugin/plugin.json           name, version, description, types, userConfig
  hooks/hooks.json                     { "modules": ["./register.tsx"] }
  hooks/register.tsx                   every hook and every helper that takes `$`: band (thermometer, gate and break views), break loop, command
  hooks/clock.ts                       TTL / zone math and formatting (pure)
  hooks/pricing.ts                     model matching, estimates (pure)
  hooks/pricing-table.ts               pricing.json as code (generated by scripts/sync-pricing.mjs)
  hooks/runtime.ts                     module-level runtime (options, in-flight guard), estimate and money wording
  hooks/options.ts                     userConfig parsing
  hooks/theme.ts                       chrome colors, zone labels
  hooks/art.ts                         Ember/Frostbit/campfire SVG + ASCII frames, palette
  hooks/*.test.ts                      `claude plugin test` suites
  types/index.d.ts                     PluginState contract
  pricing.json                         price table + asOf + source
  sounds/*.wav                         warm, cold, gate, resume bleeps
  scripts/gen-sounds.mjs               regenerates the WAVs
  scripts/sync-pricing.mjs             regenerates hooks/pricing-table.ts
  scripts/preview-art.html             browser preview of the SVG art
  CHANGELOG.md                         versions and pricing asOf dates
  tsconfig.json                        extends the engine-laid types
  README.md                            plugin readme
```

## 7. Distribution

Marketplace manifest at the repo root. Install from a terminal session:

```
/plugin install cache-thermo --marketplace stilero/mods-marketplace
```

From a shell: `claude plugin install cache-thermo --marketplace stilero/mods-marketplace`. In Claude Code Desktop: `+` next to the prompt → Plugins → Add marketplace → Add plugin. For local development add the repo folder as a marketplace (`claude plugin marketplace add <repo>`), install from it, and `/reload-plugins` after edits; or run `claude --plugin-dir plugins/cache-thermo`.

Releases: bump `version` in `plugin.json` whenever `pricing.json` changes; note the `asOf` date in the changelog.

## 8. Verification

- `claude plugin validate plugins/cache-thermo` and `claude plugin validate .` report no refusals.
- `tsc -p plugins/cache-thermo` clean; `claude plugin test plugins/cache-thermo` green on terminal and desktop.
- Live (desktop, hot reload): band appears after the first response and counts down; `/cache-thermo cold` + a prompt opens the gate; Continue runs it, Cancel restores the text; `/cache-thermo break` with `cacheTtl` set to `5m` fires a keep-warm within ~4 minutes and the log shows `cache_read_input_tokens` ≈ context tokens; typing a prompt ends the break.
- Live (terminal, `claude --plugin-dir plugins/cache-thermo`): block-art band, ASCII gate and break views, hotkeys b / c / x / r.
- Live (either): `/compact` hides the band until the next response, which shows the smaller context; `/clear` does the same and ends a break.
- Estimate cross-check (manual, the engine's estimate is not visible to the mod): compare `/cache-thermo` with a hand calculation from §5.2 for the context `/context` reports.

## 9. Risks and open points

- TTL is a heuristic (rate limits reported → 1h). Users can pin it in `/config`.
- Dollar figures are list-price estimates; subscription, Bedrock, Vertex and gateway users see "API-equivalent" wording.
- `$.model.fork` cannot cap output tokens; the keep-warm prompt asks for one character and the band shows spend.
- Prompts with images are not gated.
- Band hotkeys work once the band holds the keyboard (a click on it, or ctrl+x tab); the buttons work with the mouse regardless.
- The exact `userConfig` manifest schema is not in the bundled type declarations; it is confirmed against `claude plugin validate` during scaffolding.

## 10. Implementation notes (what the engine actually enforces)

Learned while building v0.1.0 against Claude Code 2.1.292 (CLI, runs `claude plugin test`) and 2.1.299 (the desktop app's engine, whose declarations were used for typing):

- `userConfig` fields need a `title`; `description`, `type`, `default`, `options` are accepted.
- `claude plugin validate` follows `$` statically: a helper that receives `$` must be a top-level function in the same file as the hook that calls it, never imported. That is why gate, break and sound helpers live in `hooks/register.tsx`; `band.tsx` only draws and routes its Break button through `$.command.run({ command: 'cache-thermo', args })`.
- Atoms must be declared (with literal `plugin`/`key`) in the file that reads or updates them; `atom()` takes no explicit generics, its value type comes from the `PluginState` contract.
- A hooks module cannot import JSON, hence `scripts/sync-pricing.mjs` and the runtime read of `pricing.json` via `$.fs.read` and `$.plugin.root`.
- Element props differ by engine version: 2.1.292 refuses `Text.weight`, `size`, `mono`, `tabular` and string `Box.gap` steps. The trees use `bold` and numeric gaps so they draw on both.
- In tests, bottom hooks for `$` calls (`ui.open`, `ui.toast`, `session.usage`, `model.fork`, …) answer `{ value }` or `{ deny }`; event hooks (`prompt.submit`, `turn.complete`, `prompt.fill`, `ui.render`, `command.run`) answer the event's result directly.
- The keep-warm fork's `usage` is a `ModelUsage` without `model`; the model comes from the last response.
- `$.prompt.submit` from the mod must pass `asUser: true` or the model reads the prompt as a plugin message.

- `rateLimits` is empty until a response has reported them, so anything derived from it is decided per response, never at `session.start`.
- `/clear` raises `session.end` with reason `clear` and no `session.start` after it; the 1 Hz ticker keeps running.
- A test's `session.compact` bottom must answer at least one message.

Verified live in the desktop app: band countdown and zones, the break view, a keep-warm hit. Still to check live (see §8): the gate (Continue and Cancel), the terminal surface and hotkeys, compaction and `/clear`, and the `/cache-thermo` slash dispatch in the desktop app, which was flaky on 2.1.299 (the band's buttons call the helpers directly, so nothing depends on it).
