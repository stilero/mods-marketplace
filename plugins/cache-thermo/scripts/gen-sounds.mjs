#!/usr/bin/env node
// Regenerates the cache-thermo chimes in ../sounds as 8-bit mono 22050 Hz WAV files (soft triangle waves). No dependencies.
//   node scripts/gen-sounds.mjs
// warm.wav   soft two-note descending bleep        (hot → warm)
// cold.wav   three-note minor descending alarm     (warm → cold)
// gate.wav   short rising "attention" arpeggio     (cold-cache dialog opens)
// resume.wav cheerful rising two-note              (break ends / cache refreshed)

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 22050
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sounds')

const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, Bb4: 466.16, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, C6: 1046.5, E6: 1318.5 }

const square = p => (p < 0.5 ? 1 : -1)
const triangle = p => 4 * Math.abs(p - Math.floor(p + 0.5)) - 1

/** One note: `len` seconds of `wave` at `freq`, attack 3 ms, exponential decay, `gap` seconds of silence after. */
function note({ freq, len, wave = square, gain = 0.5, decay = 9, gap = 0.015 }) {
  const n = Math.round(len * RATE)
  const out = new Float32Array(n + Math.round(gap * RATE))
  const attack = Math.round(0.003 * RATE)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const env = Math.min(1, i / attack) * Math.exp(-decay * t)
    out[i] = wave((t * freq) % 1) * env * gain
  }
  return out
}

function concat(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Float32Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** 8-bit unsigned PCM, mono, 22050 Hz. */
function wav(samples) {
  const data = Buffer.alloc(samples.length)
  for (let i = 0; i < samples.length; i++) data[i] = Math.round(128 + Math.max(-1, Math.min(1, samples[i])) * 127)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const SOUNDS = {
  // Soft and a little wistful: Ember is fading.
  warm: [
    note({ freq: NOTE.E5, len: 0.12, wave: triangle, gain: 0.6, decay: 7 }),
    note({ freq: NOTE.C5, len: 0.18, wave: triangle, gain: 0.6, decay: 6 }),
  ],
  // Gentle minor descending chime: the cache went cold.
  cold: [
    note({ freq: NOTE.A4, len: 0.08, wave: triangle, gain: 0.6, decay: 9, gap: 0.01 }),
    note({ freq: NOTE.F4, len: 0.08, wave: triangle, gain: 0.6, decay: 9, gap: 0.01 }),
    note({ freq: NOTE.D4, len: 0.13, wave: triangle, gain: 0.6, decay: 6 }),
  ],
  // Soft rising arpeggio for the gate dialog.
  gate: [
    note({ freq: NOTE.C5, len: 0.07, wave: triangle, gain: 0.6, decay: 10, gap: 0.008 }),
    note({ freq: NOTE.E5, len: 0.07, wave: triangle, gain: 0.6, decay: 10, gap: 0.008 }),
    note({ freq: NOTE.G5, len: 0.07, wave: triangle, gain: 0.6, decay: 10, gap: 0.008 }),
    note({ freq: NOTE.C6, len: 0.1, wave: triangle, gain: 0.6, decay: 7, gap: 0.008 }),
  ],
  // Cheerful rising two-note: back to work, cache warm.
  resume: [
    note({ freq: NOTE.G5, len: 0.1, wave: triangle, gain: 0.6, decay: 8 }),
    note({ freq: NOTE.C6, len: 0.18, wave: triangle, gain: 0.6, decay: 6 }),
  ],
}

mkdirSync(OUT, { recursive: true })
for (const [name, parts] of Object.entries(SOUNDS)) {
  const samples = concat(parts)
  const bytes = wav(samples)
  const seconds = samples.length / RATE
  if (seconds > 0.35 || bytes.length > 20 * 1024) throw new Error(`${name}: ${seconds.toFixed(3)} s, ${bytes.length} bytes exceeds the budget`)
  writeFileSync(join(OUT, `${name}.wav`), bytes)
  console.log(`${name}.wav  ${seconds.toFixed(3)} s  ${bytes.length} bytes`)
}
