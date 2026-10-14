import type { GpuMode, PerfMode } from './bridge'
import { currentHw, refreshHw, toast, write } from './store'

// Success is shown in place by each control (DESIGN.md §8); toasts are for errors and Undo only.

export const ZONE_NAMES = ['Right', 'Middle', 'Left', 'WASD'] // by BIOS index
export const PHYSICAL_ORDER = [2, 3, 1, 0] // left → right on the keyboard

export function setPerf(mode: PerfMode) {
  if (currentHw()?.perf === mode) return
  return write('perf', { perf: mode }, 'setPerf', mode)
}

export function setMaxFan(on: boolean) {
  return write('fan', on ? { maxFan: true, manualRpm: null } : { maxFan: false }, 'setMaxFan', on)
}

/** rpm, or null for automatic. */
export function setManualFan(rpm: number | null) {
  return write('fan', { manualRpm: rpm, maxFan: false }, 'setManualFan', rpm)
}

/** Applies zone colours (BIOS order) with an Undo toast. */
export async function setZones(zones: string[], message: string) {
  const prev = currentHw()?.zones
  const r = await write('zones', { zones }, 'setZones', zones)
  if (r.ok && prev) toast(message, 'ok', { label: 'Undo', run: () => void write('zones', { zones: prev }, 'setZones', prev) })
}

export function setBacklight(on: boolean) {
  return write('backlight', { backlight: on }, 'setBacklight', on)
}

export function setGpuMode(mode: GpuMode) {
  return write('gpu', { gpuMode: mode }, 'setGpuMode', mode)
}

export async function setBoost(on: boolean) {
  const r = await write('boost', { boost: on }, 'setBoost', on)
  if (!r.ok) return null
  await refreshHw() // boost changes (and later restores) the thermal mode host-side
  return r.data
}

export function setAutostart(on: boolean) {
  return write('autostart', { autostart: on }, 'setAutostart', on)
}
