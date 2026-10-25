# Changelog

## 0.2.2 (2026-10-22)

- `/cache-thermo cold` says what the next prompt will do: held by the gate, or under the gate threshold and sent straight through (with how to gate every cold prompt). A small context, or a 5m TTL, used to pass silently and look like a broken gate.

## 0.2.1 (2026-10-22)

- Cuter terminal buddies: Ember `(｡◕‿◕｡)` under a flickering flame tuft (dozing `(｡-‿-｡)ᶻ` when cooling off, `(｡>‿<｡)` while working), Frostbit `(｡◕~◕｡)` shivering under an ice crown with falling snow, and Ember with a mug of cocoa `c[_]` by the campfire on a break. Only glyphs that are one cell wide in every terminal.

## 0.2.0 (2026-10-22)

- The cold-cache gate lives in the band above the prompt, like the break view, instead of a separate pane. It shows even when the band is hidden.
- Subscription accounts see re-cache and break costs marked `API-equiv`; with `showCostOnSubscription` off they see tokens only (band, gate, toasts, `/cache-thermo`). The option used to hide dollars for every account.
- `cacheTtl: auto` is decided at each response. At session start no rate limits have been reported yet, so a fresh subscription session got the 5m TTL.
- A compaction, `/clear` or resume drops the clock and ends a break: the next request re-caches the new prefix whatever the clock says, so the gate no longer fires on stale figures.
- Removed the engine-TTL and engine-estimate paths left over from the classic hooks dropped in 0.1.x.
- Prices unchanged: `pricing.json` asOf 2026-10-06.

## 0.1.0 (2026-10-22)

- First release: thermometer band, cold-cache gate, break mode, Ember and Frostbit, sounds. Prices asOf 2026-10-06.
