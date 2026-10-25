// prompt-coach art: Quill, a little owl with reading glasses, in four moods, plus ASCII frames.
//
// Same rules as cache-thermo's art: dependency-free, every SVG string a complete document, pixel art as `<rect>`
// runs on an integer grid with crisp edges, animation in SMIL only (no scripts, no event attributes, no external
// references). The desktop draws these through `Svg`; the terminal draws the ASCII frames.
// The look is pastel and calm: soft colours, a chubby round body, big eyes behind round glasses, gentle motion.

export type Mood = 'idle' | 'reading' | 'happy' | 'hmm'

type Pal = Readonly<Record<string, string>>

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"'
const CRISP = 'shape-rendering="crispEdges"'

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

// ---------------------------------------------------------------------------------------------------------------
// Quill — a 16×16 owl. D brown outline, B caramel feathers, L cream belly, l belly speckles, G glasses rims,
// W eye whites, K pupils, Y beak and feet, P rosy cheeks. Rows 6–8 are the eyes; moods swap only those rows.

const QUILL = [
  '...D........D...',
  '...DD......DD...',
  '...DBD....DBD...',
  '..DBBBDDDDBBBD..',
  '.DBBBBBBBBBBBBD.',
  '.DBGGGGBBGGGGBD.',
  '.DGWWWWGGWWWWGD.',
  '.DGWKKWGGWKKWGD.',
  '.DGWKKWGGWKKWGD.',
  '.DBGGGGYYGGGGBD.',
  '.DBPBBBYYBBBPBD.',
  '.DBBLLLLLLLLBBD.',
  '..DBLLlLLlLLBD..',
  '..DBBLLLLLLBBD..',
  '...DDBBBBBBDD...',
  '....YY....YY....',
]

const EYES: Record<'open' | 'shut' | 'left' | 'right' | 'smile' | 'up', string[]> = {
  open: ['.DGWWWWGGWWWWGD.', '.DGWKKWGGWKKWGD.', '.DGWKKWGGWKKWGD.'],
  shut: ['.DGWWWWGGWWWWGD.', '.DGKKKKGGKKKKGD.', '.DGWWWWGGWWWWGD.'],
  left: ['.DGWWWWGGWWWWGD.', '.DGKKWWGGKKWWGD.', '.DGKKWWGGKKWWGD.'],
  right: ['.DGWWWWGGWWWWGD.', '.DGWWKKGGWWKKGD.', '.DGWWKKGGWWKKGD.'],
  smile: ['.DGWWWWGGWWWWGD.', '.DGWKKWGGWKKWGD.', '.DGKWWKGGKWWKGD.'],
  up: ['.DGWKKWGGWKKWGD.', '.DGWKKWGGWKKWGD.', '.DGWWWWGGWWWWGD.'],
}

const QUILL_PAL: Pal = {
  D: '#7a5a44',
  B: '#e8c39e',
  L: '#fbeedd',
  l: '#e9cfae',
  G: '#5b6b8c',
  W: '#ffffff',
  K: '#2e3446',
  Y: '#fcd34d',
  P: '#fda4af',
}

const eyes = (kind: keyof typeof EYES, ox: number, oy: number): string => pixels(EYES[kind], QUILL_PAL, ox, oy + 6)

/** The body without the eye rows, so a mood can draw its own. */
const BODY = QUILL.map((row, y) => (y >= 6 && y <= 8 ? '.'.repeat(16) : row))

/** A gentle 1 px bob, slower when calm. */
const bob = (dur: string): string =>
  `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 1;0 1" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>`

/** An occasional blink over open eyes. */
function blinking(ox: number, oy: number, dur: string): string {
  const shut = `<g opacity="0"><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.9;0.9;0.96;1" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>${eyes('shut', ox, oy)}</g>`
  return eyes('open', ox, oy) + shut
}

/** A pixel that twinkles at (x, y). */
const twinkle = (x: number, y: number, color: string, dur: string, begin: string): string =>
  `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="${dur}" begin="${begin}" repeatCount="indefinite"/></rect>`

function quill(mood: Mood, ox: number, oy: number): string {
  const body = pixels(BODY, QUILL_PAL, ox, oy)
  switch (mood) {
    case 'reading':
      // Eyes run along the lines left and right, a quicker bob, as if nodding through the text.
      return `<g>${bob('0.9s')}${body}${flicker(eyes('left', ox, oy), eyes('right', ox, oy), '1.1s')}</g>`
    case 'happy':
      // Smiling eyes and a couple of mint sparkles.
      return (
        `<g>${bob('1.6s')}${body}${eyes('smile', ox, oy)}</g>` +
        twinkle(ox + 0, oy + 2, '#6ee7b7', '1.8s', '0s') +
        twinkle(ox + 15, oy + 5, '#6ee7b7', '1.8s', '0.9s') +
        twinkle(ox + 14, oy + 0, '#fcd34d', '2.2s', '0.5s')
      )
    case 'hmm':
      // Looking up over the glasses, a slow thoughtful tilt, and a honey glint on the rims.
      return (
        `<g><animateTransform attributeName="transform" type="translate" values="0 0;1 0;1 0;0 0" calcMode="discrete" dur="2.4s" repeatCount="indefinite"/>${body}${eyes('up', ox, oy)}</g>` +
        twinkle(ox + 4, oy + 5, '#fcd34d', '2.4s', '0.3s')
      )
    default:
      return `<g>${bob('2.4s')}${body}${blinking(ox, oy, '3.6s')}</g>`
  }
}

const QUILL_TITLE: Record<Mood, string> = {
  idle: 'Quill the owl, waiting to read your next prompt',
  reading: 'Quill the owl, reading your prompt',
  happy: 'Quill the owl, happy: the brief covers what applies',
  hmm: 'Quill the owl, thinking: the brief leaves something out',
}

export function quillSvg(mood: Mood, sizePx = 48): string {
  const s = Math.max(8, Math.round(sizePx))
  return `<svg ${XMLNS} viewBox="0 0 16 16" width="${s}" height="${s}" ${CRISP}><title>${QUILL_TITLE[mood]}</title>${quill(mood, 0, 0)}</svg>`
}

// ---------------------------------------------------------------------------------------------------------------
// Terminal art: 3 rows. Every glyph is one cell wide in every terminal: ASCII plus ◕ ᵔ, never emoji or East Asian
// ambiguous-width marks, which some terminals draw two cells wide and shear the sprite.

const pad = (rows: string[]): string[] => {
  const w = Math.max(...rows.map(r => r.length))
  return rows.map(r => r.padEnd(w))
}

export const QUILL_ASCII: Record<Mood, string[]> = {
  idle: pad([' ,___,', ' (◕,◕)', ' /)_)']),
  reading: pad([' ,___,', ' (◕,◕) ..', ' /)_)']),
  happy: pad([' ,___,  *', ' (ᵔ,ᵔ)', ' /)_)']),
  hmm: pad([' ,___,  ?', ' (◕,◕)', ' /)_)']),
}

/** One column for every mood, one cell of air included, so the text beside Quill does not jump. */
export const QUILL_W = Math.max(...Object.values(QUILL_ASCII).flat().map(r => r.length)) + 1
