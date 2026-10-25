// Writes the README showcase images to docs/images/: each scene is composed from the real art in the mods'
// hooks/art.ts, so the pictures stay true to what the mods draw. Animations are SMIL, which GitHub plays in <img>.
// Run from the repo root after editing any art.ts (Node 23.6+ for TypeScript imports): node scripts/build-readme-art.mjs
import { mkdirSync, writeFileSync } from 'node:fs'

const den = await import('../plugins/agent-den/hooks/art.ts')
const { ROSTER, resolveBuddy } = await import('../plugins/agent-den/hooks/buddies.ts')
const thermo = await import('../plugins/cache-thermo/hooks/art.ts')
const coach = await import('../plugins/prompt-coach/hooks/art.ts')

const P = thermo.PALETTE
const MUTED = 'rgba(223,231,239,0.55)'
const LINE = 'rgba(223,231,239,0.18)'
const FONT = `font-family="ui-monospace, 'SF Mono', Menlo, Consolas, monospace"`
const OWL = '#e8c39e'
const LILAC = '#c4b5fd'

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Places a complete SVG document at (x, y) inside the scene. */
const place = (svg, x, y) => svg.replace(/^<svg /, `<svg x="${x}" y="${y}" `)

const text = (x, y, s, { size = 14, fill = P.ink, weight = 'normal', anchor = 'start', spacing = 0 } = {}) =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}"` +
  (spacing ? ` letter-spacing="${spacing}"` : '') + `>${esc(s)}</text>`

const box = (x, y, w, h, stroke = LINE, r = 10) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${P.panel}" stroke="${stroke}"/>`

const scene = (w, h, title, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<title>${esc(title)}</title>` +
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="16" fill="${P.panel}" stroke="${LINE}"/>` +
  body + '</svg>\n'

const buddy = (key, status, sizePx, transition = null) =>
  den.buddySvg(resolveBuddy({ key, variant: 0 }), status, { sizePx, transition, animations: 'full' })

// ---------------------------------------------------------------------------------------------------------------
// Hero: one strip with a piece of each mod.

function hero() {
  const W = 880, H = 300
  let s = ''
  s += text(40, 62, 'mods-marketplace', { size: 30, fill: P.hot, weight: 'bold', spacing: 1 })
  s += text(40, 92, 'Pixel-art mods for Claude Code · cache, prompts and subagents, made visible', { size: 14, fill: MUTED })

  // cache-thermo strip
  s += place(thermo.emberSvg('hot', 48), 40, 122)
  s += place(thermo.thermometerSvg({ fraction: 0.72, zone: 'hot', widthPx: 520, heightPx: 32 }), 100, 130)
  s += text(636, 152, '43:12 left · 182k ctx', { size: 13, fill: P.hot })

  // agent-den row + Quill
  const keys = ['digby', 'bricks', 'bolt', 'pip', 'mochi', 'moss']
  const statuses = ['running', 'running', 'waiting', 'idle', 'running', 'completed']
  keys.forEach((k, i) => { s += place(buddy(k, statuses[i], 72), 40 + i * 86, 196) })
  s += place(coach.quillSvg('reading', 96), 740, 180)
  return scene(W, H, 'mods-marketplace: cache-thermo, agent-den and prompt-coach', s)
}

// ---------------------------------------------------------------------------------------------------------------
// cache-thermo: the three zones, the cold-cache gate and break mode.

function cacheThermo() {
  const W = 880, H = 420
  let s = ''
  s += text(32, 44, 'cache-thermo', { size: 20, fill: P.hot, weight: 'bold', spacing: 1 })
  s += text(212, 44, 'your prompt cache, at a glance', { size: 13, fill: MUTED })

  const zones = [
    ['hot', 0.78, '46:50 left · 182k ctx · re-cache ≈ $0.91'],
    ['warm', 0.14, ' 8:24 left · 182k ctx · re-cache ≈ $0.91'],
    ['cold', 0, 'cold · next prompt re-caches 182k ≈ $0.91'],
  ]
  zones.forEach(([zone, f, label], i) => {
    const y = 70 + i * 64
    const color = P[zone]
    s += box(24, y, W - 48, 52, color)
    s += place(zone === 'cold' ? thermo.frostbitSvg(40) : thermo.emberSvg(zone, 40), 36, y + 6)
    s += place(thermo.thermometerSvg({ fraction: f, zone, widthPx: 380, heightPx: 24 }), 88, y + 14)
    s += text(484, y + 31, label, { size: 13, fill: color })
  })

  // The gate and the break, side by side.
  const y = 274
  const half = (W - 48 - 16) / 2
  s += box(24, y, half, 120, P.cold)
  s += place(thermo.frostbitSvg(72), 40, y + 24)
  s += text(128, y + 34, 'Cold cache: hold on', { size: 14, fill: P.cold, weight: 'bold' })
  s += text(128, y + 58, 'This prompt re-caches 1.4M tokens', { size: 12, fill: MUTED })
  s += text(128, y + 84, '[c] go ahead anyway · $8.48', { size: 12, fill: P.ink })
  s += text(128, y + 104, '[x] keep my prompt', { size: 12, fill: P.ink })

  const bx = 24 + half + 16
  s += box(bx, y, half, 120, P.ember)
  s += place(thermo.campfireSvg(72), bx + 16, y + 24)
  s += text(bx + 104, y + 34, '☕ On a break', { size: 14, fill: P.ember, weight: 'bold' })
  s += text(bx + 104, y + 58, 'Keeping the cache warm', { size: 12, fill: MUTED })
  s += text(bx + 104, y + 84, 'next nudge in 3:12 · 4 nudges', { size: 12, fill: P.ink })
  s += text(bx + 104, y + 104, "[I'm back]", { size: 12, fill: P.hot })
  return scene(W, H, 'cache-thermo: thermometer band, cold-cache gate and break mode', s)
}

// ---------------------------------------------------------------------------------------------------------------
// agent-den: the full roster busy, then every status.

function agentDen() {
  const W = 880, H = 400
  let s = ''
  s += text(32, 44, 'agent-den', { size: 20, fill: LILAC, weight: 'bold', spacing: 1 })
  s += text(170, 44, '● 4 busy  ◐ 1 waiting  ✓ 3 done', { size: 13, fill: MUTED })

  ROSTER.forEach((b, i) => {
    const x = 32 + i * 83
    s += place(buddy(b.key, 'running', 72), x, 70)
    s += text(x + 36, 162, b.name, { size: 12, fill: MUTED, anchor: 'middle' })
  })

  s += `<line x1="32" y1="190" x2="${W - 32}" y2="190" stroke="${LINE}" stroke-dasharray="4 4"/>`
  s += text(32, 222, 'every status has its own loop', { size: 13, fill: MUTED })
  const cells = [
    ['tansy', 'pending', 'hatching'],
    ['nib', 'running', 'busy'],
    ['bristle', 'waiting', 'waiting'],
    ['puff', 'idle', 'napping'],
    ['pip', 'completed', 'done'],
    ['bolt', 'failed', 'oops'],
    ['moss', 'killed', 'stopped'],
  ]
  cells.forEach(([key, status, label], i) => {
    const x = 32 + i * 118
    s += place(buddy(key, status, 96), x, 240)
    s += text(x + 48, 364, label, { size: 12, fill: P.ink, anchor: 'middle' })
  })
  return scene(W, H, 'agent-den: one animated pixel buddy per subagent', s)
}

// ---------------------------------------------------------------------------------------------------------------
// prompt-coach: Quill and a brief scored against the five parts.

function promptCoach() {
  const W = 880, H = 330
  let s = ''
  s += text(32, 44, 'prompt-coach', { size: 20, fill: OWL, weight: 'bold', spacing: 1 })
  s += text(212, 44, 'Quill reads your brief before Claude starts', { size: 13, fill: MUTED })

  const moods = ['idle', 'reading', 'hmm', 'happy']
  moods.forEach((m, i) => {
    const x = 32 + (i % 2) * 112, y = 72 + Math.floor(i / 2) * 124
    s += place(coach.quillSvg(m, 96), x, y)
    s += text(x + 48, y + 112, m, { size: 12, fill: MUTED, anchor: 'middle' })
  })

  const px = 280, py = 72
  s += box(px, py, W - px - 32, 230, P.warm)
  s += text(px + 20, py + 32, 'Prompt coach · 3 of 4 parts', { size: 14, fill: P.warm, weight: 'bold' })
  const rows = [
    ['✓', 'Goal', 'Add CSV export to the reports page', P.hot],
    ['✓', 'Why', 'Finance pastes numbers into sheets', P.hot],
    ['✓', 'Constraints', 'Reuse the existing table model', P.hot],
    ['✗', 'Done when', 'Which test proves it works?', P.cold],
    ['–', 'Reuse', 'does not apply', MUTED],
  ]
  rows.forEach(([mark, part, note, color], i) => {
    const y = py + 66 + i * 28
    s += text(px + 20, y, mark, { size: 14, fill: color, weight: 'bold' })
    s += text(px + 44, y, part, { size: 13, fill: P.ink })
    s += text(px + 160, y, note, { size: 13, fill: color === P.hot ? MUTED : color })
  })
  s += text(px + 20, py + 214, '[i] improve it   [s] send anyway   [a] let Claude ask', { size: 12, fill: P.ink })
  return scene(W, H, 'prompt-coach: Quill the owl scores your brief', s)
}

mkdirSync('docs/images', { recursive: true })
writeFileSync('docs/images/hero.svg', hero())
writeFileSync('docs/images/cache-thermo.svg', cacheThermo())
writeFileSync('docs/images/agent-den.svg', agentDen())
writeFileSync('docs/images/prompt-coach.svg', promptCoach())
