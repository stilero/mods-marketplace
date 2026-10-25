// cache-thermo art: Ember (fire sprite), Frostbit (ice imp), the pixel thermometer, the campfire, ASCII frames.
//
// Dependency-free so it type-checks standalone. Every SVG string is a complete document; pixel art is `<rect>`
// runs on an integer grid with crisp edges, animation is SMIL only (no scripts, no event attributes, no
// external references). The desktop surface draws these through `Svg`; the terminal draws the ASCII frames.
// The look is pastel and calm: soft colours, chubby rounded shapes, big friendly eyes, gentle 1–2 px motion.

export type Zone = 'hot' | 'warm' | 'cold' | 'working'

export const PALETTE = {
  hot: '#6ee7b7',
  warm: '#fcd34d',
  cold: '#fb7185',
  panel: '#0f1420',
  ink: '#dfe7ef',
  ember: '#ffb27a',
  frost: '#93c5fd',
}

type Pal = Readonly<Record<string, string>>

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"'
const CRISP = 'shape-rendering="crispEdges"'

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

const zoneColor = (zone: Zone): string =>
  zone === 'cold' ? PALETTE.cold : zone === 'warm' ? PALETTE.warm : PALETTE.hot

/** Pixel map → rect strings, one per horizontal run of a colour. '.' and ' ' are transparent. */
function runs(rows: readonly string[], pal: Pal, ox: number, oy: number): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row.charAt(x)
      let end = x + 1
      while (end < row.length && row.charAt(end) === ch) end++
      const color = pal[ch]
      if (color !== undefined) {
        ;(out[color] ??= []).push(`<rect x="${x + ox}" y="${y + oy}" width="${end - x}" height="1"/>`)
      }
      x = end
    }
  })
  return out
}

/** Pixel map → rects grouped in a `<g fill>` per colour. */
function pixels(rows: readonly string[], pal: Pal, ox = 0, oy = 0): string {
  return Object.entries(runs(rows, pal, ox, oy))
    .map(([color, rects]) => `<g fill="${color}">${rects.join('')}</g>`)
    .join('')
}

/** Two drawings shown alternately (a hard 2-frame swap, like a sprite sheet). */
function flicker(a: string, b: string, dur: string): string {
  const swap = (values: string) =>
    `<animate attributeName="opacity" values="${values}" keyTimes="0;0.5" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>`
  return `<g>${a}${swap('1;0')}</g><g>${b}${swap('0;1')}</g>`
}

/** A pixel disc of diameter `d` as a map of '#'. */
function disc(d: number): string[] {
  const r = d / 2
  const rows: string[] = []
  for (let y = 0; y < d; y++) {
    const dy = y + 0.5 - r
    const half = Math.sqrt(Math.max(0, r * r - dy * dy))
    let row = ''
    for (let x = 0; x < d; x++) row += Math.abs(x + 0.5 - r) <= half ? '#' : '.'
    rows.push(row)
  }
  return rows
}

/** A pixel pill (rounded ends) as rect strings, one per row. */
function pillRects(x: number, y: number, w: number, h: number): string[] {
  const r = Math.floor(h / 2)
  const out: string[] = []
  for (let row = 0; row < h; row++) {
    const inset = Math.max(0, r - 1 - Math.min(row, h - 1 - row))
    out.push(`<rect x="${x + inset}" y="${y + row}" width="${Math.max(1, w - 2 * inset)}" height="1"/>`)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Ember — a 16×16 fire sprite. Rows 0–8 are the flame (two flicker frames), rows 9–15 the chubby body with the
// face. R outer coral, O peach, Y butter, W cream core, K eyes/mouth, P cheeks, E dying-ember glow, S smoke.

const EMBER_FLAME_A = [
  '.......R........',
  '......RO........',
  '......ROR.......',
  '.....ROYOR......',
  '.....ROYOR..R...',
  '....ROYYYOR.RO..',
  '....ROYWYOR.ROR.',
  '...ROYYWYYORROR.',
  '...ROYYWWYYOYOR.',
]

const EMBER_FLAME_B = [
  '................',
  '........R.......',
  '.......RO.......',
  '......ROYR......',
  '.....ROYYOR.....',
  '....ROYYYOR.....',
  '....ROYWYYOR.R..',
  '...ROYYWYYOR.RO.',
  '...ROYYWWYYORROR',
]

const EMBER_SMALL_FLAME_A = [
  '................',
  '................',
  '................',
  '................',
  '.......R........',
  '......RO........',
  '......ROR...R...',
  '.....ROYOR..RO..',
  '....ROYYYORRROR.',
]

const EMBER_SMALL_FLAME_B = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......R........',
  '......ROR.......',
  '......ROYR...R..',
  '.....ROYYOR.RO..',
]

/** Body with big eyes, rosy cheeks and a smile (hot / working). */
const EMBER_BODY_HAPPY = [
  '..ROYYWWWWYYYOR.',
  '..ROYWKWWWKWWOR.',
  '..ROYWKWWWKWWOR.',
  '..ROPWWWWWWWPOR.',
  '..ROYWKWWWKWWOR.',
  '...ROYYKKKYYOR..',
  '....RROOOOORR...',
]

/** Body with a small worried mouth (warm). */
const EMBER_BODY_WORRIED = [
  '..ROYYWWWWYYYOR.',
  '..ROYWKWWWKWWOR.',
  '..ROYWKWWWKWWOR.',
  '..ROPWWWWWWWPOR.',
  '..ROYWWKKKWWWOR.',
  '...ROYYWWWYYOR..',
  '....RROOOOORR...',
]

/** Grey, frowning body with a dying glow (cold). */
const EMBER_BODY_COLD = [
  '..ROYYWWWWYYYOR.',
  '..ROYWKWWWKWWOR.',
  '..ROYWKWWWKWWOR.',
  '..ROYWWWWWWWWOR.',
  '..ROYWWKKKWWWOR.',
  '...ROYKWWWKYOR..',
  '....RREEEEERR...',
]

const EMBER_SMOKE = [
  '................',
  '........S.......',
  '.......SS.......',
  '........S.......',
  '........S.......',
  '.......S........',
  '.......SS.......',
  '........S.......',
  '........S.......',
]

const EMBER_PAL: Record<'hot' | 'warm' | 'cold', Pal> = {
  hot: { R: '#f08a7a', O: PALETTE.ember, Y: '#ffe3a3', W: '#fff8e6', K: '#5a3a3a', P: PALETTE.cold },
  warm: { R: '#e39a86', O: '#f4b98e', Y: '#fde68a', W: '#fff3d6', K: '#5a3a3a', P: '#f3b8c0' },
  cold: { R: '#4b5566', O: '#687486', Y: '#8a97aa', W: '#aab6c8', K: '#2a3240', P: '#8a97aa' },
}

const FLICKER_DUR: Record<Zone, string> = { hot: '0.6s', warm: '0.9s', cold: '1s', working: '0.3s' }

/** Rising smoke wisps for the cold ember, two staggered copies. */
function smoke(ox: number, oy: number): string {
  const wisp = pixels(EMBER_SMOKE, { S: '#b7c2d1' }, ox, oy)
  const copy = (begin: string) =>
    `<g opacity="0"><animate attributeName="opacity" values="0;0.6;0.6;0" keyTimes="0;0.2;0.6;1" dur="2.8s" begin="${begin}" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" from="0 4" to="0 -5" dur="2.8s" begin="${begin}" repeatCount="indefinite"/>${wisp}</g>`
  return copy('0s') + copy('1.4s')
}

/** The dying-ember glow pixels (E) pulsing on the cold body. */
function coldGlow(ox: number, oy: number): string {
  return `<g><animate attributeName="opacity" values="0.3;0.85;0.3" dur="2.4s" repeatCount="indefinite"/>${pixels(EMBER_BODY_COLD, { E: PALETTE.ember }, ox, oy)}</g>`
}

/** Ember's body (rows 9–15) at an offset. */
function emberBody(zone: Zone, ox: number, oy: number): string {
  if (zone === 'cold') return pixels(EMBER_BODY_COLD, EMBER_PAL.cold, ox, oy + 9) + coldGlow(ox, oy + 9)
  if (zone === 'warm') return pixels(EMBER_BODY_WORRIED, EMBER_PAL.warm, ox, oy + 9)
  return pixels(EMBER_BODY_HAPPY, EMBER_PAL.hot, ox, oy + 9)
}

/** Ember's flame (rows 0–8) at an offset; `tall` forces the big flame shape (used by the thermometer). */
function emberFlame(zone: Zone, ox: number, oy: number, tall = false): string {
  if (zone === 'cold') return smoke(ox, oy)
  const pal = zone === 'warm' ? EMBER_PAL.warm : EMBER_PAL.hot
  const small = zone === 'warm' && !tall
  const a = pixels(small ? EMBER_SMALL_FLAME_A : EMBER_FLAME_A, pal, ox, oy)
  const b = pixels(small ? EMBER_SMALL_FLAME_B : EMBER_FLAME_B, pal, ox, oy)
  return flicker(a, b, FLICKER_DUR[zone])
}

const EMBER_TITLE: Record<Zone, string> = {
  hot: 'Ember, glowing: the cache is warm',
  warm: 'Ember, fading: the cache is cooling',
  cold: 'Ember, gone out: the cache is cold',
  working: 'Ember, working: a request is refreshing the cache',
}

export function emberSvg(zone: Zone, sizePx = 48): string {
  const s = Math.max(8, Math.round(sizePx))
  return `<svg ${XMLNS} viewBox="0 0 16 16" width="${s}" height="${s}" ${CRISP}><title>${EMBER_TITLE[zone]}</title>${emberFlame(zone, 0, 0)}${emberBody(zone, 0, 0)}</svg>`
}

// ---------------------------------------------------------------------------------------------------------------
// Frostbit — a 16×16 ice imp: little crystal ears, big eyes, rosy cheeks, a shy smile, stubby legs, a small shiver.
// D soft-blue outline, F frost, L light frost, W white glints, K eyes and mouth, P cheeks.

const FROSTBIT = [
  '..D..........D..',
  '..DL........LD..',
  '..DFL......LFD..',
  '..DFFLDDDDLFFD..',
  '..DFFFFFFFFFFD..',
  '.DFLFFFFFFFFLFD.',
  '.DFLKKFFFFKKLFD.',
  '.DFFKWFFFFKWFFD.',
  '.DFFKKFFFFKKFFD.',
  '.DFPFKFFFFKFPFD.',
  '..DFFFKKKKFFFD..',
  '..DFFFFFFFFFFD..',
  '...DFFFFFFFFD...',
  '...DFFDFFDFFD...',
  '....DFD..DFD....',
  '....DDD..DDD....',
]

/** Frostbit blinking: the eye rows swapped for closed lids. */
const FROSTBIT_BLINK = [
  '.DFLFFFFFFFFLFD.',
  '.DFFDDFFFFDDFFD.',
  '.DFFFFFFFFFFFFD.',
]

const FROSTBIT_PAL: Pal = { D: '#5b93d6', F: PALETTE.frost, L: '#d6e8ff', W: '#ffffff', K: '#2f4a63', P: '#fda4af' }

/** Frostbit at an offset: a small shiver, an occasional blink, drifting snow pixels. */
function frostbit(ox: number, oy: number): string {
  const body = pixels(FROSTBIT, FROSTBIT_PAL, ox, oy)
  const blink = `<g opacity="0"><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.9;0.9;0.97;1" calcMode="discrete" dur="3.4s" repeatCount="indefinite"/>${pixels(FROSTBIT_BLINK, FROSTBIT_PAL, ox, oy + 6)}</g>`
  const shiver = `<animateTransform attributeName="transform" type="translate" values="0 0;1 0;0 0;0 0;-1 0;0 0;0 0;0 0" calcMode="discrete" dur="0.8s" repeatCount="indefinite"/>`
  const flake = (x: number, y: number, dur: string, begin: string) =>
    `<rect x="${x + ox}" y="${y + oy}" width="1" height="1" fill="#ffffff" opacity="0"><animate attributeName="opacity" values="0;0.8;0.8;0" keyTimes="0;0.1;0.8;1" dur="${dur}" begin="${begin}" repeatCount="indefinite"/><animate attributeName="y" from="${y + oy}" to="${y + oy + 5}" dur="${dur}" begin="${begin}" repeatCount="indefinite"/></rect>`
  return `<g>${shiver}${body}${blink}</g>${flake(0, 1, '3s', '0s')}${flake(15, 4, '2.6s', '1s')}${flake(7, 0, '3.3s', '1.9s')}`
}

export function frostbitSvg(sizePx = 48): string {
  const s = Math.max(8, Math.round(sizePx))
  return `<svg ${XMLNS} viewBox="0 0 16 16" width="${s}" height="${s}" ${CRISP}><title>Frostbit, the ice imp: the cache is cold</title>${frostbit(0, 0)}</svg>`
}

// ---------------------------------------------------------------------------------------------------------------
// Campfire — 24×16: a fire on crossed logs, a small Ember sitting on a stone beside it, sparks drifting up.
// B dark log, b light log, G stones, plus the Ember palette.

const CAMPFIRE_FIRE_A = [
  '........................',
  '.........R..............',
  '........RO..............',
  '........ROR.............',
  '.......ROYOR............',
  '...R...ROYOR............',
  '...RO.ROYYYOR...........',
  '...RORROYWYYOR..........',
  '....ROYYWWWYOR..........',
  '....ROYWWWWWYOR.........',
  '....ROYWWWWWYOR.........',
  '.....ROYYWWYYOR.........',
]

const CAMPFIRE_FIRE_B = [
  '........................',
  '........................',
  '..........R.............',
  '.........RO.............',
  '.........ROR............',
  '........ROYOR...........',
  '.......ROYYOR...........',
  '..R....ROYWYOR..........',
  '..RO..ROYYWWYOR.........',
  '..RORROYWWWWYOR.........',
  '...RROYWWWWWYOR.........',
  '....ROYYWWWYYOR.........',
]

/** Ember sitting (rows 3–11 of the campfire, columns 16–23). */
const CAMPFIRE_EMBER = [
  '..................R.....',
  '.................ROR....',
  '.................ROYR...',
  '................ROYYOR..',
  '................ROWWWOR.',
  '................ROKWWKOR',
  '................ROKWWKOR',
  '................ROWKKWOR',
  '.................RROOOR.',
]

const CAMPFIRE_GROUND = [
  '..bBBBBBBBBBBBBBBb.GGGGG',
  '.bBbbbbbbbbbbbbbbBbGGGGG',
  'GG.GGG.GG.GGG.GG.GGG.GG.',
]

const CAMPFIRE_PAL: Pal = { ...EMBER_PAL.hot, B: '#8a6a52', b: '#b89a80', G: '#4d566a' }

export function campfireSvg(sizePx = 48): string {
  const w = Math.max(12, Math.round(sizePx))
  const h = Math.round((w * 16) / 24)
  const spark = (x: number, y: number, dx: number, dur: string, begin: string, color: string) =>
    `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}" opacity="0"><animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.1;0.6;1" dur="${dur}" begin="${begin}" repeatCount="indefinite"/><animate attributeName="y" from="${y}" to="${y - 6}" dur="${dur}" begin="${begin}" repeatCount="indefinite"/><animate attributeName="x" values="${x};${x + dx};${x}" dur="${dur}" begin="${begin}" repeatCount="indefinite"/></rect>`
  const sparks =
    spark(8, 7, 1, '2.1s', '0s', '#ffe3a3') +
    spark(11, 8, -1, '1.8s', '0.6s', PALETTE.ember) +
    spark(6, 9, 1, '2.3s', '1.1s', '#fff8e6') +
    spark(12, 6, 1, '1.9s', '1.6s', '#ffe3a3')
  const fire = flicker(pixels(CAMPFIRE_FIRE_A, CAMPFIRE_PAL), pixels(CAMPFIRE_FIRE_B, CAMPFIRE_PAL), '0.55s')
  const glow = `<rect x="3" y="11" width="13" height="1" fill="${PALETTE.ember}" opacity="0.45"><animate attributeName="opacity" values="0.45;0.2;0.45" dur="1.1s" repeatCount="indefinite"/></rect>`
  return `<svg ${XMLNS} viewBox="0 0 24 16" width="${w}" height="${h}" ${CRISP}><title>Ember tending the campfire: keeping the cache warm</title>${pixels(CAMPFIRE_GROUND, CAMPFIRE_PAL, 0, 12)}${glow}${fire}${sparks}${pixels(CAMPFIRE_EMBER, CAMPFIRE_PAL, 0, 3)}</svg>`
}

// ---------------------------------------------------------------------------------------------------------------
// Mini mascots for the thermometer — 12×12 so they fit a 32 px band at 2 px per art pixel.

const MINI_FLAME_A = [
  '.....R......',
  '....RO......',
  '....ROR..R..',
  '...ROYOR.RO.',
  '...ROYWORROR',
  '..ROYWWYOYOR',
]

const MINI_FLAME_B = [
  '............',
  '......R.....',
  '.....RO.....',
  '....ROYR....',
  '...ROYWOR.R.',
  '..ROYWWYORRO',
]

const MINI_SMOKE = [
  '............',
  '......S.....',
  '.....SS.....',
  '......S.....',
  '.....S......',
  '.....SS.....',
]

const MINI_BODY_HAPPY = [
  '.ROYWWWWYYOR',
  '.ROYKWWWKWOR',
  '.ROYKWWWKWOR',
  '.RPWKWWWKWPR',
  '..ROWKKKWOR.',
  '...RROOORR..',
]

const MINI_BODY_WORRIED = [
  '.ROYWWWWYYOR',
  '.ROYKWWWKWOR',
  '.ROYKWWWKWOR',
  '.RPWWWWWWWPR',
  '..ROWKKKWOR.',
  '...RROOORR..',
]

const MINI_BODY_COLD = [
  '.ROYWWWWYYOR',
  '.ROYKWWWKWOR',
  '.ROYKWWWKWOR',
  '.RYWWKKKWWYR',
  '..ROKWWWKOR.',
  '...RREEERR..',
]

const MINI_FROSTBIT = [
  '.D........D.',
  '.DL......LD.',
  '.DFLDDDDLFD.',
  '.DFFFFFFFFD.',
  'DFLKKFFFKKFD',
  'DFFKWFFFKWFD',
  'DFPFKFFFKFPD',
  '.DFFFKKKFFD.',
  '.DFFFFFFFFD.',
  '..DFFFFFFD..',
  '..DFDFFDFD..',
  '..DDD..DDD..',
]

const MINI_FROSTBIT_BLINK = ['DFLFFFFFFFFD', 'DFFDDFFFDDFD']

/** Mini Ember's body (rows 6–11) at an offset. */
function miniEmberBody(zone: Zone, ox: number, oy: number): string {
  if (zone === 'cold') {
    return (
      pixels(MINI_BODY_COLD, EMBER_PAL.cold, ox, oy + 6) +
      `<g><animate attributeName="opacity" values="0.3;0.85;0.3" dur="2.4s" repeatCount="indefinite"/>${pixels(MINI_BODY_COLD, { E: PALETTE.ember }, ox, oy + 6)}</g>`
    )
  }
  if (zone === 'warm') return pixels(MINI_BODY_WORRIED, EMBER_PAL.warm, ox, oy + 6)
  return pixels(MINI_BODY_HAPPY, EMBER_PAL.hot, ox, oy + 6)
}

/** Mini Ember's flame (rows 0–5) at an offset; smoke when cold. */
function miniEmberFlame(zone: Zone, ox: number, oy: number): string {
  if (zone === 'cold') {
    const wisp = pixels(MINI_SMOKE, { S: '#b7c2d1' }, ox, oy)
    const copy = (begin: string) =>
      `<g opacity="0"><animate attributeName="opacity" values="0;0.6;0.6;0" keyTimes="0;0.2;0.6;1" dur="2.8s" begin="${begin}" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" from="0 3" to="0 -4" dur="2.8s" begin="${begin}" repeatCount="indefinite"/>${wisp}</g>`
    return copy('0s') + copy('1.4s')
  }
  const pal = zone === 'warm' ? EMBER_PAL.warm : EMBER_PAL.hot
  return flicker(pixels(MINI_FLAME_A, pal, ox, oy), pixels(MINI_FLAME_B, pal, ox, oy), FLICKER_DUR[zone])
}

/** Mini Frostbit at an offset: small shiver, occasional blink. */
function miniFrostbit(ox: number, oy: number): string {
  const blink = `<g opacity="0"><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.9;0.9;0.97;1" calcMode="discrete" dur="3.4s" repeatCount="indefinite"/>${pixels(MINI_FROSTBIT_BLINK, FROSTBIT_PAL, ox, oy + 4)}</g>`
  const shiver = `<animateTransform attributeName="transform" type="translate" values="0 0;1 0;0 0;0 0;-1 0;0 0;0 0;0 0" calcMode="discrete" dur="0.8s" repeatCount="indefinite"/>`
  return `<g>${shiver}${pixels(MINI_FROSTBIT, FROSTBIT_PAL, ox, oy)}${blink}</g>`
}

// ---------------------------------------------------------------------------------------------------------------
// Thermometer — horizontal, 16 grid units tall (2 px per unit at the band's 32 px height). Mini Ember on the
// left (its flame sinks into the body as the fraction drops), a round bulb, a slim pill-shaped tube filled in the
// full zone colour with a soft highlight along the top, dim ticks at 25/50/75 %, mini Frostbit sliding in from
// the right when the cache is cold.

const GRID_H = 16

export function thermometerSvg(opts: { fraction: number; zone: Zone; widthPx: number; heightPx?: number }): string {
  const hPx = Math.max(16, Math.round(opts.heightPx ?? 32))
  const unit = hPx / GRID_H
  const wPx = Math.max(100, Math.round(opts.widthPx))
  const W = Math.max(50, Math.round(wPx / unit))
  const f = clamp01(opts.fraction)
  const zone = opts.zone
  const color = zoneColor(zone)
  const fast = zone === 'working'
  const cold = zone === 'cold'
  const pct = Math.round(f * 100)
  const uid = `ct${zone}${Math.round(f * 1000)}w${W}`
  const glass = '#1a2233'

  // Layout (grid units).
  const emberY = 2 // mini sprite rows 0–11 → y 2..13; the eyes sit level with the tube
  const bulbX = 11
  const bulbY = 6 // 9-unit disc → y 6..14, centre y 10
  const tubeX = 18
  const tubeY = 7
  const tubeH = 7 // outer pill, 14 px at 32 px height
  const tubeW = Math.max(14, W - tubeX - 2)
  const innerX = tubeX + 1
  const innerY = tubeY + 1
  const innerW = tubeW - 2
  const innerH = tubeH - 2
  const fillW = Math.round(innerW * f)

  // Ember: the flame sinks behind the body as the fraction drops; only the tip shows near zero.
  const flameRows = 6
  const sink = cold ? 0 : Math.round((1 - f) * (flameRows - 1))
  const clipId = `${uid}f`
  const ember =
    `<clipPath id="${clipId}"><rect x="0" y="${emberY}" width="12" height="${flameRows}"/></clipPath>` +
    `<g clip-path="url(#${clipId})"><g transform="translate(0 ${sink})">${miniEmberFlame(zone, 0, emberY)}</g></g>` +
    miniEmberBody(zone, 0, emberY)

  // Bulb: ink ring, coloured core with a gentle breathing pulse, a small glint.
  const pulseDur = fast ? '1.2s' : '2.6s'
  const bulb =
    pixels(disc(9), { '#': PALETTE.ink }, bulbX, bulbY) +
    `<g>${pixels(disc(7), { '#': color }, bulbX + 1, bulbY + 1)}<animate attributeName="opacity" values="1;0.8;1" dur="${pulseDur}" repeatCount="indefinite"/></g>` +
    `<rect x="${bulbX + 2}" y="${bulbY + 2}" width="2" height="1" fill="#ffffff" opacity="0.5"/>`

  // Tube: a pill outline in ink with a darker glass interior; the fill is clipped to the inner pill.
  const innerClip = `${uid}i`
  const inner = pillRects(innerX, innerY, innerW, innerH)
  const tube =
    `<g fill="${PALETTE.ink}">${pillRects(tubeX, tubeY, tubeW, tubeH).join('')}</g>` +
    `<g fill="${glass}">${inner.join('')}</g>` +
    `<clipPath id="${innerClip}">${inner.join('')}</clipPath>`

  // Fill: the full zone colour, a soft lighter line along the top, a faint shimmer drifting along it.
  const shimmerDur = fast ? '1.6s' : '3.6s'
  const fill =
    fillW <= 0
      ? ''
      : `<g clip-path="url(#${innerClip})">` +
        `<rect x="${innerX}" y="${innerY}" width="${fillW}" height="${innerH}" fill="${color}"/>` +
        `<rect x="${innerX}" y="${innerY}" width="${fillW}" height="1" fill="#ffffff" opacity="0.4"/>` +
        `<rect x="${innerX - 5}" y="${innerY}" width="4" height="${innerH}" fill="#ffffff" opacity="0.14"><animate attributeName="x" from="${innerX - 5}" to="${innerX + fillW + 2}" dur="${shimmerDur}" repeatCount="indefinite"/></rect>` +
        `</g>`

  // Dim ticks at 25/50/75 % through the glass.
  const ticks = [0.25, 0.5, 0.75]
    .map(t => {
      const x = innerX + Math.round(innerW * t)
      return `<rect x="${x}" y="${innerY}" width="1" height="${innerH}" fill="${PALETTE.ink}" opacity="0.22"/>`
    })
    .join('')

  // Cold: a little rime along the empty tube and mini Frostbit sliding in from the right end.
  const frostX = W - 14
  const rime = cold
    ? [0.5, 0.58, 0.66, 0.73, 0.8]
        .map((t, i) => {
          const x = innerX + Math.round(innerW * t)
          const y = innerY + (i % 2 === 0 ? 0 : innerH - 1)
          return `<rect x="${x}" y="${y}" width="${1 + (i % 2)}" height="1" fill="#d6e8ff" opacity="0.7"/>`
        })
        .join('')
    : ''
  const visitor = cold
    ? `<g transform="translate(${W + 2} 2)"><animateTransform attributeName="transform" type="translate" from="${W + 2} 2" to="${frostX} 2" dur="0.8s" fill="freeze" calcMode="spline" keySplines="0.2 0.8 0.3 1"/>${miniFrostbit(0, 0)}</g>`
    : ''

  const title = `Prompt cache thermometer: ${pct}% of the TTL left (${zone})`
  return `<svg ${XMLNS} viewBox="0 0 ${W} ${GRID_H}" width="${wPx}" height="${hPx}" ${CRISP}><title>${title}</title>${tube}${fill}${rime}${ticks}${bulb}${ember}${visitor}</svg>`
}

// ---------------------------------------------------------------------------------------------------------------
// Terminal art: 3 rows, two frames each. Every glyph is one cell wide in every terminal: ASCII plus
// ｡ ◕ ‿ ᵔ ᶻ, never emoji (❄ ☕) or East Asian ambiguous-width marks (• ⌒ ˘ °), which some terminals draw
// two cells wide and shear the sprite. Rows are padded to one width; `asciiWidth` sizes the column.

const frames = (...f: string[][]): string[][] => {
  const w = Math.max(...f.flat().map(r => r.length))
  return f.map(rows => rows.map(r => r.padEnd(w)))
}

/** Ember: a flame tuft over a little face; big flames while working, a dozing ember when cooling off. */
export const EMBER_ASCII: Record<Zone, string[][]> = {
  hot: frames(['    (', '   ) )', ' (｡◕‿◕｡)'], ['     )', '   ( (', ' (｡◕‿◕｡)']),
  warm: frames(['', '    ,', ' (｡-‿-｡) zᶻ'], ['', "    '", ' (｡-‿-｡)ᶻ']),
  cold: frames(['   ~  ~', '    ~', ' (｡;_;｡)'], ['    ~  ~', '   ~', ' (｡;_;｡)']),
  working: frames(['  \\ ) ( /', '   ) ( )', ' (｡>‿<｡)'], ['  / ( ) \\', '   ( ) (', ' (｡>‿<｡)']),
}

/** Frostbit: an ice crown, a shiver (one cell side to side) and falling snow. */
export const FROSTBIT_ASCII: string[][] = frames(
  [' * /\\/\\/\\ .', '  (｡◕~◕｡)', ' .  u  u  *'],
  [' . /\\/\\/\\ *', '   (｡◕~◕｡)', ' *  u  u  .'],
)

/** Ember on a break: a mug of cocoa beside a crackling campfire. */
export const CAMPFIRE_ASCII: string[][] = frames(
  ['            )', ' (｡ᵔ‿ᵔ｡)   ( (', '  c[_]    /\\/\\'],
  ['           (', ' (｡ᵔ‿ᵔ｡)    ) )', '  c[_]    /\\/\\'],
)

/** The column a set of frames needs, one cell of air included. */
export const asciiWidth = (f: string[][]): number => Math.max(...f.flat().map(r => r.length)) + 1

/** One column for every Ember zone and Frostbit, so the band's bar does not jump when the zone changes. */
export const BUDDY_W = Math.max(asciiWidth(FROSTBIT_ASCII), ...Object.values(EMBER_ASCII).map(asciiWidth))

/** `█` × filled and `░` × (total − filled), both clamped to the bar. */
export function bar(filledCells: number, totalCells: number): { fill: string; empty: string } {
  const total = Math.max(0, Math.floor(Number.isFinite(totalCells) ? totalCells : 0))
  const filled = Math.min(total, Math.max(0, Math.round(Number.isFinite(filledCells) ? filledCells : 0)))
  return { fill: '█'.repeat(filled), empty: '░'.repeat(total - filled) }
}
