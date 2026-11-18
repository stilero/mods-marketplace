// security-advisor art: the "YOU'VE BEEN PWNED!" screen as animated pixel art (SVG) and as ASCII frames.
//
// Same rules as the mods-marketplace art: dependency-free, every SVG string a complete document, pixel art as
// path runs on an integer grid with crisp edges, animation in SMIL only (no scripts, no event attributes,
// no external references). Desktop and VS Code draw the SVG through `Svg`; the terminal draws the ASCII frames.
// The look is a loud 16-bit title screen on purpose: dithered sky, outlined and shaded sprites, a chrome
// "YOU'VE BEEN" and a colour-cycling fire "PWNED!" with a drop shadow, cackling skulls, hazard tape.

type Pal = Readonly<Record<string, string>>

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"'
const CRISP = 'shape-rendering="crispEdges"'

export const RAINBOW = ['#ff2d55', '#ff9500', '#ffd60a', '#30d158', '#64d2ff', '#5e5ce6', '#bf5af2']

/** Pixel map → one path `d` per character, one subpath per horizontal run. '.' is transparent. */
function runs(rows: readonly string[], ox = 0, oy = 0, scale = 1): Record<string, string> {
  const out: Record<string, string> = {}
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row.charAt(x)
      let end = x + 1
      while (end < row.length && row.charAt(end) === ch) end++
      if (ch !== '.') {
        const w = (end - x) * scale
        out[ch] = (out[ch] ?? '') + `M${ox + x * scale} ${oy + y * scale}h${w}v${scale}h-${w}z`
      }
      x = end
    }
  })
  return out
}

/** Pixel map → one `<path fill>` per palette colour. Characters not in the palette are not drawn. */
function pixels(rows: readonly string[], pal: Pal, ox = 0, oy = 0, scale = 1): string {
  const byColor: Record<string, string> = {}
  for (const [ch, d] of Object.entries(runs(rows, ox, oy, scale))) {
    const color = pal[ch]
    if (color !== undefined) byColor[color] = (byColor[color] ?? '') + d
  }
  return Object.entries(byColor)
    .map(([color, d]) => `<path fill="${color}" d="${d}"/>`)
    .join('')
}

/** Two drawings shown alternately (a hard 2-frame swap, like a sprite sheet). */
function flicker(a: string, b: string, dur: string): string {
  const swap = (values: string) =>
    `<animate attributeName="opacity" values="${values}" keyTimes="0;0.5" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>`
  return `<g>${a}${swap('1;0')}</g><g>${b}${swap('0;1')}</g>`
}

// ---------------------------------------------------------------------------------------------------------------
// Sprite shading: the 16-bit look comes from these passes over a pixel map, not from hand-placed colours.

const at = (rows: readonly string[], x: number, y: number): string => rows[y]?.charAt(x) || '.'

const mapPixels = (rows: readonly string[], fn: (ch: string, x: number, y: number) => string): string[] =>
  rows.map((row, y) => [...row].map((ch, x) => fn(ch, x, y)).join(''))

function pad(rows: readonly string[], n = 1): string[] {
  const w = (rows[0]?.length ?? 0) + 2 * n
  const blank = '.'.repeat(w)
  const side = '.'.repeat(n)
  return [...Array<string>(n).fill(blank), ...rows.map(r => side + r + side), ...Array<string>(n).fill(blank)]
}

/**
 * Light from the top left: '#' pixels on a lower or right edge (or above a hole) turn 'd', on an upper or left
 * edge (or below a hole) 'h', one in from a lower right edge 'm'. With `dither`, the right of the body
 * checkers into 'm', the way 16-bit sprites fake a curve with two colours.
 */
function bevel(rows: readonly string[], opts: { hole?: string; mid?: boolean; dither?: boolean } = {}): string[] {
  const w = rows[0]?.length ?? 0
  const out = (x: number, y: number) => at(rows, x, y) === '.'
  const hole = (x: number, y: number) => opts.hole !== undefined && at(rows, x, y) === opts.hole
  return mapPixels(rows, (ch, x, y) => {
    if (ch !== '#') return ch
    if (out(x + 1, y) || out(x, y + 1) || hole(x + 1, y) || hole(x, y + 1)) return 'd'
    if (out(x - 1, y) || out(x, y - 1) || hole(x - 1, y) || hole(x, y - 1)) return 'h'
    if (opts.mid && (out(x + 2, y) || out(x, y + 2) || out(x + 1, y + 1))) return 'm'
    if (opts.dither && (x > w * 0.8 || (x > w * 0.6 && (x + y) % 2 === 0))) return 'm'
    return ch
  })
}

/** A 1 px 'O' outline around everything drawn (4-neighbour, so corners stay soft). */
const outline = (rows: readonly string[]): string[] =>
  mapPixels(rows, (ch, x, y) =>
    ch === '.' && [at(rows, x - 1, y), at(rows, x + 1, y), at(rows, x, y - 1), at(rows, x, y + 1)].some(c => c !== '.')
      ? 'O'
      : ch,
  )

/** An 'S' drop shadow `d` px down and right of everything drawn. */
const shadow = (rows: readonly string[], d: number): string[] =>
  mapPixels(rows, (ch, x, y) => (ch === '.' && at(rows, x - d, y - d) !== '.' ? 'S' : ch))

/** Plain '#' pixels → a digit per horizontal band, top '0', so each band can take its own colour. */
const bands = (rows: readonly string[], top: number, height: number, n: number): string[] =>
  mapPixels(rows, (ch, _x, y) => (ch === '#' ? String(Math.min(n - 1, Math.max(0, Math.floor(((y - top) * n) / height)))) : ch))

// ---------------------------------------------------------------------------------------------------------------
// A 5×7 pixel font, only the letters the screen needs.

const GLYPHS: Record<string, readonly string[]> = {
  Y: ['X...X', 'X...X', '.X.X.', '..X..', '..X..', '..X..', '..X..'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  "'": ['X', 'X', '.', '.', '.', '.', '.'],
  V: ['X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '.X.X.', '..X..'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  B: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
  P: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'],
  W: ['X...X', 'X...X', 'X...X', 'X.X.X', 'X.X.X', 'XX.XX', 'X...X'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  '!': ['X', 'X', 'X', 'X', 'X', '.', 'X'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
}

/** A bold 7×9 font with 2 px strokes, for the big word: chunky like a 16-bit title logo. */
const BOLD: Record<string, readonly string[]> = {
  P: ['XXXXXX.', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXX.', 'XX.....', 'XX.....', 'XX.....'],
  W: ['XX...XX', 'XX...XX', 'XX...XX', 'XX.X.XX', 'XX.X.XX', 'XXXXXXX', 'XXXXXXX', 'XXX.XXX', 'XX...XX'],
  N: ['XX...XX', 'XXX..XX', 'XXXX.XX', 'XXXXXXX', 'XX.XXXX', 'XX..XXX', 'XX...XX', 'XX...XX', 'XX...XX'],
  E: ['XXXXXXX', 'XXXXXXX', 'XX.....', 'XXXXXX.', 'XXXXXX.', 'XX.....', 'XX.....', 'XXXXXXX', 'XXXXXXX'],
  D: ['XXXXXX.', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXX.'],
  '!': ['XX', 'XX', 'XX', 'XX', 'XX', 'XX', '..', 'XX', 'XX'],
}

type Font = Record<string, readonly string[]>

const glyphWidth = (ch: string, font: Font = GLYPHS): number => (font[ch]?.[0]?.length ?? 0) + 1

export const textWidth = (text: string, scale: number, font: Font = GLYPHS): number =>
  ([...text].reduce((w, ch) => w + glyphWidth(ch, font), 0) - 1) * scale

/**
 * The text as a '#' map at `scale` px per font pixel. At scale 3 and up, an outer corner of a font pixel (both
 * sides open) loses its corner pixel, so the big letters read rounded instead of blocky.
 */
function textMask(text: string, scale: number, font: Font = GLYPHS): string[] {
  const height = font[text.charAt(0)]?.length ?? 0
  const grid = Array.from({ length: height * scale }, () => Array<string>(textWidth(text, scale, font)).fill('.'))
  let gx = 0
  for (const ch of text) {
    const glyph = font[ch] ?? []
    const on = (x: number, y: number) => glyph[y]?.charAt(x) === 'X'
    glyph.forEach((row, cy) =>
      [...row].forEach((c, cx) => {
        if (c !== 'X') return
        for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) grid[cy * scale + y]![(gx + cx) * scale + x] = '#'
        if (scale < 3) return
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          if (on(cx + dx, cy) || on(cx, cy + dy)) continue
          grid[cy * scale + (dy < 0 ? 0 : scale - 1)]![(gx + cx) * scale + (dx < 0 ? 0 : scale - 1)] = '.'
        }
      }),
    )
    gx += glyphWidth(ch, font)
  }
  return grid.map(r => r.join(''))
}

const CHROME: Pal = { O: '#0b0420', S: '#2a0a3a', h: '#ffffff', d: '#4a5cc4', '0': '#dbe6ff', '1': '#8ea4f5' }

/** Chrome letters: white top edge, a hard horizon halfway down, outlined, with a drop shadow. */
function chromeText(text: string, ox: number, oy: number, scale: number): string {
  const h = 7 * scale
  const rows = shadow(outline(pad(bands(bevel(pad(textMask(text, scale))), 1, h, 2), 3)), 1)
  return pixels(rows, CHROME, ox - 4, oy - 4)
}

const FIRE = ['#fff4b8', '#ffe066', '#ffb627', '#ff7b1c', '#f2402b', '#d61f4a', '#f2402b', '#ff7b1c', '#ffb627', '#ffe066']
const FIRE_PAL: Pal = { O: '#12020a', S: '#3a0a4a', h: '#fffbe8', d: '#7a0618' }

/** Fire letters: each band of rows steps through the fire ramp a step behind the band above (colour cycling). */
function fireText(text: string, ox: number, oy: number, scale: number): string {
  const n = 9
  const rows = shadow(outline(pad(bands(bevel(pad(textMask(text, scale, BOLD))), 1, 9 * scale, n), 3)), 2)
  const x0 = ox - 4
  const y0 = oy - 4
  const d = runs(rows, x0, y0)
  const cycling = Array.from({ length: n }, (_, i) => {
    const ramp = [...FIRE.slice(i), ...FIRE.slice(0, i)]
    const values = [...ramp, ramp[0]].join(';')
    return `<path fill="${ramp[0]}" d="${d[String(i)] ?? ''}"><animate attributeName="fill" values="${values}" dur="1.6s" calcMode="discrete" repeatCount="indefinite"/></path>`
  })
  return pixels(rows, FIRE_PAL, x0, y0) + cycling.join('')
}

// ---------------------------------------------------------------------------------------------------------------
// The skull — 20×22 before its outline. '#' bone (shaded by `bevel`), K holes. Frame B drops the jaw: it cackles.

const SKULL_TOP = [
  '......########......',
  '....############....',
  '...##############...',
  '..################..',
  '.##################.',
  '.##################.',
  '####################',
  '##KKKKK######KKKKK##',
  '#KKKKKKK####KKKKKKK#',
  '#KKKKKKK####KKKKKKK#',
  '#KKKKKKK####KKKKKKK#',
  '##KKKKK##KK##KKKKK##',
  '.#######KKKK#######.',
  '..######KKKK######..',
  '...##############...',
  '....############....',
  '....##K##KK##K##....',
]

const JAW = ['....##K##KK##K##....', '.....##########.....', '......########......']
const MOUTH = ['....KKKKKKKKKKKK....', '.....KKKKKKKKKK.....']
const BLANK = '....................'

const SKULL_CLOSED = [...SKULL_TOP, ...JAW, BLANK, BLANK]
const SKULL_OPEN = [...SKULL_TOP, ...MOUTH, ...JAW]

const BONE: Pal = { O: '#1a0610', h: '#fffbea', '#': '#efe4c8', m: '#c9b78f', d: '#8c7656', K: '#1c0710' }

const skullSprite = (rows: readonly string[]) => outline(pad(bevel(rows, { hole: 'K', mid: true, dither: true })))

function skull(id: string, scale: number): string {
  // The eyes glow red to yellow on their own, over whichever jaw frame shows; the glint stays white.
  const eye = (x: number) => `M${(x + 1) * scale} ${10 * scale}h${2 * scale}v${2 * scale}h-${2 * scale}z`
  const glint = (x: number) => `M${(x + 1) * scale} ${10 * scale}h${scale}v${scale}h-${scale}z`
  const eyes =
    `<path fill="#ff2d2d" d="${eye(4)}${eye(14)}"><animate attributeName="fill" values="#ff2d2d;#ff9500;#ffd60a;#ff9500;#ff2d2d" dur="0.8s" repeatCount="indefinite"/></path>` +
    `<path fill="#ffffff" d="${glint(4)}${glint(14)}"/>`
  const bob = `<animateTransform attributeName="transform" type="translate" values="0 0;0 -${scale};0 0" dur="0.6s" calcMode="discrete" repeatCount="indefinite"/>`
  const frames = flicker(pixels(skullSprite(SKULL_CLOSED), BONE, 0, 0, scale), pixels(skullSprite(SKULL_OPEN), BONE, 0, 0, scale), '0.6s')
  return `<g id="${id}"><g>${bob}${frames}${eyes}</g></g>`
}

// ---------------------------------------------------------------------------------------------------------------
// Small sprites for the strip under the title.

const WARNING = [
  '......#......',
  '.....###.....',
  '.....#K#.....',
  '....##K##....',
  '....##K##....',
  '...###K###...',
  '...###K###...',
  '..#########..',
  '..####K####..',
  '.###########.',
  '#############',
]

const WARNING_PAL: Pal = { O: '#1a0610', h: '#fff6b0', '#': '#ffd60a', m: '#e0a800', d: '#a86a00', K: '#1a0610' }

/** A shaded warning triangle with a "!", blinking. */
function warning(ox: number, oy: number, begin: string): string {
  const rows = outline(pad(bevel(WARNING, { mid: true })))
  return `<g>${pixels(rows, WARNING_PAL, ox, oy)}<animate attributeName="opacity" values="1;0.2" dur="0.7s" begin="${begin}" calcMode="discrete" repeatCount="indefinite"/></g>`
}

const PADLOCK = [
  '...LLLL...',
  '..L....L..',
  '.LL....LL.',
  '.L......L.',
  '.L......L.',
  '##########',
  '##########',
  '####KK####',
  '####KK####',
  '####KK####',
  '##########',
  '##########',
]

const PADLOCK_PAL: Pal = { O: '#1a0610', L: '#c8ccd8', h: '#fff1a8', '#': '#ffc400', m: '#d18f00', d: '#8a5a00', K: '#1a0a00' }

/** A shaded gold padlock: "your files are encrypted". */
const padlock = (ox: number, oy: number): string => pixels(outline(pad(bevel(PADLOCK, { mid: true }))), PADLOCK_PAL, ox, oy)

// ---------------------------------------------------------------------------------------------------------------
// The backdrop and the hazard tape.

const SKY = ['#0d0221', '#170330', '#22053a', '#2e063c', '#3b0838', '#4a0a31', '#5a0b29', '#690c20']

/** Hard bands of colour with a checker row of dither between each pair, then a red alarm pulse over it all. */
function sky(w: number, h: number): string {
  const bh = h / SKY.length
  const defs = SKY.slice(1)
    .map(
      (c, i) =>
        `<pattern id="dither${i}" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="${c}"/><rect x="1" y="1" width="1" height="1" fill="${c}"/></pattern>`,
    )
    .join('')
  const fill = SKY.map((c, i) => `<rect y="${i * bh}" width="${w}" height="${bh}" fill="${c}"/>`).join('')
  const dither = SKY.slice(1)
    .map((_, i) => `<rect y="${(i + 1) * bh - 2}" width="${w}" height="2" fill="url(#dither${i})"/>`)
    .join('')
  const pulse = `<rect width="${w}" height="${h}" fill="#ff1a3c" opacity="0"><animate attributeName="opacity" values="0;0.22;0" dur="1s" repeatCount="indefinite"/></rect>`
  return `<defs>${defs}</defs>${fill}${dither}${pulse}`
}

/** A four-point sparkle that twinkles in two steps. */
function sparkle(x: number, y: number, color: string, begin: string): string {
  const big = `M${x} ${y - 2}h1v5h-1zM${x - 2} ${y}h5v1h-5z`
  const small = `M${x} ${y}h1v1h-1z`
  const show = (values: string) =>
    `<animate attributeName="opacity" values="${values}" dur="1.2s" begin="${begin}" calcMode="discrete" repeatCount="indefinite"/>`
  return `<path fill="${color}" d="${big}">${show('1;0;0')}</path><path fill="${color}" d="${small}">${show('0;1;0')}</path>`
}

/** Hazard tape: shaded yellow with black diagonal stripes that crawl sideways. */
function hazardTape(y: number, width: number, height: number, reverse = false): string {
  const period = 8
  let d = ''
  for (let row = 1; row < height - 1; row++) {
    for (let x = -period; x < width + period; x += period) d += `M${x + row} ${y + row}h${period / 2}v1h-${period / 2}z`
  }
  const to = reverse ? period : -period
  return (
    `<rect y="${y}" width="${width}" height="${height}" fill="#ffd60a"/>` +
    `<rect y="${y + 1}" width="${width}" height="1" fill="#fff3a0"/>` +
    `<rect y="${y + height - 2}" width="${width}" height="1" fill="#c79a00"/>` +
    `<path fill="#1c1c24" d="${d}"><animateTransform attributeName="transform" type="translate" values="0 0;${to} 0" dur="0.5s" repeatCount="indefinite"/></path>` +
    `<rect y="${y}" width="${width}" height="1" fill="#0b0208"/>` +
    `<rect y="${y + height - 1}" width="${width}" height="1" fill="#0b0208"/>`
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The whole screen: a wide strip, made to sit in the band above the prompt.

const W = 320
const H = 88

export function pwnedSvg(): string {
  const top = "YOU'VE BEEN"
  const big = 'PWNED!'
  const topScale = 2
  const bigScale = 3
  const topX = Math.round((W - textWidth(top, topScale)) / 2)
  const bigX = Math.round((W - textWidth(big, bigScale, BOLD)) / 2)
  const topY = 11
  const bigY = 32

  // Glitch: a red and a cyan copy of PWNED jump off the letters now and then.
  const mask = runs(textMask(big, bigScale, BOLD), bigX, bigY)['#'] ?? ''
  const jitter = (dx: string) =>
    `<animateTransform attributeName="transform" type="translate" values="${dx}" dur="1.1s" calcMode="discrete" repeatCount="indefinite"/>`
  const glitch =
    `<path fill="#ff0040" opacity="0.85" d="${mask}">${jitter('0 0;-4 0;0 0;0 0;3 1;0 0')}</path>` +
    `<path fill="#00e5ff" opacity="0.85" d="${mask}">${jitter('0 0;4 0;0 0;0 0;-3 -1;0 0')}</path>`

  // The skull sprite is 22×24 px at scale 1; both skulls are the same drawing.
  const skullScale = 2
  const skullW = 22 * skullScale
  const skullY = 18

  const sparkles = [
    [18, 14, '#ffd60a', '0s'],
    [100, 22, '#64d2ff', '-0.4s'],
    [222, 16, '#ffffff', '-0.8s'],
    [302, 28, '#bf5af2', '-0.2s'],
    [90, 64, '#ffffff', '-0.6s'],
    [236, 70, '#ffd60a', '-1s'],
  ] as const

  const strip = 67
  return (
    `<svg ${XMLNS} viewBox="0 0 ${W} ${H}" width="${W * 3}" height="${H * 3}" ${CRISP}>` +
    sky(W, H) +
    sparkles.map(([x, y, c, b]) => sparkle(x, y, c, b)).join('') +
    hazardTape(0, W, 7) +
    hazardTape(H - 7, W, 7, true) +
    `<g transform="translate(34 ${skullY})">${skull('skull', skullScale)}</g>` +
    `<use href="#skull" transform="translate(${W - 34 - skullW} ${skullY})"/>` +
    chromeText(top, topX, topY, topScale) +
    glitch +
    fireText(big, bigX, bigY, bigScale) +
    warning(112, strip, '0s') +
    padlock(136, strip - 1) +
    warning(W / 2 - 7, strip, '-0.35s') +
    padlock(W - 148, strip - 1) +
    warning(W - 126, strip, '0s') +
    `</svg>`
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The same screen as a raster, for the surfaces that draw no `Svg`. The terminal draws it as half-block cells, two
// pixels to a cell. VS Code draws it as rows of coloured boxes: its webview never draws an `Svg` here, because the
// frame it paints pictures in shares the page's process. One raster per tick: the jaw, the eyes, the fire, the
// tape and the middle warning step with `frame`.

/** Rows of colours, '' where nothing is drawn. */
export type Raster = string[][]

/** Cuts the empty ('.') rows and columns around a pixel map. */
function trim(rows: readonly string[]): string[] {
  const ys = rows.flatMap((r, y) => (/[^.]/.test(r) ? [y] : []))
  const xs = Array.from({ length: rows[0]?.length ?? 0 }, (_, x) => x).filter(x => rows.some(r => r.charAt(x) !== '.'))
  if (ys.length === 0 || xs.length === 0) return []
  return rows.slice(ys[0], ys.at(-1)! + 1).map(r => r.slice(xs[0], xs.at(-1)! + 1))
}

const widthOf = (rows: readonly string[]): number => rows[0]?.length ?? 0

function blit(r: Raster, rows: readonly string[], pal: Pal, ox: number, oy: number): void {
  rows.forEach((row, y) => {
    const line = r[oy + y]
    if (line === undefined) return
    ;[...row].forEach((ch, x) => {
      const color = pal[ch]
      if (color !== undefined && ox + x >= 0 && ox + x < line.length) line[ox + x] = color
    })
  })
}

// At one pixel per font pixel a bevel would leave no fill, so the raster letters keep their bands and outline.
const R_FIRE = trim(shadow(outline(pad(bands(pad(textMask('PWNED!', 1, BOLD)), 1, 9, 9), 2)), 1))
const R_CHROME = trim(shadow(outline(pad(bands(pad(textMask("YOU'VE BEEN", 1)), 1, 7, 2), 2)), 1))
const R_SKULL = [skullSprite(SKULL_CLOSED), skullSprite(SKULL_OPEN)] as const
const R_WARNING = outline(pad(bevel(WARNING, { mid: true })))
const R_PADLOCK = outline(pad(bevel(PADLOCK, { mid: true })))

// A 10×10 skull for the compact strip, 12×12 with its outline.
const MINI_TOP = ['..######..', '.########.', '##########', '#KKK##KKK#', '#KKK##KKK#', '####KK####', '.########.', '..#K##K#..']
const R_MINI = [
  outline(pad(bevel([...MINI_TOP, '..######..', '..........'], { hole: 'K' }))),
  outline(pad(bevel([...MINI_TOP, '..KKKKKK..', '..######..'], { hole: 'K' }))),
] as const

const EYES = ['#ff2d2d', '#ff9500', '#ffd60a', '#ff9500']

function rasterTape(r: Raster, y: number, height: number, shift: number): void {
  for (let row = 0; row < height; row++) {
    const line = r[y + row]
    if (line === undefined) continue
    for (let x = 0; x < line.length; x++) line[x] = (((x + row + shift) % 8) + 8) % 8 < 4 ? '#1c1c24' : '#ffd60a'
  }
}

/**
 * The PWNED screen, `width` pixels wide, at animation step `frame`. `compact` is the strip for the band above the
 * prompt (18 px tall: tape, mini skulls, the fire word); otherwise the full screen (46 px tall).
 */
export function pwnedRaster(frame: number, width: number, compact: boolean): Raster {
  const fire = R_FIRE
  const fireW = widthOf(fire)
  const isOpen = Math.floor(frame / 2) % 2 === 1
  const firePal: Pal = { ...FIRE_PAL, ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i), FIRE[(i + frame) % FIRE.length]!])) }
  const cx = Math.floor(width / 2)

  const tape = 2
  const height = compact ? 18 : 46
  const r: Raster = Array.from({ length: height }, (_, y) => Array<string>(width).fill(SKY[Math.min(SKY.length - 1, Math.floor((y * SKY.length) / height))]!))
  rasterTape(r, 0, tape, frame)
  rasterTape(r, height - tape, tape, -frame)

  const eyes = (sx: number, sy: number, at: readonly (readonly [number, number])[]) =>
    at.forEach(([x, y]) => {
      const line = r[sy + y]
      if (line !== undefined && sx + x >= 0 && sx + x < width) line[sx + x] = EYES[frame % EYES.length]!
    })

  if (compact) {
    const fireY = tape + 2
    blit(r, fire, firePal, cx - Math.floor(fireW / 2), fireY)
    if (width >= fireW + 2 * (12 + 6)) {
      const skullY = fireY
      const mini = R_MINI[isOpen ? 1 : 0]
      for (const sx of [cx - Math.floor(fireW / 2) - 6 - 12, cx + Math.ceil(fireW / 2) + 6]) {
        blit(r, mini, BONE, sx, skullY)
        eyes(sx, skullY, [[3, 5], [8, 5]])
      }
    }
    return r
  }

  const chrome = R_CHROME
  const chromeY = tape + 2
  const fireY = chromeY + chrome.length + 1
  blit(r, chrome, CHROME, cx - Math.floor(widthOf(chrome) / 2), chromeY)
  blit(r, fire, firePal, cx - Math.floor(fireW / 2), fireY)

  if (width >= fireW + 2 * (22 + 8)) {
    const skull = R_SKULL[isOpen ? 1 : 0]
    const skullY = tape + 3 - (isOpen ? 1 : 0)
    for (const sx of [cx - Math.floor(fireW / 2) - 8 - 22, cx + Math.ceil(fireW / 2) + 8]) {
      blit(r, skull, BONE, sx, skullY)
      eyes(sx, skullY, [[5, 10], [6, 10], [5, 11], [6, 11], [15, 10], [16, 10], [15, 11], [16, 11]])
    }
  }

  // Warnings and padlocks under the word; the middle warning blinks.
  const icons = width >= 92 ? ['w', 'l', 'b', 'l', 'w'] : ['l', 'b', 'l']
  const iconW = (k: string) => widthOf(k === 'l' ? R_PADLOCK : R_WARNING)
  const gap = 4
  let x = cx - Math.floor((icons.reduce((w, k) => w + iconW(k), 0) + gap * (icons.length - 1)) / 2)
  const iconY = height - tape - 1 - R_WARNING.length
  for (const k of icons) {
    if (k === 'l') blit(r, R_PADLOCK, PADLOCK_PAL, x, iconY - 1)
    else if (k === 'w' || frame % 2 === 0) blit(r, R_WARNING, WARNING_PAL, x, iconY)
    x += iconW(k) + gap
  }
  return r
}

/** A run of terminal cells of one look: '▀' draws the upper pixel in `fg` over the lower one in `bg`. */
export type Cell = { text: string; fg?: string; bg?: string }

/** The raster as terminal rows, two pixel rows to a cell row, runs of one look merged. */
export function halfBlocks(r: Raster): Cell[][] {
  const out: Cell[][] = []
  for (let y = 0; y < r.length; y += 2) {
    const top = r[y]!
    const bottom = r[y + 1]
    const row: Cell[] = []
    top.forEach((t, x) => {
      const b = bottom?.[x] ?? ''
      const cell: Cell =
        t === b
          ? t === ''
            ? { text: ' ' }
            : { text: ' ', bg: t }
          : t === ''
            ? { text: '▄', fg: b }
            : b === ''
              ? { text: '▀', fg: t }
              : { text: '▀', fg: t, bg: b }
      const last = row.at(-1)
      if (last !== undefined && last.fg === cell.fg && last.bg === cell.bg && last.text.charAt(0) === cell.text) last.text += cell.text
      else row.push(cell)
    })
    out.push(row)
  }
  return out
}

/** A run of `n` pixels of one colour. */
export type Span = { n: number; color: string }

/** The raster as rows of runs of one colour, for a surface that draws coloured boxes. */
export const spans = (r: Raster): Span[][] =>
  r.map(row =>
    row.reduce<Span[]>((acc, color) => {
      const last = acc.at(-1)
      if (last !== undefined && last.color === color) last.n++
      else acc.push({ n: 1, color })
      return acc
    }, []),
  )
