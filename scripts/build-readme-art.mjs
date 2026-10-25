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

// ---------------------------------------------------------------------------------------------------------------
// Plugin README scenes: the cast of cache-thermo, a den with cards, and Quill's improve-it round trip.

function cacheThermoCast() {
  const W = 880, H = 250
  let s = ''
  s += text(32, 44, 'the cast', { size: 20, fill: P.hot, weight: 'bold', spacing: 1 })
  const cast = [
    [thermo.emberSvg('hot', 96), 'Ember', 'cache hot', P.hot],
    [thermo.emberSvg('working', 96), 'Ember', 'refreshing', P.hot],
    [thermo.emberSvg('warm', 96), 'Ember', 'cooling down', P.warm],
    [thermo.frostbitSvg(96), 'Frostbit', 'cache cold', P.frost],
    [thermo.campfireSvg(96), 'Campfire', 'on a break', P.ember],
  ]
  cast.forEach(([svg, name, label, color], i) => {
    const x = 48 + i * 166
    s += place(svg, x, 76)
    s += text(x + 48, 200, name, { size: 13, fill: color, weight: 'bold', anchor: 'middle' })
    s += text(x + 48, 220, label, { size: 12, fill: MUTED, anchor: 'middle' })
  })
  return scene(W, H, 'cache-thermo mascots: Ember in three moods, Frostbit and the campfire', s)
}

function agentDenPanel() {
  const W = 880, H = 470
  let s = ''
  s += text(32, 44, 'Agent den', { size: 18, fill: LILAC, weight: 'bold', spacing: 1 })
  s += text(W - 32, 44, '● 2 busy  ◐ 1 waiting  ◌ 1 napping  ✓ 1 done', { size: 13, fill: MUTED, anchor: 'end' })
  const cards = [
    ['digby', 'running', 'Find the auth middleware', 'Explore', '⠹ Grep  "verifyToken"', 0],
    ['bricks', 'running', 'Plan the session refactor', 'Plan', '⠼ Read  src/session.ts', 0],
    ['bristle', 'waiting', 'Review the token changes', 'code-review', 'waiting for permission', 1],
    ['puff', 'idle', 'Sketch the migration', 'general-purpose', '"Drafted the three steps."', 1],
    ['pip', 'completed', 'Summarise the API docs', 'Explore', '✓ finished in 1m 12s', 0],
  ]
  const statusText = { running: ['busy', P.hot], waiting: ['waiting', P.warm], idle: ['napping', LILAC], completed: ['done', P.hot] }
  const times = ['0:42', '1:05', '0:18', '2:31', '1:12']
  cards.forEach(([key, status, desc, type, line, depth], i) => {
    const y = 66 + i * 78
    const x = 24 + depth * 32
    const b = resolveBuddy({ key, variant: 0 })
    const [label, color] = statusText[status]
    s += box(x, y, W - 24 - x, 68, status === 'completed' ? LINE : color)
    s += place(buddy(key, status, 48), x + 12, y + 10)
    s += text(x + 76, y + 28, `${i + 1}  ${b.name}`, { size: 13, fill: P.ink, weight: 'bold' })
    s += text(x + 170, y + 28, desc, { size: 13, fill: P.ink })
    s += text(W - 44, y + 28, `${label} · ${times[i]}`, { size: 12, fill: color, anchor: 'end' })
    s += text(x + 76, y + 50, type, { size: 12, fill: MUTED })
    s += text(x + 170, y + 50, line, { size: 12, fill: MUTED })
    s += text(W - 44, y + 50, 'output ›', { size: 12, fill: LILAC, anchor: 'end' })
  })
  return scene(W, H, 'agent-den: the den pane with a card for each subagent', s)
}

function promptCoachImprove() {
  const W = 880, H = 300
  let s = ''
  s += text(32, 44, 'improve it', { size: 20, fill: OWL, weight: 'bold', spacing: 1 })
  s += text(184, 44, 'your prompt comes back with a question for each missing part', { size: 13, fill: MUTED })

  s += box(24, 70, 560, 200, LINE)
  const lines = [
    ['Add CSV export to the reports page. Finance pastes', P.ink],
    ['the numbers into sheets by hand today. Reuse the', P.ink],
    ['existing table model.', P.ink],
    ['', P.ink],
    ['## Done when', P.warm],
    ['- <Which test proves it works?>', P.cold],
  ]
  lines.forEach(([l, c], i) => { s += text(44, 104 + i * 26, l, { size: 13, fill: c }) })

  s += place(coach.quillSvg('happy', 96), 660, 76)
  s += text(708, 204, '3/4  →  4/4', { size: 16, fill: P.hot, weight: 'bold', anchor: 'middle' })
  s += text(708, 230, 'nice brief ✓', { size: 13, fill: MUTED, anchor: 'middle' })
  return scene(W, H, 'prompt-coach: improve it puts a question for each missing part back in the prompt box', s)
}

mkdirSync('docs/images', { recursive: true })
writeFileSync('docs/images/hero.svg', hero())
writeFileSync('docs/images/cache-thermo.svg', cacheThermo())
writeFileSync('docs/images/agent-den.svg', agentDen())
writeFileSync('docs/images/prompt-coach.svg', promptCoach())
writeFileSync('docs/images/cache-thermo-cast.svg', cacheThermoCast())
writeFileSync('docs/images/agent-den-panel.svg', agentDenPanel())
writeFileSync('docs/images/prompt-coach-improve.svg', promptCoachImprove())
