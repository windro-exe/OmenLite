// Bridge to the .NET host (WebView2 postMessage). In a plain browser it falls back to a simulated laptop,
// so the UI can be designed and screenshotted without touching the BIOS.

export type PerfMode = 'Quiet' | 'Cool' | 'Balanced' | 'Performance'
export type GpuMode = 'Hybrid' | 'Discrete' | 'Optimus'
export const PERF_MODES: PerfMode[] = ['Quiet', 'Cool', 'Balanced', 'Performance']
export const GPU_MODES: GpuMode[] = ['Hybrid', 'Discrete', 'Optimus']

export interface HwState {
  available: boolean
  model: string
  bios: string
  perf: PerfMode
  maxFan: boolean
  manualRpm: number | null
  /** Hex colours in BIOS index order: 0 Right, 1 Middle, 2 Left, 3 WASD */
  zones: string[]
  backlight: boolean
  /** null when the laptop has no graphics switch (MUX). */
  gpuMode: GpuMode | null
  /** false when the laptop has no 4-zone RGB keyboard. */
  fourZone: boolean
  /** BIOS keyboard type (HP WMI 0x20008/0x2B): 1 with number pad, 2 without; null when the BIOS doesn't say. */
  keyboardType: number | null
  /** Manual fan range for this laptop in rpm, read from the BIOS fan table. */
  fanMin: number
  fanMax: number
  boost: boolean
  autostart: boolean
}

export interface Telemetry {
  cpuTemp: number
  gpuTemp: number | null
  cpuFan: number
  gpuFan: number
  cpuLoad: number
  gpuPower: number | null
}

export interface BoostResult { on: boolean; target: string; trimmed: number }
export interface CleanResult { freedMb: number; files: number; trimmed: number }

export interface Commands {
  getState: [void, HwState]
  setPerf: [PerfMode, void]
  setMaxFan: [boolean, void]
  /** rpm, or null to hand fans back to automatic */
  setManualFan: [number | null, void]
  setZones: [string[], void]
  setBacklight: [boolean, void]
  setGpuMode: [GpuMode, void]
  setBoost: [boolean, BoostResult]
  cleanCache: [void, CleanResult]
  setAutostart: [boolean, void]
  'win.drag': [void, void]
  'win.minimize': [void, void]
  'win.close': [void, void]
}

type Listener = (t: Telemetry) => void

interface WebView { postMessage(m: unknown): void; addEventListener(t: 'message', f: (e: { data: unknown }) => void): void }
declare global {
  // WebView2 injects window.chrome.webview; absent in a normal browser.
  interface Window { chrome?: { webview?: WebView } }
}
const webview = window.chrome?.webview

export const isNative = !!webview
const listeners = new Set<Listener>()

export function onTelemetry(l: Listener) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

type Call = <K extends keyof Commands>(cmd: K, arg?: Commands[K][0]) => Promise<Commands[K][1]>
let call: Call

/** Host → page message: either a telemetry push or a reply to a call. */
type HostMessage =
  | { event: 'telemetry'; data: Telemetry }
  | { id: number; ok: boolean; data?: unknown; error?: string }

if (webview) {
  let seq = 0
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  webview.addEventListener('message', ({ data }) => {
    // shortcut: host is our own trusted .NET process; shape is not schema-validated.
    const m = data as HostMessage
    if ('event' in m) { listeners.forEach(l => l(m.data)); return }
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.ok) p.resolve(m.data)
    else p.reject(new Error(m.error ?? 'Unknown error'))
  })
  call = ((cmd: keyof Commands, arg?: unknown) => {
    const id = ++seq
    const { promise, resolve, reject } = Promise.withResolvers<unknown>()
    pending.set(id, { resolve, reject })
    webview.postMessage({ id, cmd, arg: arg ?? null })
    return promise
  }) as Call // per-command result types are enforced by the Commands map at call sites
} else {
  call = mockCall as Call
  startMockTelemetry()
}

export { call }

// ---------------- simulated laptop ----------------

let savedPerf: PerfMode = 'Balanced' // thermal mode to restore when boost ends
const mock: HwState = {
  available: true,
  model: 'OMEN by HP 16.1 inch Gaming Laptop PC',
  bios: 'F.27',
  perf: 'Balanced',
  maxFan: false,
  manualRpm: null,
  fanMin: 2400,
  fanMax: 5800,
  zones: ['#BF1E1E', '#BF1E1E', '#BF1E1E', '#BF1E1E'],
  backlight: true,
  gpuMode: 'Discrete',
  fourZone: true,
  keyboardType: 2,
  boost: false,
  autostart: false,
}

function wait(ms: number) {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

// Mock mirrors the host contract; args are trusted because they come from our own typed `call`.
async function mockCall(cmd: keyof Commands, arg: unknown): Promise<unknown> {
  await wait(120 + Math.random() * 180) // BIOS calls are not instant
  switch (cmd) {
    case 'getState': return structuredClone(mock)
    case 'setPerf': mock.perf = arg as PerfMode; return
    case 'setMaxFan': mock.maxFan = arg === true; if (arg === true) mock.manualRpm = null; return
    case 'setManualFan': mock.manualRpm = typeof arg === 'number' ? arg : null; return
    case 'setZones': mock.zones = [...(arg as string[])]; return
    case 'setBacklight': mock.backlight = arg === true; return
    case 'setGpuMode': mock.gpuMode = arg as GpuMode; return
    case 'setBoost': {
      await wait(500)
      const on = arg === true
      if (on && !mock.boost) { savedPerf = mock.perf; mock.perf = 'Performance' }
      if (!on && mock.boost) mock.perf = savedPerf
      mock.boost = on
      return { on, target: on ? 'Cyberpunk2077' : '', trimmed: on ? 142 : 0 } satisfies BoostResult
    }
    case 'cleanCache':
      await wait(1400)
      return { freedMb: 812.4, files: 3271, trimmed: 168 } satisfies CleanResult
    case 'setAutostart': mock.autostart = arg === true; return
    default: return
  }
}

function startMockTelemetry() {
  let cpu = 46, gpu = 58, load = 12, f1 = 3300, f2 = 3000
  setInterval(() => {
    const heat = { Quiet: -6, Cool: -4, Balanced: 0, Performance: 9 }[mock.perf] + (mock.boost ? 6 : 0)
    load = clamp(load + (Math.random() - 0.5) * 14 + (mock.boost ? 3 : 0), 3, 96)
    cpu = clamp(cpu + (44 + load * 0.42 + heat - cpu) * 0.25 + (Math.random() - 0.5) * 2, 35, 98)
    gpu = clamp(gpu + (52 + load * 0.25 + heat * 0.6 - gpu) * 0.2 + (Math.random() - 0.5), 35, 92)
    const target = mock.maxFan ? mock.fanMax : mock.manualRpm ?? 1800 + (cpu - 40) * 70
    f1 += (target - f1) * 0.3
    f2 += (target - 200 - f2) * 0.3
    const t: Telemetry = {
      cpuTemp: Math.round(cpu), gpuTemp: Math.round(gpu), cpuLoad: load,
      cpuFan: Math.round(f1 / 100) * 100, gpuFan: Math.round(f2 / 100) * 100,
      gpuPower: Math.round(18 + load * 0.9 + heat),
    }
    listeners.forEach(l => l(t))
  }, 1000)
}

function clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, v)) }
