import { describe, expect, test } from 'claude-code/testing'

import type { DenStatus } from '../types'
import {
  ASCII_W,
  buddyAscii,
  buddySvg,
  EMPTY_DEN_ASCII,
  emptyDenSvg,
  faceBoxes,
  isSafeGlyphs,
  SPINNER,
  TRANSITION_MS,
  transitionFor,
  type Animations,
  type Transition,
} from './art'
import { parseBuddyMap, pickBuddy, resolveBuddy, ROSTER, rotateHue, variantName } from './buddies'

const STATUSES: DenStatus[] = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed']
const TRANSITIONS: Transition[] = [null, 'spawn', 'complete', 'fail', 'leave']
const MODES: Animations[] = ['full', 'calm', 'off']
const KEEP = 600_000

/** The SVG rules every drawing keeps: a document with a title, no script, no events, no outside references. */
function svgProblems(svg: string): string[] {
  const out: string[] = []
  if (!svg.startsWith('<svg')) out.push('does not start with <svg')
  if (!svg.includes('<title>')) out.push('no <title>')
  if (/<script/i.test(svg)) out.push('<script')
  if (/\son[a-z]+\s*=/i.test(svg)) out.push('event attribute')
  if (/href/i.test(svg)) out.push('href')
  if (/url\((?!#)/i.test(svg)) out.push('url( to the outside')
  if (svg.length >= 131_072) out.push(`too long: ${svg.length}`)
  return out
}

describe('roster', () => {
  test('ten buddies with unique keys, the spec names and species', async () => {
    expect(ROSTER.length).toBe(10)
    expect(ROSTER.map(b => b.key)).toEqual(['digby', 'bricks', 'bolt', 'pip', 'bristle', 'mochi', 'nib', 'moss', 'puff', 'tansy'])
    expect(ROSTER.map(b => b.name)).toEqual(['Digby', 'Bricks', 'Bolt', 'Pip', 'Bristle', 'Mochi', 'Nib', 'Moss', 'Puff', 'Tansy'])
    expect(ROSTER.map(b => b.species)).toEqual(['mole', 'beaver', 'robot', 'bookworm', 'hedgehog', 'slime', 'fox kit', 'frog', 'cloud', 'bunny'])
    expect(new Set(ROSTER.map(b => b.accent)).size).toBe(10)
  })
  test('every body and prop is 16 × 16 and every letter is in the palette', async () => {
    for (const b of ROSTER) {
      for (const layer of [b.body, b.prop ?? Array<string>(16).fill('.'.repeat(16))]) {
        expect(layer.length).toBe(16)
        for (const row of layer) {
          expect(row.length).toBe(16)
          for (const c of row) if (c !== '.' && c !== 'E' && c !== 'M') expect(b.palette[c] !== undefined).toBe(true)
        }
      }
      for (const c of b.prop?.join('') ?? '') expect(c === 'E' || c === 'M').toBe(false)
    }
  })
  test('every body has two eye boxes and a mouth box, with room for the eyes to look', async () => {
    for (const b of ROSTER) {
      const face = faceBoxes(b.body)
      expect(face === null).toBe(false)
      if (face === null) continue
      const [l, r] = face.eyes
      expect(l.y).toBe(r.y)
      for (let dy = 0; dy < 3; dy++) {
        // The cell left of the left eye and right of the right eye are skin, not outline or air.
        const row = b.body[l.y + dy] ?? ''
        expect(row.charAt(l.x - 1) === '.' || row.charAt(l.x - 1) === '').toBe(false)
        expect(row.charAt(r.x + 3) === '.' || row.charAt(r.x + 3) === '').toBe(false)
      }
    }
  })
  test('faceBoxes rejects a malformed body', async () => {
    expect(faceBoxes(['....'])).toBe(null)
    const bad = (ROSTER[0]?.body ?? []).map(r => r.replace('MMMM', 'MMM.'))
    expect(faceBoxes(bad)).toBe(null)
  })
})

describe('pickBuddy', () => {
  test('the agent type picks the default buddy', async () => {
    expect(pickBuddy('Explore', [], {})).toEqual({ key: 'digby', variant: 0 })
    expect(pickBuddy('plan', [], {})).toEqual({ key: 'bricks', variant: 0 })
    expect(pickBuddy('general-purpose', [], {})).toEqual({ key: 'bolt', variant: 0 })
    expect(pickBuddy('workflow', [], {})).toEqual({ key: 'mochi', variant: 0 })
  })
  test('bristle matches review, security and audit by substring', async () => {
    expect(pickBuddy('security-review', [], {})).toEqual({ key: 'bristle', variant: 0 })
    expect(pickBuddy('Code-Reviewer', [], {})).toEqual({ key: 'bristle', variant: 0 })
    expect(pickBuddy('audit-bot', [], {})).toEqual({ key: 'bristle', variant: 0 })
  })
  test('an unknown type starts at the first roster buddy', async () => {
    expect(pickBuddy('my-own-agent', [], {})).toEqual({ key: 'digby', variant: 0 })
  })
  test('a second live Explore gets the first free buddy in roster order', async () => {
    expect(pickBuddy('Explore', [{ key: 'digby', variant: 0 }], {})).toEqual({ key: 'bricks', variant: 0 })
    expect(pickBuddy('Explore', [{ key: 'digby', variant: 0 }, { key: 'bricks', variant: 0 }], {})).toEqual({ key: 'bolt', variant: 0 })
  })
  test('with all ten taken, the type buddy comes back as the lowest free variant', async () => {
    const all = ROSTER.map(b => ({ key: b.key, variant: 0 }))
    expect(pickBuddy('Explore', all, {})).toEqual({ key: 'digby', variant: 1 })
    expect(pickBuddy('Plan', [...all, { key: 'bricks', variant: 1 }], {})).toEqual({ key: 'bricks', variant: 2 })
    expect(pickBuddy('Explore', [...all, { key: 'digby', variant: 2 }], {})).toEqual({ key: 'digby', variant: 1 })
  })
  test('the map wins, but only with a roster key', async () => {
    expect(pickBuddy('Explore', [], { explore: 'moss' })).toEqual({ key: 'moss', variant: 0 })
    expect(pickBuddy('Explore', [], { explore: 'nobody' })).toEqual({ key: 'digby', variant: 0 })
    expect(pickBuddy('constructor', [], {})).toEqual({ key: 'digby', variant: 0 })
  })
  test('a variant does not count as the original being taken', async () => {
    expect(pickBuddy('Explore', [{ key: 'digby', variant: 1 }], {})).toEqual({ key: 'digby', variant: 0 })
  })
})

describe('parseBuddyMap, variants and colours', () => {
  test('parses pairs and drops broken parts', async () => {
    expect(parseBuddyMap('Explore=digby, my-agent=moss;bad, x=')).toEqual({ explore: 'digby', 'my-agent': 'moss' })
    expect(parseBuddyMap(' Plan = Bricks \n review=bristle ')).toEqual({ plan: 'bricks', review: 'bristle' })
    expect(parseBuddyMap('')).toEqual({})
  })
  test('variantName numbers the name', async () => {
    expect(variantName('Digby', 0)).toBe('Digby')
    expect(variantName('Digby', 1)).toBe('Digby II')
    expect(variantName('Digby', 2)).toBe('Digby III')
    expect(variantName('Digby', 9)).toBe('Digby X')
    expect(variantName('Digby', 10)).toBe('Digby 11')
    expect(variantName('Digby', 11)).toBe('Digby 12')
  })
  test('rotateHue turns colours and keeps greys', async () => {
    expect(rotateHue('#ff0000', 120)).toBe('#00ff00')
    expect(rotateHue('#808080', 90)).toBe('#808080')
    expect(rotateHue('nonsense', 90)).toBe('nonsense')
  })
  test('resolveBuddy makes recoloured variants and never throws', async () => {
    const d0 = resolveBuddy({ key: 'digby', variant: 0 })
    const d1 = resolveBuddy({ key: 'digby', variant: 1 })
    expect(d0.displayName).toBe('Digby')
    expect(d1.displayName.endsWith(' II')).toBe(true)
    expect(d1.variant).toBe(1)
    expect(d1.palette.B === d0.palette.B).toBe(false)
    expect(d1.accent === d0.accent).toBe(false)
    expect(resolveBuddy({ key: 'nobody', variant: 0 }).key).toBe('digby')
  })
})

describe('transitionFor', () => {
  const row = (status: DenStatus, startedAt: number, statusSince: number, endedAt?: number) =>
    endedAt === undefined ? { status, startedAt, statusSince } : { status, startedAt, statusSince, endedAt }
  test('spawn plays from startedAt, even after a status change', async () => {
    expect(transitionFor(row('pending', 0, 0), TRANSITION_MS - 1, KEEP)).toBe('spawn')
    expect(transitionFor(row('running', 0, 1000), TRANSITION_MS - 1, KEEP)).toBe('spawn')
    expect(transitionFor(row('running', 0, 0), TRANSITION_MS, KEEP)).toBe(null)
  })
  test('complete and fail play from statusSince; killed has none', async () => {
    expect(transitionFor(row('completed', 0, 5000, 5000), 5000 + TRANSITION_MS - 1, KEEP)).toBe('complete')
    expect(transitionFor(row('completed', 0, 5000, 5000), 5000 + TRANSITION_MS, KEEP)).toBe(null)
    expect(transitionFor(row('failed', 0, 5000, 5000), 5000 + TRANSITION_MS - 1, KEEP)).toBe('fail')
    expect(transitionFor(row('killed', 0, 5000, 5000), 5000, KEEP)).toBe(null)
  })
  test('leave plays in the last TRANSITION_MS before the row expires', async () => {
    const r = row('completed', 0, 0, 10_000)
    expect(transitionFor(r, 10_000 + KEEP - TRANSITION_MS - 1, KEEP)).toBe(null)
    expect(transitionFor(r, 10_000 + KEEP - TRANSITION_MS, KEEP)).toBe('leave')
    expect(transitionFor(row('failed', 0, 0, 10_000), 10_000 + KEEP, KEEP)).toBe('leave')
    // Leave wins over complete when the keep time is short.
    expect(transitionFor(row('completed', 0, 0, 0), 0, 1000)).toBe('leave')
  })
  test('an ended row with no endedAt never leaves', async () => {
    expect(transitionFor(row('completed', 0, 0), 10 * KEEP, KEEP)).toBe(null)
  })
})

describe('buddyAscii', () => {
  test('every buddy × status × frame × mode: 3 rows of ASCII_W safe cells', async () => {
    for (const b0 of ROSTER) {
      for (const variant of [0, 1]) {
        const b = resolveBuddy({ key: b0.key, variant })
        for (const s of STATUSES) {
          for (const mode of MODES) {
            for (let f = 0; f < 6; f++) {
              const rows = buddyAscii(b, s, f, mode)
              expect(rows.length).toBe(3)
              for (const row of rows) {
                expect([...row].length).toBe(ASCII_W)
                expect(isSafeGlyphs(row)).toBe(true)
                expect(/[•⌒˘°]/u.test(row)).toBe(false)
                expect(/\p{Extended_Pictographic}/u.test(row)).toBe(false)
              }
            }
          }
        }
      }
    }
  })
  test('a hat longer than 9 cells is cut, odd frames do not throw', async () => {
    const b = { ...resolveBuddy({ key: 'digby', variant: 0 }), ascii: { hat: '0123456789ABC' } }
    for (const f of [-3, 0.5, Number.NaN, 1e9]) for (const s of STATUSES) expect(buddyAscii(b, s, f, 'full').length).toBe(3)
  })
  test('running moves, completed hops once and rests', async () => {
    const b = resolveBuddy({ key: 'bolt', variant: 0 })
    expect(buddyAscii(b, 'running', 0, 'full')).not.toEqual(buddyAscii(b, 'running', 1, 'full'))
    expect(buddyAscii(b, 'completed', 3, 'full')).toEqual(buddyAscii(b, 'completed', 9, 'full'))
    expect(buddyAscii(b, 'completed', 0, 'full')).not.toEqual(buddyAscii(b, 'completed', 1, 'full'))
  })
  test('EMPTY_DEN_ASCII and SPINNER keep the glyph rule', async () => {
    expect(EMPTY_DEN_ASCII.length).toBe(3)
    for (const row of EMPTY_DEN_ASCII) {
      expect([...row].length).toBe(ASCII_W)
      expect(isSafeGlyphs(row)).toBe(true)
    }
    expect(SPINNER.length).toBe(10)
    for (const s of SPINNER) {
      expect([...s].length).toBe(1)
      expect(isSafeGlyphs(s)).toBe(true)
    }
  })
  test('isSafeGlyphs', async () => {
    expect(isSafeGlyphs('(｡◕‿◕｡) zᶻ ⠋')).toBe(true)
    expect(isSafeGlyphs('ᵔ')).toBe(true)
    for (const bad of ['•', '⌒', '˘', '°', '✓', '✗', '●', '🐾', '\t', '\u001b']) expect(isSafeGlyphs(bad)).toBe(false)
  })
})

describe('buddySvg', () => {
  test('every buddy × variant × status × transition × mode × size keeps the SVG rules', async () => {
    for (const b0 of ROSTER) {
      for (const variant of [0, 1]) {
        const b = resolveBuddy({ key: b0.key, variant })
        for (const s of STATUSES) {
          for (const t of TRANSITIONS) {
            for (const mode of MODES) {
              for (const sizePx of [48, 72]) {
                const svg = buddySvg(b, s, { sizePx, transition: t, animations: mode, bubble: s === 'running' ? 'thinking' : undefined })
                expect(svgProblems(svg)).toEqual([])
                expect(svg.length < 40_000).toBe(true)
                if (mode === 'off') expect(/<animate|<set/.test(svg)).toBe(false)
              }
            }
          }
        }
      }
    }
  })
  test('48, 72 and 96 px give a crisp 24-unit grid at that size', async () => {
    const b = resolveBuddy({ key: 'pip', variant: 0 })
    for (const sizePx of [48, 72, 96]) {
      const svg = buddySvg(b, 'idle', { sizePx, transition: null, animations: 'full' })
      expect(svg.includes(`width="${sizePx}" height="${sizePx}"`)).toBe(true)
      expect(svg.includes('viewBox="0 0 24 24"')).toBe(true)
      expect(svg.includes('shape-rendering="crispEdges"')).toBe(true)
      expect(sizePx % 24).toBe(0)
    }
  })
  test('the same inputs give the same string; other inputs give another id', async () => {
    const b = resolveBuddy({ key: 'moss', variant: 0 })
    const o = { sizePx: 48, transition: null, animations: 'full' as const }
    expect(buddySvg(b, 'waiting', o)).toBe(buddySvg(b, 'waiting', o))
    expect(buddySvg(b, 'waiting', o) === buddySvg(b, 'waiting', { ...o, sizePx: 72 })).toBe(false)
    expect(buddySvg(b, 'waiting', o) === buddySvg(resolveBuddy({ key: 'moss', variant: 1 }), 'waiting', o)).toBe(false)
  })
  test('the title names the buddy and the mood; text is escaped', async () => {
    const b = resolveBuddy({ key: 'nib', variant: 0 })
    const svg = buddySvg(b, 'running', { sizePx: 48, transition: null, animations: 'full', bubble: '<b>& "x"' })
    expect(svg.includes('<title>Nib the fox kit: busy, &lt;b&gt;&amp; &quot;x&quot;</title>')).toBe(true)
    expect(svg.includes('<b>')).toBe(false)
    expect(buddySvg(b, 'idle', { sizePx: 48, transition: null, animations: 'full' }).includes('<title>Nib the fox kit: napping</title>')).toBe(true)
  })
  test('each status looks different, and each transition changes the drawing', async () => {
    const b = resolveBuddy({ key: 'tansy', variant: 0 })
    const o = { sizePx: 48, transition: null, animations: 'full' as const }
    const all = STATUSES.map(s => buddySvg(b, s, o))
    expect(new Set(all).size).toBe(STATUSES.length)
    for (const t of TRANSITIONS.slice(1)) expect(buddySvg(b, 'completed', { ...o, transition: t }) === buddySvg(b, 'completed', o)).toBe(false)
  })
  test('calm drops the bounce and the confetti', async () => {
    const b = resolveBuddy({ key: 'bolt', variant: 0 })
    const full = buddySvg(b, 'completed', { sizePx: 48, transition: 'complete', animations: 'full' })
    const calm = buddySvg(b, 'completed', { sizePx: 48, transition: 'complete', animations: 'calm' })
    expect(full.includes('0 -3')).toBe(true)
    expect(calm.includes('0 -3')).toBe(false)
    expect((full.match(/<rect x="12" y="11"/g) ?? []).length).toBe(6)
    expect((calm.match(/<rect x="12" y="11"/g) ?? []).length).toBe(0)
  })
  test('an odd size or a malformed buddy still gives a valid document', async () => {
    const b = { ...resolveBuddy({ key: 'puff', variant: 0 }), body: ['................'] }
    expect(svgProblems(buddySvg(b, 'running', { sizePx: Number.NaN, transition: 'spawn', animations: 'full' }))).toEqual([])
  })
})

describe('emptyDenSvg', () => {
  test('keeps the SVG rules at its sizes', async () => {
    for (const sizePx of [48, 96]) {
      const svg = emptyDenSvg(sizePx)
      expect(svgProblems(svg)).toEqual([])
      expect(svg.includes(`width="${sizePx}" height="${sizePx}"`)).toBe(true)
      expect(emptyDenSvg(sizePx)).toBe(svg)
    }
  })
})
