// agent-den buddies: the roster of ten pixel mascots, the recoloured variants, and the buddy picker.
//
// Pure data and pure functions, no value imports, so the preview builder can load this file on its own.
// A body is 16 rows × 16 chars: '.' is transparent, 'E' marks the two 3×3 eye boxes, 'M' the 4×2 mouth box,
// 'A' a light that blinks while the buddy runs, and every other letter is a palette colour. art.ts paints the
// eye and mouth boxes with the skin around them and draws the mood faces on top, so one body serves every status.
// Write each import on one line and use only `export const` / `export function` (the preview strips the types).

import type { BuddyRef } from '../types'

export type Buddy = {
  /** Roster key, e.g. 'digby'. */
  key: string
  /** Display name, e.g. 'Digby'. */
  name: string
  /** Short species for titles and alt text, e.g. 'mole'. */
  species: string
  /** 16 rows × 16 chars; see the file header for the letters. */
  body: string[]
  /** Letter → '#rrggbb'. `K` (face ink) and `W` (eye glint) are optional overrides. */
  palette: Record<string, string>
  /** Card border and name colour (pastel on the #0f1420 panel). */
  accent: string
  /** Optional 16×16 accessory layer, drawn over the face with the same palette rules. */
  prop?: string[]
  /** Terminal sprite parts: a hat row of at most 9 one-cell glyphs, and the two arm glyphs. */
  ascii: { hat: string; arms?: [string, string] }
  /** Agent types this buddy is the default for (lowercase). */
  types?: string[]
  /** `types` match as substrings of the agent type, not as whole names. */
  matchSubstring?: true
}

export type ResolvedBuddy = Buddy & { displayName: string; variant: number }

// ---------------------------------------------------------------------------------------------------------------
// The roster, in pick order. Shared letters: O outline, B body, L light, P cheeks, D shade, A light that blinks.

export const ROSTER: readonly Buddy[] = [
  {
    key: 'digby',
    name: 'Digby',
    species: 'mole',
    body: [
      '................',
      '................',
      '................',
      '.....OOOOOO.....',
      '...OOBBBBBBOO...',
      '..OBBBBBBBBBBO..',
      '.OBBEEEBBEEEBBO.',
      '.OBBEEEBBEEEBBO.',
      'OBBBEEEBBEEEBBBO',
      'OBPPBBBNNBBBPPBO',
      'OBBBBBMMMMBBBBBO',
      'OBBBBBMMMMBBBBBO',
      'OBBBBBBBBBBBBBBO',
      '.OBBBLLLLLLBBBO.',
      '..OBBLLLLLLBBO..',
      '..OHHOOOOOOHHO..',
    ],
    prop: [
      '.......AA.......',
      '.....YYAAYY.....',
      '....YYYYYYYY....',
      '...YYYYYYYYYY...',
      '..yyyyyyyyyyyy..',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    palette: {
      O: '#5e4f4a',
      B: '#9c8479',
      L: '#c9b4a6',
      N: '#f4a3b4',
      H: '#f6b8c4',
      P: '#f6a6b8',
      Y: '#fcd34d',
      y: '#d9a93a',
      A: '#fff6c2',
    },
    accent: '#fcd34d',
    ascii: { hat: '_/=o=\\_' },
    types: ['explore'],
  },
  {
    key: 'bricks',
    name: 'Bricks',
    species: 'beaver',
    body: [
      '................',
      '................',
      '...OO......OO...',
      '..OIBOOOOOOBIO..',
      '..OBBBBBBBBBBO..',
      '.OBBBBBBBBBBBBO.',
      '.OBBEEEBBEEEBBO.',
      '.OBBEEEBBEEEBBO.',
      '.OBBEEEBBEEEBBO.',
      '.OBPPLLLLLLPPBO.',
      '.OBBLLMMMMLLBBO.',
      '.OBBLLMMMMLLBBO.',
      '.OBBBLLTTLLBBBOD',
      '..OBBBBTTBBBBODD',
      '...OOBBBBBBOODDd',
      '....OOO..OOODDd.',
    ],
    prop: [
      '................',
      '................',
      '................',
      '................',
      'RR..............',
      'RR..............',
      'SS..............',
      'YY..............',
      'Yy..............',
      'Yy..............',
      'Yy..............',
      'tt..............',
      'tt..............',
      'k...............',
      '................',
      '................',
    ],
    palette: {
      O: '#6e4b33',
      B: '#c08a5b',
      L: '#ecc9a0',
      I: '#e8a98a',
      P: '#f6a6b8',
      T: '#fffaf0',
      D: '#5a3d2a',
      d: '#7a5440',
      R: '#f6a6b8',
      S: '#cbd5e1',
      Y: '#fcd34d',
      y: '#e0a93a',
      t: '#f3d9b1',
      k: '#4b4f5c',
    },
    accent: '#ffb27a',
    ascii: { hat: 'n     n', arms: ['o', '/'] },
    types: ['plan'],
  },
  {
    key: 'bolt',
    name: 'Bolt',
    species: 'robot',
    body: [
      '.......AA.......',
      '.......AA.......',
      '.......RR.......',
      '...OOOOOOOOOO...',
      '..OLLLBBBBBBBO..',
      '.OLRBBBBBBBBRBO.',
      '.OBSSSSSSSSSSBO.',
      'ROBSEEESSEEESBOR',
      'ROBSEEESSEEESBOR',
      'ROBSEEESSEEESBOR',
      '.OBPSSSSSSSSPBO.',
      '.OBSSSMMMMSSSBO.',
      '.OBSSSMMMMSSSBO.',
      '.OBSSSSSSSSSSBO.',
      '.OBBBBBBBBBBBBO.',
      '..ORRO....ORRO..',
    ],
    palette: {
      O: '#4d5b73',
      B: '#aebfd6',
      L: '#dbe6f4',
      S: '#1f2a3d',
      R: '#7d8aa3',
      A: '#fcd34d',
      P: '#f9a8d4',
      // The face is a dark screen, so the face ink is a light mint.
      K: '#6ee7b7',
      W: '#d1fae5',
    },
    accent: '#93c5fd',
    ascii: { hat: '-=[o]=-', arms: ['[', ']'] },
    types: ['general-purpose', 'claude'],
  },
  {
    key: 'pip',
    name: 'Pip',
    species: 'bookworm',
    body: [
      '................',
      '...O........O...',
      '....O......O....',
      '....OOOOOOOO....',
      '..OOBBBBBBBBOO..',
      '.OBBBBBBBBBBBBO.',
      '.OBBEEEBBEEEBBO.',
      '.OBBEEEBBEEEBBO.',
      '.OBBEEEBBEEEBBO.',
      '.OBBBBBBBBBBBBO.',
      '.OPPBBMMMMBBPPO.',
      '..OBBBMMMMBBBO..',
      '...OOBBBBBBOO...',
      '.OOBBDBBDBBDBOO.',
      'OBBLLDLLDLLDLBBO',
      '.OOOOOOOOOOOOOO.',
    ],
    prop: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '...GGGGGGGGGG...',
      '...G...GG...G...',
      '..GG...GG...GG..',
      '...G...GG...G...',
      '...GGGGGGGGGG...',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    palette: {
      O: '#3d7a4e',
      B: '#9ee6ad',
      L: '#d4f7da',
      D: '#74c98a',
      P: '#f6a6b8',
      G: '#6b5b8a',
    },
    accent: '#86efac',
    ascii: { hat: '(o)-(o)' },
    types: ['claude-code-guide'],
  },
  {
    key: 'bristle',
    name: 'Bristle',
    species: 'hedgehog',
    body: [
      '...T..T..T..T...',
      '..TS.TS..ST.ST..',
      '.TSSSSSSSSSSSST.',
      '.SSSSSSSSSSSSSS.',
      'TSSSFFFFFFFFSSST',
      '.SSFFFFFFFFFFSS.',
      'TSFFEEEFFEEEFFST',
      '.SFFEEEFFEEEFFS.',
      'TSFFEEEFFEEEFFST',
      '.SFPPFFNNFFPPFS.',
      'TSFFFFMMMMFFFFST',
      '.SSFFFMMMMFFFSS.',
      '.TSSFFFFFFFFSST.',
      '..SSSSSSSSSSSS..',
      '...OSSSSSSSSO...',
      '...HHO....OHH...',
    ],
    palette: {
      O: '#3f3550',
      S: '#7d6b94',
      T: '#a996c4',
      F: '#f6e7d4',
      N: '#3b3040',
      P: '#f6a6b8',
      H: '#e9cfb4',
    },
    accent: '#c4b5fd',
    ascii: { hat: '/\\/\\/\\/\\' },
    types: ['review', 'security', 'audit'],
    // A reviewer has many names (security-review, code-reviewer, audit-bot): match any type that holds one.
    matchSubstring: true,
  },
  {
    key: 'mochi',
    name: 'Mochi',
    species: 'slime',
    body: [
      '................',
      '................',
      '................',
      '......OOOO......',
      '....OOBBBBOO....',
      '...OBLLBBBBBO...',
      '..OBLLBBBBBBBO..',
      '.OBBEEEBBEEEBBO.',
      '.OBBEEEBBEEEBBO.',
      'OBBBEEEBBEEEBBBO',
      'OBPPBBBBBBBBPPBO',
      'OBBBBBMMMMBBBBBO',
      'OBBBBBMMMMBBBBBO',
      'OBBBBBBBBBBBBBBO',
      'ODBBBDDBBDDBBBDO',
      '.OOOOOOOOOOOOOO.',
    ],
    palette: {
      O: '#d77aa5',
      B: '#fcd5e5',
      L: '#fff4f9',
      D: '#f3a9c9',
      P: '#f69bb8',
    },
    accent: '#f9a8d4',
    ascii: { hat: '.-~~~-.' },
    types: ['workflow'],
  },
  {
    key: 'nib',
    name: 'Nib',
    species: 'fox kit',
    body: [
      '.O............O.',
      '.OO..........OO.',
      '.OIO........OIO.',
      '.OIBO......OBIO.',
      '.OBBBOOOOOOBBBO.',
      '.OBBBBBBBBBBBBO.',
      'OBBBBBBBBBBBBBBO',
      'OBBBEEEBBEEEBBBO',
      'OBBBEEEBBEEEBBBO',
      'OBBBEEEBBEEEBBBO',
      'OLLLBBBNNBBBLLLO',
      '.OLLLLMMMMLLLLO.',
      '..OLLLMMMMLLLO..',
      '...OOLLLLLLOO...',
      '....OBBBBBBO....',
      '....OO....OO....',
    ],
    prop: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '..............O.',
      '.............OLO',
      '.............OBO',
      '............OBBO',
      '...........OBBO.',
      '...........OOO..',
    ],
    palette: {
      O: '#a4502f',
      B: '#ffa56b',
      L: '#fff4ea',
      I: '#ffc9d6',
      N: '#3b2a2a',
      P: '#ff9aa8',
    },
    accent: '#fca5a5',
    ascii: { hat: '/\\   /\\', arms: ['o', '~'] },
  },
  {
    key: 'moss',
    name: 'Moss',
    species: 'frog',
    body: [
      '................',
      '.OOOOO....OOOOO.',
      'OBBBBBO..OBBBBBO',
      'OBEEEBOOOOBEEEBO',
      'OBEEEBBBBBBEEEBO',
      'OBEEEBBBBBBEEEBO',
      'OBBBBBBBBBBBBBBO',
      'OBPPBBBBBBBBPPBO',
      'OBBBBBMMMMBBBBBO',
      'OBBBBBMMMMBBBBBO',
      '.OBBBBBBBBBBBBO.',
      '.OBBLLLLLLLLBBO.',
      '..OBLLLLLLLLBO..',
      '..OBBLLLLLLBBO..',
      '.OOBBOOOOOOBBOO.',
      'OBBBO......OBBBO',
    ],
    palette: {
      O: '#3d6b2c',
      B: '#a6d96a',
      L: '#e6f7c9',
      P: '#f6a6b8',
    },
    accent: '#bef264',
    ascii: { hat: '.o.   .o.', arms: ['v', 'v'] },
  },
  {
    key: 'puff',
    name: 'Puff',
    species: 'cloud',
    body: [
      '................',
      '................',
      '......OOOO......',
      '..OOOOBBBBOOOO..',
      '.OBBBOBBBBOBBBO.',
      '.OBBBBBBBBBBBBO.',
      'OBBBBBBBBBBBBBBO',
      'OBBBEEEBBEEEBBBO',
      'OBBBEEEBBEEEBBBO',
      'OBBBEEEBBEEEBBBO',
      'OBPPBBBBBBBBPPBO',
      'OBBBBBMMMMBBBBBO',
      'OBBBBBMMMMBBBBBO',
      'ODDBBBBBBBBBBDDO',
      '.ODDDDDDDDDDDDO.',
      '..OOOOOOOOOOOO..',
    ],
    palette: {
      O: '#7ea6d1',
      B: '#f0f7ff',
      D: '#cfe2f7',
      P: '#fbb1c4',
    },
    accent: '#bae6fd',
    ascii: { hat: '.-(~~)-.' },
  },
  {
    key: 'tansy',
    name: 'Tansy',
    species: 'bunny',
    body: [
      '...OOO....OOO...',
      '..OBIBO..OBIBO..',
      '..OBIBO..OBIBO..',
      '..OBIBO..OBIBO..',
      '..OBIBO..OBIBO..',
      '..OBBBOOOOBBBO..',
      '.OBBBBBBBBBBBBO.',
      'OBBBBBBBBBBBBBBO',
      'OBBBEEEBBEEEBBBO',
      'OBBBEEEBBEEEBBBO',
      'OBBBEEEBBEEEBBBO',
      'OBPPBBBBBBBBPPBO',
      'OBBBBBMMMMBBBBBO',
      '.OBBBBMMMMBBBBO.',
      '..OOBBBBBBBBOO..',
      '...OOO....OOO...',
    ],
    palette: {
      O: '#9b84bd',
      B: '#f5efff',
      I: '#fbcfe8',
      P: '#f9a8c8',
    },
    accent: '#fbcfe8',
    ascii: { hat: '(\\ /)' },
  },
]

// ---------------------------------------------------------------------------------------------------------------
// Variants: past the roster, a buddy comes back with its hues turned and a numbered name.

const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/** 'Digby', 1 → 'Digby II'; 2 → 'Digby III'; up to 'Digby X' (variant 9), then 'Digby 11', 'Digby 12', … */
export function variantName(name: string, variant: number): string {
  const v = Number.isFinite(variant) ? Math.max(0, Math.floor(variant)) : 0
  if (v === 0) return name
  const roman = ROMAN[v]
  return `${name} ${roman ?? String(v + 1)}`
}

const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

/** Hue rotation of a #rrggbb colour; greys (saturation < 0.15) and malformed input stay as they are. */
export function rotateHue(hex: string, degrees: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (m === null || m[1] === undefined || !Number.isFinite(degrees)) return hex
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (s < 0.15) return hex
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (((h * 60 + degrees) % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const o = l - c / 2
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return `#${hex2((r1 + o) * 255)}${hex2((g1 + o) * 255)}${hex2((b1 + o) * 255)}`
}

/** A roster buddy ready to draw; variant > 0 turns every hue by variant × 47° and numbers the name. Never throws. */
export function resolveBuddy(ref: BuddyRef): ResolvedBuddy {
  const base = ROSTER.find(b => b.key === ref.key) ?? (ROSTER[0] as Buddy)
  const variant = Number.isFinite(ref.variant) ? Math.max(0, Math.floor(ref.variant)) : 0
  if (variant === 0) return { ...base, displayName: base.name, variant: 0 }
  const turn = (variant * 47) % 360
  const palette: Record<string, string> = {}
  for (const [letter, color] of Object.entries(base.palette)) palette[letter] = rotateHue(color, turn)
  return { ...base, palette, accent: rotateHue(base.accent, turn), displayName: variantName(base.name, variant), variant }
}

// ---------------------------------------------------------------------------------------------------------------
// Picking: by agent type first, then by roster order; two live agents never share a buddy.

/** The roster buddy whose default types name this (lowercased) agent type. */
function defaultFor(type: string): Buddy | undefined {
  return ROSTER.find(b => (b.types ?? []).some(t => (b.matchSubstring === true ? type.includes(t) : type === t)))
}

/** The buddy for a new agent. `taken` holds the buddies of live agents; `map` pins types to roster keys. Pure. */
export function pickBuddy(type: string, taken: readonly BuddyRef[], map: Readonly<Record<string, string>>): BuddyRef {
  const t = type.toLowerCase()
  const isRosterKey = (k: string | undefined): k is string => k !== undefined && ROSTER.some(b => b.key === k)
  const pinned = Object.prototype.hasOwnProperty.call(map, t) ? map[t] : undefined
  const own = isRosterKey(pinned) ? pinned : (defaultFor(t) ?? (ROSTER[0] as Buddy)).key
  const isFree = (key: string, variant: number) => !taken.some(r => r.key === key && r.variant === variant)
  if (isFree(own, 0)) return { key: own, variant: 0 }
  const next = ROSTER.find(b => isFree(b.key, 0))
  if (next !== undefined) return { key: next.key, variant: 0 }
  let n = 1
  while (!isFree(own, n)) n++
  return { key: own, variant: n }
}

/** "Explore=digby, my-agent=moss" → { explore: 'digby', 'my-agent': 'moss' }; splits on , ; and newlines. */
export function parseBuddyMap(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(text).split(/[,;\n\r]+/)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const type = part.slice(0, eq).trim().toLowerCase()
    const key = part.slice(eq + 1).trim().toLowerCase()
    if (type !== '' && key !== '') out[type] = key
  }
  return out
}
