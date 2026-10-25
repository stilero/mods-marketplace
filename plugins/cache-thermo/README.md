# cache-thermo

A Claude Code mod that makes the prompt cache visible, gates cold-cache runs, and keeps the cache warm while you are on a break. Retro look, pixel-art mascots (Ember the fire sprite, Frostbit the ice imp), 8-bit bleeps.

Spec and design: [docs/cache-thermo-PRD.md](../../docs/cache-thermo-PRD.md).

## What you get

- **Thermometer band** above the prompt. Mint while the cache is hot, honey when it is close to cold, rose when cold. Counts down the cache TTL from the start of the last request. Shows context size and the estimated re-cache cost (marked `API-equiv` on a subscription, where the dollars are notional).
- **Cold-cache gate**. Submit a prompt while the cache is cold and the estimated re-cache cost clears the threshold, and the band turns into Frostbit's cold-cache view and holds the prompt: `go ahead anyway · $8.48` (`c`) or `keep my prompt` (`x`), which puts the text back in the composer.
- **Break mode**. `☕ break` (or `/cache-thermo break`) turns the band into the break view (Ember at the campfire, next nudge countdown, nudges and spend) and refreshes the cache just before the TTL lapses with a tiny cache-read request. Come back with `I'm back`, `/cache-thermo resume`, or just type a prompt.
- **Transition toasts** when the cache turns cooling and cold, with sounds on macOS.

## Install

At the prompt of a terminal session:

```
/plugin install cache-thermo --marketplace stilero/mods-marketplace
```

From a shell: `claude plugin install cache-thermo --marketplace stilero/mods-marketplace`. In Claude Code Desktop: `+` next to the prompt → Plugins → Add marketplace → Add plugin.

## Commands

| Command | Effect |
|---|---|
| `/cache-thermo` | One-line status: zone, time left, context, estimate, TTL source, threshold, price date |
| `/cache-thermo break` | Start a break (keep the cache warm) |
| `/cache-thermo resume` | End the break |
| `/cache-thermo hide` / `show` | Hide or show the band |
| `/cache-thermo cold` | Debug: mark the cache cold now, so the gate can be demoed |

## Configuration (`/config` rows)

| Field | Default | Purpose |
|---|---|---|
| Cache TTL | `auto` | `auto` is 1h on a subscription account (rate limits reported), 5m on an API key |
| Gate threshold (USD) | 0.25 | Gate only when the estimated re-cache cost is at least this; 0 gates every cold prompt |
| Warn fraction | 0.2 | Band turns yellow at or below this fraction of the TTL |
| Keep-warm lead (seconds) | 90 | On a break, refresh when this many seconds remain |
| Max break (hours) | 4 | Stop keeping warm after this long |
| Input price override ($/MTok) | 0 | When above 0 replaces the shipped input price for the current model |
| Sounds | on | 8-bit bleeps (macOS) |
| Show cost on subscription | on | Subscription users see API-equivalent dollars; off shows tokens only |

## Pricing

`pricing.json` is the source of truth (list prices, `asOf` date, source URL). Cache writes cost 1.25× the input price on the 5-minute TTL and 2× on the 1-hour TTL; reads are 0.1× by default, 0.025× on Claude Fable 5.1 and 0.05× on Claude Opus 5.5. A hooks module cannot import JSON, so the table is also shipped as `hooks/pricing-table.ts`:

```bash
node scripts/sync-pricing.mjs
```

At session start the mod also reads `pricing.json` from its own folder, so editing the installed copy takes effect on the next session without a rebuild. Bump the plugin `version` when prices change.

## How it works

- `turn.step` records when each main-loop request starts and, from its `stop` chunk, the context size (`input + cache_read + cache_creation + output`) and model. `warmUntil = requestStart + ttl`.
- A 1 Hz ticker writes `now` into plugin state, which redraws the band; it also drives the zone toasts and the break loop.
- The gate is a `prompt.submit` hook that drops the prompt, keeps its text in plugin state, and turns the band into the gate view. Continue resubmits the text as the user's own prompt; Cancel refills the composer. The hook fails open: if anything throws, the prompt goes through.
- A compaction, a `/clear` or a resume into another conversation changes the cached prefix, so the band disappears until the next response starts a fresh clock (and any break ends): the next request writes a new cache however long you wait, so there is nothing to gate.
- `auto` TTL is decided at each response, because the rate limits that mark a subscription arrive with responses.
- Break mode uses `$.model.fork`, which re-sends the main thread's last request (same model, system prompt and messages) with a one-character ping, so the API serves the prefix from the prompt cache and refreshes its TTL. Each refresh is logged with its `cache_read_input_tokens`.

Not gated: slash commands, hidden prompts, prompts delivered into a running turn, prompts with image attachments (a warning toast shows instead), and the mod's own resubmission.

## Development

```bash
claude plugin validate plugins/cache-thermo
claude plugin test plugins/cache-thermo
```

Type-check with the declarations the engine lays beside the mod once it has loaded it (`tsc -p plugins/cache-thermo`). Run it in a terminal with `claude --plugin-dir plugins/cache-thermo`, or in Claude Code Desktop by adding this repo folder as a marketplace. Art lives in `hooks/art.ts` (SVG for desktop, ASCII for the terminal); sounds are generated by `scripts/gen-sounds.mjs`.
