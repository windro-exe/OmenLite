// Keyboard drawings, chosen by the type the BIOS reports (HP WMI 0x20008 / 0x2B).
// Geometry is our own, in key units, written from the measured key positions and zone splits of OMEN 16 boards.
// Zones are BIOS indices: 0 Right, 1 Middle, 2 Left, 3 WASD.
// shortcut: number-pad board's right-hand legends are unverified; fix them when someone with that board reports.

export interface Key { label: string; x: number; y: number; w: number; h: number; zone: number }
export interface KeyboardLayout { name: string; keys: Key[]; width: number; height: number }

type Row = [label: string, width: number, zone: number][]

const R = 0, M = 1, L = 2, W = 3

/** Lays out rows left to right; plain numbers are gaps (in key units). */
function build(rows: { y: number; h: number; x0?: number; keys: ([string, number, number] | number)[] }[]): Key[] {
  const keys: Key[] = []
  for (const row of rows) {
    let x = row.x0 ?? 0
    for (const k of row.keys) {
      if (typeof k === 'number') { x += k; continue }
      const [label, w, zone] = k
      keys.push({ label, x, y: row.y, w, h: row.h, zone })
      x += w
    }
  }
  return keys
}

const fn = (from: number, to: number, zone: number): Row => Array.from({ length: to - from + 1 }, (_, i) => [`f${from + i}`, 0.947, zone])
const chars = (s: string, zone: number, w = 1): Row => [...s].map(c => [c, w, zone])

// Main block, 14.2 units wide, shared by the compact and number-pad boards.
const MAIN_TOP: Row = [['esc', 0.947, L], ...fn(1, 5, L), ...fn(6, 12, M), ['⏻', 0.947, R], ['delete', 0.947, R]]
const MAIN_ROWS = [
  [['`', 0.8, L], ...chars('12345', L), ...chars('67890-=', M), ['⌫', 1.4, R]] as Row,
  [['tab', 1.3, L], ['Q', 1, L], ['W', 1, W], ['E', 1, L], ['R', 1, L], ...chars('TYUIOP[]', M), ['\\', 0.9, R]] as Row,
  [['caps', 1.5, L], ['A', 1, W], ['S', 1, W], ['D', 1, W], ['F', 1, L], ...chars("GHJKL;'", M), ['enter', 1.7, R]] as Row,
  [['shift', 2, L], ...chars('ZXCV', L), ...chars('BNM,./', M), ['shift', 2.2, R]] as Row,
]

/** 4-zone, no number pad (BIOS type 2): OMEN 16 (2022), legends checked against a photo of board 8A44. */
const COMPACT: KeyboardLayout = {
  name: 'OMEN 4-zone, no number pad',
  width: 17.35,
  height: 5.8,
  keys: build([
    { y: 0, h: 0.8, keys: [...MAIN_TOP, 0.3, ['◆', 0.95, R], ['calc', 0.95, R], ['prt sc', 0.95, R]] },
    { y: 0.8, h: 1, keys: [...MAIN_ROWS[0], 0.3, ['insert', 0.95, R], ['home', 0.95, R], ['pg up', 0.95, R]] },
    { y: 1.8, h: 1, keys: [...MAIN_ROWS[1], 0.3, ['pause', 0.95, R], ['end', 0.95, R], ['pg dn', 0.95, R]] },
    { y: 2.8, h: 1, keys: MAIN_ROWS[2] },
    { y: 3.8, h: 1, keys: [...MAIN_ROWS[3], 1.25, ['↑', 0.95, R]] },
    { y: 4.8, h: 1, keys: [['ctrl', 1, L], ['fn', 1, L], ['⊞', 1, L], ['alt', 1, L], ['', 6.4, M], ['alt', 1, M], ['☰', 1, M], ['fn', 1, R], ['ctrl', 0.8, R], 0.3, ['←', 0.95, R], ['↓', 0.95, R], ['→', 0.95, R]] },
  ]),
}

/** 4-zone with a full number pad (BIOS type 1). */
const NUMPAD: KeyboardLayout = {
  name: 'OMEN 4-zone with number pad',
  width: 18.6,
  height: 5.8,
  keys: build([
    { y: 0, h: 0.8, keys: [...MAIN_TOP, 0.4, ['home', 1, R], ['pg up', 1, R], ['pg dn', 1, R], ['end', 1, R]] },
    { y: 0.8, h: 1, keys: [...MAIN_ROWS[0], 0.4, ['num', 1, R], ['/', 1, R], ['*', 1, R], ['−', 1, R]] },
    { y: 1.8, h: 1, keys: [...MAIN_ROWS[1], 0.4, ['7', 1, R], ['8', 1, R], ['9', 1, R]] },
    { y: 2.8, h: 1, keys: [...MAIN_ROWS[2], 0.4, ['4', 1, R], ['5', 1, R], ['6', 1, R]] },
    { y: 3.8, h: 1, keys: [...MAIN_ROWS[3], 0.4, ['1', 1, R], ['2', 1, R], ['3', 1, R]] },
    { y: 4.8, h: 1, keys: [['ctrl', 1, L], ['fn', 1, L], ['⊞', 1, L], ['alt', 1, L], ['', 5.4, M], ['alt', 1, M], ['ctrl', 1, M], ['←', 0.93, R], ['↑↓', 0.93, R], ['→', 0.94, R], 0.4, ['0', 2, R], ['.', 1, R]] },
    { y: 1.8, h: 2, x0: 17.6, keys: [['+', 1, R]] },
    { y: 3.8, h: 2, x0: 17.6, keys: [['↵', 1, R]] },
  ]),
}

/** BIOS keyboard type → drawing. Unknown types return null and the UI falls back to a plain 4-zone strip. */
export function layoutFor(type: number | null | undefined): KeyboardLayout | null {
  if (type === 2) return COMPACT
  if (type === 1) return NUMPAD
  return null
}

/** Unrecognised keyboard: the four zones as plain blocks, in physical order, so painting still works. */
export const FALLBACK: KeyboardLayout = {
  name: 'Unrecognised keyboard, showing the 4 lighting zones',
  width: 17.35,
  height: 2.4,
  keys: build([{ y: 0, h: 2.4, keys: [['Left', 5, L], ['WASD', 3, W], ['Middle', 5, M], ['Right', 4.35, R]] }]),
}

/** Where each zone's label sits under the drawing: centre of its keys, pushed apart so neighbours never touch. */
export function zoneLabelX(layout: KeyboardLayout, order: number[], minGap = 2.8): Record<number, number> {
  const x: Record<number, number> = {}
  for (const z of order) {
    const ks = layout.keys.filter(k => k.zone === z)
    x[z] = ks.length ? ks.reduce((s, k) => s + k.x + k.w / 2, 0) / ks.length : 0
  }
  for (let i = 1; i < order.length; i++) x[order[i]] = Math.max(x[order[i]], x[order[i - 1]] + minGap)
  return x
}
