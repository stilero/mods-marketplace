// model-advisor art: Cog, a little robot with a screen on its belly, in five moods, plus ASCII frames.
//
// Same rules as cache-thermo's and prompt-coach's art: dependency-free, every SVG string a complete document, pixel
// art as `<rect>` runs on an integer grid with crisp edges, animation in SMIL only (no scripts, no event attributes,
// no external references). The desktop and VS Code draw these through `Svg`; the terminal draws the ASCII frames.
// The look is pastel and calm: soft steel blue, sky-blue eyes on a dark visor, gentle motion.
// The belly screen says the advice: a mint arrow down (a lower setup is enough), a lavender arrow up (the work
// needs more), a mint check (the setup fits).

export type Mood = 'idle' | 'reading' | 'down' | 'up' | 'fit'

type Pal = Readonly<Record<string, string>>

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"'
const CRISP = 'shape-rendering="crispEdges"'

const MINT = '#6ee7b7'
const LAVENDER = '#c4b5fd'
const HONEY = '#fcd34d'
const STEEL = '#7f9fc9'

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
// Cog — a 16×16 robot. D outline, B steel-blue shell, b its shade, S the dark visor and belly screen, Y brass
// bolts. The antenna tip (row 0), the face (rows 4–7, columns 4–11) and the belly glyph (rows 10–12, columns 5–10)
// are drawn per mood on top of this body.

const COG = [
  '................',
  '.......DD.......',
  '..DDDDDDDDDDDD..',
  '..DBBBBBBBBBBD..',
  '.YDBSSSSSSSSBDY.',
  '.YDBSSSSSSSSBDY.',
  '..DBSSSSSSSSBD..',
  '..DBSSSSSSSSBD..',
  '..DBBBBBBBBBBD..',
  '...DDDDDDDDDD...',
  '.DDDBSSSSSSBDDD.',
  '.DbDBSSSSSSBDbD.',
  '.DDDBSSSSSSBDDD.',
  '...DBBBBBBBBD...',
  '...DDDDDDDDDD...',
  '....DD....DD....',
]

const COG_PAL: Pal = {
  D: '#3d4a6b',
  B: '#a9c4e4',
  b: STEEL,
  S: '#1b2438',
  Y: HONEY,
  // The face: E glowing eyes, M the mouth, P rosy cheeks.
  E: '#7dd3fc',
  M: '#5b8fb8',
  P: '#fda4af',
}

/** Faces: four rows of the visor, eight columns wide. */
const FACE: Record<'open' | 'shut' | 'left' | 'right' | 'up' | 'down' | 'smile', string[]> = {
  open: ['........', '.EE..EE.', '.EE..EE.', 'P..MM..P'],
  shut: ['........', '........', '.EE..EE.', 'P..MM..P'],
  left: ['........', 'EE..EE..', 'EE..EE..', 'P..MM..P'],
  right: ['........', '..EE..EE', '..EE..EE', 'P..MM..P'],
  up: ['.EE..EE.', '.EE..EE.', '........', 'P..MM..P'],
  down: ['........', '........', '.EE..EE.', '.EE..EE.'],
  smile: ['........', '.E....E.', 'E.E..E.E', 'P..MM..P'],
}

/** Belly glyphs: three rows of the belly screen, six columns wide, drawn in one colour (X). */
const GLYPH: Record<'dash' | 'down' | 'up' | 'check', string[]> = {
  dash: ['......', '.XXXX.', '......'],
  down: ['XXXXXX', '.XXXX.', '..XX..'],
  up: ['..XX..', '.XXXX.', 'XXXXXX'],
  check: ['.....X', '.X..X.', '..XX..'],
}

const face = (kind: keyof typeof FACE): string => pixels(FACE[kind], COG_PAL, 4, 4)
const glyph = (kind: keyof typeof GLYPH, color: string): string => pixels(GLYPH[kind], { X: color }, 5, 10)

/** The antenna's tip, two pixels; `blinkDur` makes it blink. */
function tip(color: string, blinkDur?: string): string {
  const blink =
    blinkDur === undefined
      ? ''
      : `<animate attributeName="opacity" values="1;0.25" keyTimes="0;0.5" calcMode="discrete" dur="${blinkDur}" repeatCount="indefinite"/>`
  return `<rect x="7" y="0" width="2" height="1" fill="${color}">${blink}</rect>`
}

/** A gentle 1 px bob, slower when calm. The viewBox keeps a pixel of air around Cog for it. */
const bob = (dur: string): string =>
  `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 1;0 1" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>`

/** A little hop: up a pixel and back. */
const hop = (dur: string): string =>
  `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0;0 0" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>`

/** A slow pulse, for the arrow on the belly. */
const pulse = (inner: string, dur: string): string =>
  `<g>${inner}<animate attributeName="opacity" values="1;0.35;1" dur="${dur}" repeatCount="indefinite"/></g>`

/** An occasional blink over open eyes. */
function blinking(dur: string): string {
  const visor = pixels(['SSSSSSSS', 'SSSSSSSS', 'SSSSSSSS'], COG_PAL, 4, 4)
  const shut = `<g opacity="0"><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.9;0.9;0.96;1" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>${visor}${face('shut')}</g>`
  return face('open') + shut
}

/** A pixel that twinkles at (x, y). */
const twinkle = (x: number, y: number, color: string, dur: string, begin: string): string =>
  `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="${dur}" begin="${begin}" repeatCount="indefinite"/></rect>`

function cog(mood: Mood): string {
  const body = pixels(COG, COG_PAL)
  switch (mood) {
    case 'reading':
      // Eyes run along the prompt, the belly weighs up against down, the antenna blinks: a quick nod.
      return (
        `<g>${bob('0.9s')}${body}${tip(HONEY, '0.6s')}${flicker(face('left'), face('right'), '1.1s')}` +
        `${flicker(glyph('up', HONEY), glyph('down', HONEY), '0.8s')}</g>`
      )
    case 'down':
      // Looking down at the mint arrow on its belly: a lower setup is enough. Two mint coins twinkle.
      return (
        `<g>${bob('1.6s')}${body}${tip(MINT)}${face('down')}${pulse(glyph('down', MINT), '1.4s')}</g>` +
        twinkle(0, 8, MINT, '1.8s', '0s') +
        twinkle(15, 12, MINT, '1.8s', '0.9s')
      )
    case 'up':
      // Looking up, a little hop, the antenna blinking: the work needs more.
      return (
        `<g>${hop('1.2s')}${body}${tip(LAVENDER, '0.6s')}${face('up')}${pulse(glyph('up', LAVENDER), '1.2s')}</g>` +
        twinkle(0, 2, LAVENDER, '1.6s', '0.2s') +
        twinkle(15, 0, LAVENDER, '1.6s', '1s')
      )
    case 'fit':
      // Smiling eyes, a check on the belly and a couple of sparkles.
      return (
        `<g>${bob('1.6s')}${body}${tip(MINT)}${face('smile')}${glyph('check', MINT)}</g>` +
        twinkle(0, 2, MINT, '1.8s', '0s') +
        twinkle(15, 6, MINT, '1.8s', '0.9s') +
        twinkle(13, 0, HONEY, '2.2s', '0.5s')
      )
    default:
      return `<g>${bob('2.4s')}${body}${tip(STEEL)}${blinking('3.6s')}${glyph('dash', STEEL)}</g>`
  }
}

const COG_TITLE: Record<Mood, string> = {
  idle: 'Cog the robot, waiting for your next prompt',
  reading: 'Cog the robot, weighing your prompt',
  down: 'Cog the robot, pointing down: a lower model or effort is enough',
  up: 'Cog the robot, pointing up: the work needs a higher model or effort',
  fit: 'Cog the robot, happy: the model and effort fit the work',
}

export function cogSvg(mood: Mood, sizePx = 44): string {
  const s = Math.max(8, Math.round(sizePx))
  // One pixel of air on every side, so the bob and the hop are not cut at the edge.
  return `<svg ${XMLNS} viewBox="-1 -1 18 18" width="${s}" height="${s}" ${CRISP}><title>${COG_TITLE[mood]}</title>${cog(mood)}</svg>`
}

// ---------------------------------------------------------------------------------------------------------------
// Terminal art: 3 rows, two frames per mood. Every glyph is ASCII, one cell wide in every terminal.

const pad = (rows: string[]): string[] => {
  const w = Math.max(...rows.map(r => r.length))
  return rows.map(r => r.padEnd(w))
}

export const COG_ASCII: Record<Mood, [string[], string[]]> = {
  idle: [pad(['  _i_', ' [o o]', ' /[=]\\']), pad(['  _i_', ' [- -]', ' /[=]\\'])],
  reading: [pad(['  _*_', ' [< <]', ' /[^]\\']), pad(['  _i_', ' [> >]', ' /[v]\\'])],
  down: [pad(['  _i_', ' [o o]', ' /[v]\\']), pad(['  _i_', ' [. .]', ' /[V]\\'])],
  up: [pad(['  _i_', ' [o o]', ' /[^]\\']), pad(['  _*_', " [' ']", ' /[A]\\'])],
  fit: [pad(['  _i_', ' [^ ^]', ' /[+]\\']), pad(['  _i_ *', ' [^ ^]', ' /[+]\\'])],
}

/** One column for every mood and frame, one cell of air included, so the text beside Cog does not jump. */
export const COG_W =
  Math.max(
    ...Object.values(COG_ASCII)
      .flat(2)
      .map(r => r.length),
  ) + 1
