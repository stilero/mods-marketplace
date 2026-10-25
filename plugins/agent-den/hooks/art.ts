// agent-den art: the buddy SVGs (one loop per status, one-shot transitions), the empty den, the ASCII frames.
//
// Every SVG string is a complete document on a 24×24 grid: pixel art is `<rect>` runs with crisp edges, animation
// is SMIL only (no scripts, no event attributes, no external references, `url(#…)` only to its own ids). The
// buddy's 16×16 body sits at (4, 7); row 23 holds the shadow; rows 0–6 and the side columns hold the effects
// (bubble, z's, rain cloud, badge, sparks, hourglass). Faces come from templates: art paints each body's eye and
// mouth boxes with the skin around them, then draws the mood of the status on top.
//
// The source is stable: the same inputs give the same string (the id prefix is a hash of the inputs, never a
// counter or the time), so a re-render does not reload the frame and restart the loops. The agent's own text
// never goes into an SVG; `bubble` only adds the 3-dot bubble and a word in the escaped `<title>`.
//
// The preview builder loads this file without a bundler: write each import on one line, value-import only from
// ./buddies, and use only `export const` / `export function`.

import type { AgentRow, DenStatus } from '../types'
import type { ResolvedBuddy } from './buddies'

export type Animations = 'full' | 'calm' | 'off'
export type Transition = 'spawn' | 'complete' | 'fail' | 'leave' | null

/** How long a one-shot transition plays, in ms. */
export const TRANSITION_MS = 1500

const isEndedStatus = (s: DenStatus): boolean => s === 'completed' || s === 'failed' || s === 'killed'

/** Which one-shot plays now (null: none). */
export function transitionFor(
  row: Pick<AgentRow, 'status' | 'statusSince' | 'startedAt' | 'endedAt'>,
  now: number,
  keepFinishedMs: number,
): Transition {
  const ended = isEndedStatus(row.status)
  if (ended && row.endedAt !== undefined && now >= row.endedAt + keepFinishedMs - TRANSITION_MS) return 'leave'
  // startedAt, not statusSince: a pending → running change in the first second must not cut the pop short.
  if (!ended && now - row.startedAt < TRANSITION_MS) return 'spawn'
  if (now - row.statusSince < TRANSITION_MS) {
    if (row.status === 'completed') return 'complete'
    if (row.status === 'failed') return 'fail'
  }
  return null
}

/** Width of every terminal sprite row, in cells. */
export const ASCII_W = 13

/** One-cell braille spinner frames. */
export const SPINNER: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// ---------------------------------------------------------------------------------------------------------------
// Helpers (runs, pixels, flicker, disc and pillRects come from cache-thermo; each mod is self-contained).

type Pal = Readonly<Record<string, string>>
type Point = { x: number; y: number }

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"'
const CRISP = 'shape-rendering="crispEdges"'
const LOOP = 'repeatCount="indefinite"'
const ONCE = 'begin="0s" fill="freeze"'
const BX = 4 // body origin on the 24×24 canvas
const BY = 7

const INK = '#2b2f3a'
const GLINT = '#ffffff'
const PINK = '#f6a6b8'
const PANEL = '#0f1420'
const MINT = '#6ee7b7'
const FROST = '#93c5fd'
const GHOST = '#9aa3b5'
const LAVENDER = '#c4b5fd'
const CONFETTI = ['#6ee7b7', '#fcd34d', '#fb7185', '#93c5fd', '#c4b5fd', '#ffb27a']

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** FNV-1a (32 bit) as 8 hex digits: a stable id prefix from the inputs. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Seconds as an SMIL clock value, scaled by the calm factor. */
const sec = (n: number, k = 1): string => `${Math.round(n * k * 100) / 100}s`

/** Pixel map → rect strings, one per horizontal run of a colour. Letters not in `pal` are transparent. */
function runs(rows: readonly string[], pal: Pal, ox: number, oy: number): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row.charAt(x)
      let end = x + 1
      while (end < row.length && row.charAt(end) === ch) end++
      const color = Object.prototype.hasOwnProperty.call(pal, ch) ? pal[ch] : undefined
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
    `<animate attributeName="opacity" values="${values}" keyTimes="0;0.5" calcMode="discrete" dur="${dur}" ${LOOP}/>`
  return `<g>${a}${swap('1;0')}</g><g opacity="0">${b}${swap('0;1')}</g>`
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

/** Wraps `inner` so that `anim` (a scale or rotate animateTransform) acts about the point (cx, cy). */
function about(cx: number, cy: number, anim: string, inner: string): string {
  return `<g transform="translate(${cx} ${cy})"><g>${anim}<g transform="translate(${-cx} ${-cy})">${inner}</g></g></g>`
}

/** A looping animateTransform; `discrete` takes the keyTimes. */
function loopT(type: string, values: string, dur: string, keyTimes?: string): string {
  const timing = keyTimes === undefined ? '' : ` keyTimes="${keyTimes}" calcMode="discrete"`
  return `<animateTransform attributeName="transform" type="${type}" values="${values}" dur="${dur}"${timing} ${LOOP}/>`
}

/** A looping animate of one attribute. `discrete` keyTimes swap hard; plain keyTimes interpolate. */
function loopA(attr: string, values: string, dur: string, o: { keyTimes?: string; discrete?: true; begin?: string } = {}): string {
  const times = o.keyTimes === undefined ? '' : ` keyTimes="${o.keyTimes}"${o.discrete === true ? ' calcMode="discrete"' : ''}`
  const start = o.begin === undefined ? '' : ` begin="${o.begin}"`
  return `<animate attributeName="${attr}" values="${values}" dur="${dur}"${times}${start} ${LOOP}/>`
}

/** #rrggbb → its luminance grey (the killed buddy is drawn in greys; no filter needed). */
function grey(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (m === null || m[1] === undefined) return GHOST
  const n = parseInt(m[1], 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  const v = Math.round(Math.min(255, Math.max(0, lum))).toString(16).padStart(2, '0')
  return `#${v}${v}${v}`
}

// ---------------------------------------------------------------------------------------------------------------
// Faces. K ink, W glint, P pink, s skin (not drawn: the box is painted with skin first). The right eye mirrors.

const EYES = {
  open: ['WKK', 'KKK', 'KKK'],
  closed: ['sss', 'KKK', 'sss'],
  sleep: ['sss', 'KsK', 'sKs'],
  happy: ['sKs', 'KsK', 'sss'],
  cross: ['KsK', 'sKs', 'KsK'],
  hollow: ['KKK', 'KsK', 'KKK'],
} as const

const MOUTHS = {
  smile: ['KssK', 'sKKs'],
  big: ['KKKK', 'sPPs'],
  small: ['ssss', 'sKKs'],
  flat: ['ssss', 'KKKK'],
  frown: ['sKKs', 'KssK'],
  none: ['ssss', 'ssss'],
} as const

type EyeName = keyof typeof EYES
type MouthName = keyof typeof MOUTHS

const MOOD: Record<DenStatus, { eyes: EyeName; mouth: MouthName }> = {
  pending: { eyes: 'sleep', mouth: 'none' },
  running: { eyes: 'open', mouth: 'smile' },
  waiting: { eyes: 'open', mouth: 'flat' },
  idle: { eyes: 'closed', mouth: 'small' },
  completed: { eyes: 'happy', mouth: 'big' },
  failed: { eyes: 'cross', mouth: 'frown' },
  killed: { eyes: 'hollow', mouth: 'flat' },
}

const WORD: Record<DenStatus, string> = {
  pending: 'hatching',
  running: 'busy',
  waiting: 'waiting',
  idle: 'napping',
  completed: 'done',
  failed: 'oops',
  killed: 'stopped',
}

/** Finds the two 3×3 eye boxes ('E') and the 4×2 mouth box ('M') of a body; null when malformed. */
export function faceBoxes(
  body: readonly string[],
): { eyes: [{ x: number; y: number }, { x: number; y: number }]; mouth: { x: number; y: number } } | null {
  const eyes: Point[] = []
  const mouth: Point[] = []
  body.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row.charAt(x)
      if (c === 'E') eyes.push({ x, y })
      else if (c === 'M') mouth.push({ x, y })
    }
  })
  if (eyes.length !== 18 || mouth.length !== 8) return null
  const at = (x: number, y: number): string => body[y]?.charAt(x) ?? ''
  const ey = Math.min(...eyes.map(p => p.y))
  const lx = Math.min(...eyes.map(p => p.x))
  const rx = Math.max(...eyes.map(p => p.x)) - 2
  // Two separate boxes: at least one cell between them, so each eye has skin on both sides.
  if (rx < lx + 4) return null
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) if (at(lx + dx, ey + dy) !== 'E' || at(rx + dx, ey + dy) !== 'E') return null
  }
  const mx = Math.min(...mouth.map(p => p.x))
  const my = Math.min(...mouth.map(p => p.y))
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 4; dx++) if (at(mx + dx, my + dy) !== 'M') return null
  return { eyes: [{ x: lx, y: ey }, { x: rx, y: ey }], mouth: { x: mx, y: my } }
}

/** The skin under a box: the palette letter seen most in the ring of cells around it (ties: first in char order). */
function ringSkin(body: readonly string[], pal: Pal, x: number, y: number, w: number, h: number): string | undefined {
  const counts: Record<string, number> = {}
  for (let yy = y - 1; yy <= y + h; yy++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      if (yy >= y && yy < y + h && xx >= x && xx < x + w) continue
      const c = body[yy]?.charAt(xx) ?? ''
      if (c === '' || c === '.' || c === 'E' || c === 'M' || !Object.prototype.hasOwnProperty.call(pal, c)) continue
      counts[c] = (counts[c] ?? 0) + 1
    }
  }
  let best: string | undefined
  for (const c of Object.keys(counts).sort()) if (best === undefined || (counts[c] ?? 0) > (counts[best] ?? 0)) best = c
  return best
}

/** The body with its eye and mouth boxes painted in the skin around them. */
function skinnedBody(body: readonly string[], pal: Pal, face: NonNullable<ReturnType<typeof faceBoxes>>): string[] {
  const rows = body.map(r => [...r])
  const fill = (x: number, y: number, w: number, h: number) => {
    const skin = ringSkin(body, pal, x, y, w, h) ?? '.'
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const row = rows[y + dy]
      if (row !== undefined) row[x + dx] = skin
    }
  }
  fill(face.eyes[0].x, face.eyes[0].y, 3, 3)
  fill(face.eyes[1].x, face.eyes[1].y, 3, 3)
  fill(face.mouth.x, face.mouth.y, 4, 2)
  return rows.map(r => r.join(''))
}

const mirror = (rows: readonly string[]): string[] => rows.map(r => [...r].reverse().join(''))

// ---------------------------------------------------------------------------------------------------------------
// Effects, drawn on the canvas around the buddy.

/** Campfire-style spark pixels that rise and fade at the head sides (running, full only). */
function sparks(accent: string): string {
  const spark = (x: number, y: number, color: string, dur: string, begin: string) =>
    `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}" opacity="0">` +
    loopA('opacity', '0;0.9;0.9;0', dur, { keyTimes: '0;0.15;0.6;1', begin }) +
    loopA('y', `${y};${y - 4}`, dur, { begin }) +
    `</rect>`
  return spark(21, 13, accent, '1.6s', '0s') + spark(2, 12, '#fff8e6', '1.9s', '0.7s') + spark(22, 16, '#ffe3a3', '1.7s', '1.2s')
}

/** A frost sweat drop that slides down beside the head. */
function sweat(k: number): string {
  return (
    `<g opacity="0">` +
    loopA('opacity', '0;1;1;0', sec(2.4, k), { keyTimes: '0;0.1;0.7;1' }) +
    loopT('translate', '0 0;0 4', sec(2.4, k)) +
    `<rect x="3" y="10" width="1" height="2" fill="${FROST}"/></g>`
  )
}

/** The speech bubble with three typing dots, top right. */
function speechBubble(live: boolean, k: number): string {
  const shape = pixels(['.#####.', '#######', '#######', '#######', '.#####.', '.#.....'], { '#': '#f4f7fb' }, 16, 0)
  const dot = (x: number, begin: number) =>
    live
      ? `<rect x="${x}" y="2" width="1" height="1" fill="#5a6478" opacity="0.3">${loopA('opacity', '0.3;1;0.3', sec(1.2, k), { begin: sec(begin, k) })}</rect>`
      : `<rect x="${x}" y="2" width="1" height="1" fill="#5a6478"/>`
  return shape + dot(17, 0) + dot(19, 0.2) + dot(21, 0.4)
}

/** A small hourglass beside the buddy: the top sand drains, a grain falls, the pile grows (waiting). */
function hourglass(live: boolean, k: number): string {
  const frame = pixels(['FFF', '...', '...', '...', 'FFF'], { F: '#c9a77c' }, 20, 14)
  const glass = `<g fill="#dfe7ef" opacity="0.25"><rect x="20" y="15" width="3" height="1"/><rect x="20" y="17" width="3" height="1"/></g>`
  if (!live) return frame + glass + `<rect x="20" y="15" width="3" height="1" fill="#fcd34d"/><rect x="21" y="17" width="1" height="1" fill="#fcd34d"/>`
  const d = sec(2.4, k)
  return (
    frame +
    glass +
    `<rect x="20" y="15" width="3" height="1" fill="#fcd34d">${loopA('opacity', '1;0', d)}</rect>` +
    `<rect x="21" y="16" width="1" height="1" fill="#fcd34d">${loopA('opacity', '1;0', sec(0.4, k), { keyTimes: '0;0.5', discrete: true })}</rect>` +
    `<rect x="20" y="17" width="3" height="1" fill="#fcd34d">${loopA('opacity', '0;1', d)}</rect>`
  )
}

/** Two pixel z's that float up and fade (idle). */
function snores(live: boolean, k: number): string {
  const z = (ox: number, oy: number, color: string) => pixels(['ZZZ', '.Z.', 'ZZZ'], { Z: color }, ox, oy)
  if (!live) return z(18, 1, LAVENDER) + `<g opacity="0.6">${z(15, 4, FROST)}</g>`
  const copy = (color: string, begin: string) =>
    `<g opacity="0">` +
    loopA('opacity', '0;0.9;0.9;0', sec(2.8, k), { keyTimes: '0;0.2;0.6;1', begin }) +
    `<animateTransform attributeName="transform" type="translate" values="0 0;5 -5" dur="${sec(2.8, k)}" begin="${begin}" ${LOOP}/>` +
    z(15, 5, color) +
    `</g>`
  return copy(LAVENDER, '0s') + copy(FROST, sec(1.4, k))
}

/** The ✓ badge: a mint disc with a check in the panel colour (completed). */
function badge(): string {
  return pixels(disc(5), { '#': MINT }, 18, 1) + pixels(['...#.', '#.#..', '.#...'], { '#': PANEL }, 18, 2)
}

/** A small rain cloud with falling frost drops (failed). */
function rainCloud(live: boolean, k: number): string {
  const cloud = pixels(['..GGG...', '.GGGGGG.', 'GGGGGGGG'], { G: GHOST }, 8, 0)
  const drop = (x: number, begin: number) =>
    live
      ? `<rect x="${x}" y="3" width="1" height="1" fill="${FROST}" opacity="0">` +
        loopA('opacity', '0;1;0', sec(1.2, k), { begin: sec(begin, k) }) +
        loopA('y', '3;6', sec(1.2, k), { begin: sec(begin, k) }) +
        `</rect>`
      : `<rect x="${x}" y="${3 + (x % 2)}" width="1" height="1" fill="${FROST}"/>`
  return cloud + drop(9, 0) + drop(12, 0.4) + drop(14, 0.8)
}

/** The front half of an egg shell over the body, with a jagged crack edge (pending). */
function eggShell(accent: string): string {
  const EGG = [
    '.c..c....c..c...',
    'cCccCc..cCccCc.c',
    'cCCCCCccCCCCCCcC',
    'cCCxCCCCCCCxCCCc',
    'cCCCCCCxCCCCCCCc',
    '.cCxCCCCCCCCxCc.',
    '..cccccccccccc..',
  ]
  return pixels(EGG, { C: '#fdf6e3', c: '#d8c8a8', x: accent }, BX, 16)
}

/** A shell cap on the head (pending), tilting a little. */
function eggCap(top: number, live: boolean, k: number): string {
  const cap = pixels(['..cccc..', '.cCCCCc.', 'cCCxCCCc', 'c.cC.Cc.'], { C: '#fdf6e3', c: '#d8c8a8', x: '#f6c9a8' }, 8, top - 3)
  if (!live) return cap
  return about(12, top, loopT('rotate', '-8;0;8;0', sec(1.6, k), '0;0.25;0.5;0.75'), cap)
}

// ---------------------------------------------------------------------------------------------------------------
// The buddy SVG.

/** The buddy drawn for a status, as a complete SVG document (`sizePx` square; 48, 72 and 96 are pixel-crisp). */
export function buddySvg(
  b: ResolvedBuddy,
  status: DenStatus,
  opts: { sizePx: number; transition: Transition; animations: Animations; bubble?: string },
): string {
  const size = Math.max(8, Math.round(Number.isFinite(opts.sizePx) ? opts.sizePx : 48))
  const animations: Animations = opts.animations === 'calm' || opts.animations === 'off' ? opts.animations : 'full'
  const live = animations !== 'off'
  const full = animations === 'full'
  const k = animations === 'calm' ? 2 : 1
  const transition = live ? opts.transition : null
  const bubble = typeof opts.bubble === 'string' && opts.bubble.trim() !== '' ? opts.bubble.trim() : undefined
  const id = `ad${fnv1a([b.key, b.variant, status, String(opts.transition), animations, size, bubble ?? ''].join('|'))}`

  const ghost = status === 'killed'
  const pal: Record<string, string> = {}
  for (const [letter, color] of Object.entries(b.palette)) pal[letter] = ghost ? grey(color) : color
  const tone = (c: string): string => (ghost ? grey(c) : c)
  const facePal: Pal = { K: tone(b.palette.K ?? INK), W: tone(b.palette.W ?? GLINT), P: tone(b.palette.P ?? PINK) }

  // Body rows with the face boxes painted as skin.
  const face = faceBoxes(b.body)
  const rows = face === null ? b.body.map(r => r.replace(/[EM]/g, '.')) : skinnedBody(b.body, pal, face)
  const top = Math.max(0, rows.findIndex(r => r.replace(/\./g, '').length >= 6)) + BY

  // Body layer. A ghost's bottom row is a hem that waves (every other cell, swapped). Waiting taps the left
  // foot: the body is drawn twice, clipped, and only the foot window moves.
  let body = pixels(rows, pal, BX, BY)
  let defs = ''
  if (ghost) {
    const last = rows.map(r => /[^.]/.test(r)).lastIndexOf(true)
    const hem = (odd: number) =>
      pixels(rows.map((r, y) => (y === last ? [...r].map((c, x) => (x % 2 === odd ? '.' : c)).join('') : r)), pal, BX, BY)
    body = live ? flicker(hem(1), hem(0), sec(0.8, k)) : hem(1)
  } else if (status === 'waiting' && live) {
    defs =
      `<clipPath id="${id}a"><rect x="0" y="0" width="24" height="21"/><rect x="0" y="21" width="4" height="3"/><rect x="10" y="21" width="14" height="3"/><rect x="4" y="23" width="6" height="1"/></clipPath>` +
      `<clipPath id="${id}b"><rect x="4" y="21" width="6" height="2"/></clipPath>`
    body =
      `<g clip-path="url(#${id}a)">${body}</g>` +
      `<g clip-path="url(#${id}b)"><g>${loopT('translate', '0 0;0 -1', sec(0.6, k), '0;0.5')}${body}</g></g>`
  }
  // 'A' cells are lights (Bolt's antenna, Digby's lamp): they pulse white over the body and prop while running.
  const glow = pixels(rows, { A: '#ffffff' }, BX, BY) + pixels(b.prop ?? [], { A: '#ffffff' }, BX, BY)
  const lights = status === 'running' && live && glow !== '' ? `<g opacity="0">${loopA('opacity', '0;0.8;0', sec(1, k))}${glow}</g>` : ''

  // Face layer.
  const mood = MOOD[status]
  const eyesOf = (name: EyeName): string =>
    face === null
      ? ''
      : pixels(EYES[name], facePal, BX + face.eyes[0].x, BY + face.eyes[0].y) +
        pixels(mirror(EYES[name]), facePal, BX + face.eyes[1].x, BY + face.eyes[1].y)
  const mouth = face === null ? '' : pixels(MOUTHS[mood.mouth], facePal, BX + face.mouth.x, BY + face.mouth.y)
  let eyes = eyesOf(mood.eyes)
  if (live && status === 'running') {
    // Blink: closed for 6 % of a 3 s cycle, a discrete swap as Frostbit's.
    eyes =
      `<g>${loopA('opacity', '1;0;1', sec(3, k), { keyTimes: '0;0.9;0.96', discrete: true })}${eyes}</g>` +
      `<g opacity="0">${loopA('opacity', '0;1;0', sec(3, k), { keyTimes: '0;0.9;0.96', discrete: true })}${eyesOf('closed')}</g>`
  } else if (live && status === 'completed') {
    eyes =
      `<g>${loopA('opacity', '1;0;1', sec(4, k), { keyTimes: '0;0.9;0.94', discrete: true })}${eyes}</g>` +
      `<g opacity="0">${loopA('opacity', '0;1;0', sec(4, k), { keyTimes: '0;0.9;0.94', discrete: true })}${eyesOf('closed')}</g>`
  } else if (live && status === 'waiting') {
    eyes = `<g>${loopT('translate', '0 0;-1 0;0 0;1 0', sec(2.4, k), '0;0.25;0.5;0.75')}${eyes}</g>`
  }
  let faceLayer = eyes + mouth
  if (live && status === 'failed') faceLayer = `<g>${loopT('translate', '0 0;0 1', sec(3, k), '0;0.5')}${faceLayer}</g>`

  const prop = b.prop === undefined ? '' : pixels(b.prop, pal, BX, BY)
  let buddy = body + faceLayer + prop + lights
  if (status === 'pending') buddy += eggShell(tone(b.accent)) + eggCap(top, live, k)

  // Status loop, about the feet.
  if (live) {
    if (status === 'running' && full) {
      const squash = about(12, 23, loopT('scale', '1.06 0.94;1 1', sec(0.5), '0;0.2'), buddy)
      buddy = `<g>${loopT('translate', '0 0;0 -1', sec(0.5), '0;0.5')}${squash}</g>`
    } else if (status === 'idle') {
      buddy = about(12, 23, `<animateTransform attributeName="transform" type="scale" values="1 1;1.04 1.04;1 1" dur="${sec(3, k)}" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" ${LOOP}/>`, buddy)
    } else if (status === 'completed' && full) {
      buddy = about(12, 23, `<animateTransform attributeName="transform" type="scale" values="1 1;1.03 1.03;1 1" dur="4s" calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" ${LOOP}/>`, buddy)
    } else if (status === 'pending') {
      buddy = `<g>${loopT('rotate', '0 12 22;-4 12 22;0 12 22;4 12 22', sec(1.6, k), '0;0.25;0.5;0.75')}${buddy}</g>`
    } else if (status === 'killed') {
      buddy = `<g>${loopT('translate', '0 0;1 0;0 0;-1 0', sec(3, k), '0;0.25;0.5;0.75')}<g>${loopT('translate', '0 0;0 -1', sec(1.5, k), '0;0.5')}${buddy}</g></g>`
    }
  }
  if (status === 'failed') buddy = `<g transform="translate(0 1)">${buddy}</g>`
  if (ghost) buddy = `<g opacity="0.55">${buddy}</g>`

  // Shadow on row 23: it narrows while a running buddy is up in the air.
  const shadowRects = `<g fill="#000000" opacity="${ghost ? 0.12 : 0.25}">${pillRects(7, 23, 10, 1).join('')}</g>`
  const shadow =
    status === 'running' && full ? about(12, 23, loopT('scale', '1 1;0.8 1', sec(0.5), '0;0.5'), shadowRects) : shadowRects

  // Effects around the buddy.
  let effects = ''
  if (status === 'running') {
    if (full) effects += sparks(tone(b.accent))
    if (live) effects += sweat(k)
  }
  if (status === 'waiting') effects += hourglass(live, k)
  if (status === 'idle') effects += snores(live, k)
  if (status === 'completed') effects += badge()
  if (status === 'failed') effects += rainCloud(live, k)
  if (bubble !== undefined && status !== 'killed') effects += speechBubble(live, k)

  // One-shot transition wrapper (fill="freeze"); confetti and shell chips fly outside it.
  let scene = shadow + buddy + effects
  let extras = ''
  const once = sec(TRANSITION_MS / 1000)
  if (transition === 'spawn') {
    const values = full ? '0 0;1.15 1.15;1 1' : '0 0;1 1'
    const timing = full ? 'keyTimes="0;0.6;1" keySplines="0.2 0.8 0.3 1;0.4 0 0.6 1"' : 'keyTimes="0;1" keySplines="0.2 0.8 0.3 1"'
    scene = about(12, 22, `<animateTransform attributeName="transform" type="scale" values="${values}" ${timing} calcMode="spline" dur="${once}" ${ONCE}/>`, scene)
    const chip = (x: number, dx: number) =>
      `<g><animateTransform attributeName="transform" type="translate" values="0 0;${dx} -5" dur="1s" ${ONCE}/><animate attributeName="opacity" values="1;0" dur="1s" ${ONCE}/>` +
      pixels(['cC', 'Cc'], { C: '#fdf6e3', c: '#d8c8a8' }, x, 18) +
      `</g>`
    extras = chip(8, -7) + chip(14, 7)
  } else if (transition === 'complete') {
    scene = `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${full ? -3 : -1};0 0;0 0" keyTimes="0;0.35;0.7;1" dur="${once}" ${ONCE}/>${scene}</g>`
    if (full) {
      const ends: [number, number][] = [[-8, -6], [-5, -9], [-1, -10], [3, -10], [6, -8], [9, -5]]
      extras = ends
        .map(
          ([dx, dy], i) =>
            `<rect x="12" y="11" width="1" height="1" fill="${CONFETTI[i] ?? MINT}">` +
            `<animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${dy}" dur="1.2s" ${ONCE}/>` +
            `<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.6;1" dur="1.2s" ${ONCE}/></rect>`,
        )
        .join('')
    }
  } else if (transition === 'fail') {
    scene = `<g><animateTransform attributeName="transform" type="translate" values="0 0;-1 0;1 0;-1 0;1 0;0 0" keyTimes="0;0.17;0.33;0.5;0.67;0.83" calcMode="discrete" dur="0.8s" ${ONCE}/>${scene}</g>`
  } else if (transition === 'leave') {
    scene = `<g><animate attributeName="opacity" values="1;0" dur="${once}" ${ONCE}/><animateTransform attributeName="transform" type="translate" values="0 0;8 0" dur="${once}" ${ONCE}/>${scene}</g>`
  }

  // Hover: the buddy hops up one pixel under the pointer (a CSS :hover, so it needs no script).
  const hover = live ? `<style>svg:hover .${id}h{transform:translate(0px,-1px)}</style>` : ''
  const word = WORD[status] + (bubble === undefined ? '' : `, ${bubble}`)
  const title = esc(`${b.displayName} the ${b.species}: ${word}`)
  const defsTag = defs === '' ? '' : `<defs>${defs}</defs>`
  return `<svg ${XMLNS} viewBox="0 0 24 24" width="${size}" height="${size}" ${CRISP}><title>${title}</title>${hover}${defsTag}<g class="${id}h">${scene}${extras}</g></svg>`
}

// ---------------------------------------------------------------------------------------------------------------
// The empty den: a burrow in a grassy mound, a sleepy pair of eyes in the dark, z's drifting out.

const DEN = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '.........dddddd.........',
  '.......ddDDDDDDdd.......',
  '.....ddDDDDDDDDDDdd.....',
  '....dDDDDDhhhhDDDDDd....',
  '...dDDDDDhhhhhhDDDDDd...',
  '...dDDDDhhhhhhhhDDDDd...',
  '..dDDDDhhhhhhhhhhDDDDd..',
  '..dDDDDhhhhhhhhhhDDDDd..',
  '.dDDDDDhhhhhhhhhhDDDDDd.',
  '.dDDDDDhhhhhhhhhhDDDDDd.',
  'gdDDDDDhhhhhhhhhhDDDDDdg',
  'GgDDDDDhhhhhhhhhhDDDDgGG',
  'GGgggggggggggggggggggGGG',
  'GGGGGGGGGGGGGGGGGGGGGGGG',
  '........................',
]

/** A sleeping burrow for the empty state, as a complete SVG document. */
export function emptyDenSvg(sizePx: number): string {
  const size = Math.max(8, Math.round(Number.isFinite(sizePx) ? sizePx : 96))
  const id = `ad${fnv1a(`den|${size}`)}`
  const mound = pixels(DEN, { d: '#5e4f4a', D: '#7a675c', h: '#1a1420', g: '#5fae75', G: '#86efac' })
  const pebbles = `<g fill="#9c8479"><rect x="5" y="15" width="1" height="1"/><rect x="18" y="13" width="1" height="1"/><rect x="19" y="17" width="1" height="1"/></g>`
  const tufts = pixels(['.G.....', 'G.G....'], { G: '#86efac' }, 2, 17) + pixels(['....G.', '...G.G'], { G: '#86efac' }, 17, 17)
  const eyes = `<g fill="#dfe7ef" opacity="0.7"><rect x="10" y="17" width="2" height="1"/><rect x="13" y="17" width="2" height="1"/></g>`
  const z = (ox: number, oy: number, color: string, begin: string) =>
    `<g opacity="0">` +
    `<animate attributeName="opacity" values="0;0.85;0.85;0" keyTimes="0;0.2;0.6;1" dur="3.2s" begin="${begin}" ${LOOP}/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;3 -6" dur="3.2s" begin="${begin}" ${LOOP}/>` +
    pixels(['ZZZ', '.Z.', 'ZZZ'], { Z: color }, ox, oy) +
    `</g>`
  const blink = `<g>${loopA('opacity', '0.7;0.25;0.7', '4s')}${eyes}</g>`
  return `<svg ${XMLNS} viewBox="0 0 24 24" width="${size}" height="${size}" ${CRISP}><title>The den is empty: no buddies out yet</title><g class="${id}">${mound}${pebbles}${tufts}${blink}${z(13, 9, LAVENDER, '0s')}${z(10, 10, FROST, '1.6s')}</g></svg>`
}

// ---------------------------------------------------------------------------------------------------------------
// Terminal art: 3 rows (hat, face, arms and feet), each exactly ASCII_W cells. Every glyph is one cell wide in
// every terminal: printable ASCII, ｡ ◕ ‿ ᵔ ᶻ and the braille block. Never emoji or East Asian ambiguous-width
// marks (• ⌒ ˘ ° ✓ ✗ ●), which some terminals draw two cells wide and shear the sprite.

const SAFE_EXTRA = new Set(['｡', '◕', '‿', 'ᵔ', 'ᶻ'])

/** The glyph rule of the terminal sprites: printable ASCII, ｡ ◕ ‿ ᵔ ᶻ and braille U+2800–U+28FF. */
export function isSafeGlyphs(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x20 && cp <= 0x7e) continue
    if (cp >= 0x2800 && cp <= 0x28ff) continue
    if (SAFE_EXTRA.has(ch)) continue
    return false
  }
  return true
}

/** Places `text` at cell `left` of a blank row of `ASCII_W` cells (cut at the right edge). */
function place(row: string, text: string, left: number): string {
  const cells = [...row.padEnd(ASCII_W)].slice(0, ASCII_W)
  while (cells.length < ASCII_W) cells.push(' ')
  ;[...text].forEach((ch, i) => {
    const x = left + i
    if (x >= 0 && x < ASCII_W && ch !== ' ') cells[x] = ch
  })
  return cells.join('')
}

const BLANK = ' '.repeat(ASCII_W)
const FACE_X = 3 // the 7-cell face sits in cells 3–9
const MID = 6 // the centre cell of the face

/** A part centred over the face, shifted by `dx` cells. */
const centred = (text: string, dx = 0): string => place(BLANK, text, MID - Math.floor(([...text].length - 1) / 2) + dx)

/** Three rows, each one exactly ASCII_W cells. */
const sprite = (r0: string, r1: string, r2: string): string[] => [r0, r1, r2].map(r => place(r, '', 0))

/** The buddy's terminal sprite: exactly 3 rows of ASCII_W cells. `frame` comes from tracker's asciiFrameFor. */
export function buddyAscii(b: ResolvedBuddy, status: DenStatus, frame: number, _animations: Animations): string[] {
  const f = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0
  const hat = [...(b.ascii.hat ?? '')].slice(0, 9).join('')
  const [armL, armR] = b.ascii.arms ?? ['o', 'o']
  const feet = (l: string, r: string, mid = '(_ _)') => centred(`${l}${mid}${r}`)
  const faceRow = (face: string) => place(BLANK, face, FACE_X)
  switch (status) {
    case 'running': {
      const n = f % 4
      const up = n === 1 || n === 3
      const dx = n === 1 ? 1 : n === 3 ? -1 : 0
      return sprite(centred(hat, dx), faceRow('(｡◕‿◕｡)'), up ? feet('\\', '/') : feet(armL, armR))
    }
    case 'waiting': {
      const n = f % 4
      const faces = ['( ◕_◕ )', '(◕_◕  )', '( ◕_◕ )', '(  ◕_◕)']
      const hatRow = n === 1 || n === 2 ? place(centred(hat), '?', 11) : centred(hat)
      return sprite(hatRow, faceRow(faces[n] ?? '( ◕_◕ )'), feet(armL, armR, n % 2 === 1 ? '(_ -)' : '(_ _)'))
    }
    case 'idle': {
      const n = f % 4
      const z0 = ['', '', 'ᶻ', 'ᶻz'][n] ?? ''
      const z1 = ['z', 'zᶻ', 'z', ''][n] ?? ''
      return sprite(place(centred(hat), z0, 11), place(faceRow('(｡-‿-｡)'), z1, 11), feet(armL, armR))
    }
    case 'completed': {
      const n = Math.min(f, 3)
      const face = '(｡ᵔ‿ᵔ｡)'
      if (n === 0) return sprite(centred(hat), faceRow(face), feet(armL, armR, '(___)'))
      if (n === 1) return sprite(place(faceRow(face), '*', 1), feet('\\', '/'), place(BLANK, '*', 11))
      if (n === 2) return sprite(place(centred(hat), '*', 11), faceRow(face), feet('\\', '/'))
      return sprite(centred(hat), faceRow(face), feet(armL, armR))
    }
    case 'failed': {
      const n = f % 2
      const r1 = faceRow('(｡x_x｡)')
      const r2 = feet(armL, armR)
      return sprite(centred(hat), n === 0 ? place(r1, ',', 10) : r1, n === 1 ? place(r2, ',', 10) : r2)
    }
    case 'killed': {
      const n = f % 2
      return sprite(centred('.---.'), faceRow('( o o )'), centred(n === 0 ? '\\/\\/\\/\\' : '/\\/\\/\\/'))
    }
    case 'pending': {
      const dx = f % 2 === 0 ? 0 : 1
      return sprite(centred('.-^-^-.', dx), place(BLANK, '( -.- )', FACE_X + dx), centred("'-----'", dx))
    }
  }
}

/** The empty den in the terminal: a small burrow, 3 rows of ASCII_W cells. */
export const EMPTY_DEN_ASCII: readonly string[] = ['   .-~~~-.   ', '  /  ᶻz   \\  ', ".-'-------'-."]
