// Bridge to the .NET host (WebView2 postMessage). In a plain browser it falls back to a simulated laptop,
// so the UI can be designed and screenshotted without touching the BIOS.

export type PerfMode = 'Quiet' | 'Cool' | 'Balanced' | 'Performance'
export type GpuMode = 'Hybrid' | 'Discrete' | 'Optimus'
export const PERF_MODES: PerfMode[] = ['Quiet', 'Cool', 'Balanced', 'Performance']

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
  /** Graphics modes this laptop's BIOS supports (Optimus only on some models). */
  gpuModes: GpuMode[]
  /** false when the laptop has no 4-zone RGB keyboard. */
  fourZone: boolean
  /** BIOS keyboard type (HP WMI 0x20008/0x2B): 1 with number pad, 2 without; null when the BIOS doesn't say. */
  keyboardType: number | null
  /** Manual fan range for this laptop in rpm, read from the BIOS fan table. */
  fanMin: number
  fanMax: number
  boost: boolean
  /** Heat alert threshold in °C; 0 = off. */
  alertTemp: number
  autostart: boolean
}

export interface Telemetry {
  cpuTemp: number
  gpuTemp: number | null
  cpuFan: number
  gpuFan: number
  cpuLoad: number
  gpuPower: number | null
  gpuClock: number | null // MHz
  gpuMemClock: number | null // MHz
  vramUsed: number | null // MiB
  vramTotal: number | null // MiB
  gpuLoad: number | null // %
  powerLimit: number | null // W, often unreported
  /** NVIDIA performance state, e.g. "P8". */
  gpuState: string | null
}

/** Oldest first, one sample per `stepS` seconds; arrays have equal length. `endMs` is the newest sample's unix time. */
export interface History { stepS: number; endMs: number; cpu: number[]; gpu: (number | null)[]; fan: number[] }

/** Recorded while Game Boost is on. `secondsHot` = time with CPU or GPU at 85 °C or more. */
export interface Session {
  game: string; startMs: number; seconds: number
  avgCpu: number; peakCpu: number; avgGpu: number | null; peakGpu: number | null
  secondsHot: number; active: boolean
}

export interface Power {
  present: boolean
  percent: number | null
  state: 'charging' | 'discharging' | 'full' | 'plugged'
  acOnline: boolean
  /** Charge or discharge rate in W. */
  watts: number | null
  minutesLeft: number | null
  /** Full-charge capacity. */
  capacityWh: number | null
  designWh: number | null
  /** 0..100, how much capacity has been lost. */
  wearPct: number | null
  /** 'below': the charger is weaker than this laptop needs. */
  adapterStatus: 'ok' | 'below' | 'battery' | 'notFunctioning' | 'typeC' | 'unknown'
  adapterWatts: number | null
}

export interface SystemInfo {
  model: string; board: string; bios: string; appVersion: string
  thermalPolicy: number | null
  fanCount: number | null
  fanMin: number; fanMax: number
  keyboardType: number | null
  fourZone: boolean
  gpuModes: GpuMode[]
  gpuMode: GpuMode | null
  /** HP OMEN Gaming Hub: is it installed, and does its saved state match the hardware (null = unknown)? */
  hub: { installed: boolean; inSync: boolean | null; differences: string[] }
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
  /** 0 = off, otherwise 80..100 */
  setAlert: [number, void]
  getHistory: [void, History]
  /** Newest first. */
  getSessions: [void, Session[]]
  getPower: [void, Power]
  getSystem: [void, SystemInfo]
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
  gpuModes: ['Hybrid', 'Discrete'],
  fourZone: true,
  keyboardType: 2,
  boost: false,
  autostart: false,
  alertTemp: 95,
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
    case 'setAlert': mock.alertTemp = arg as number; return
    case 'getHistory': {
      const stepS = 10, n = 2160, endMs = Date.now()
      const cpu: number[] = [], gpu: number[] = [], fan: number[] = []
      for (let i = 0; i < n; i++) {
        // Slow load waves plus jitter; a hot gaming stretch about two hours ago.
        const wave = Math.sin(i / 90) * 8 + Math.sin(i / 23) * 4
        const game = i > n - 780 && i < n - 560 ? 30 : 0
        const c = clamp(52 + wave + game + (Math.random() - 0.5) * 3, 38, 97)
        cpu.push(Math.round(c))
        gpu.push(Math.round(clamp(48 + wave * 0.6 + game * 0.8 + (Math.random() - 0.5) * 2, 36, 90)))
        fan.push(Math.round((1800 + (c - 40) * 70) / 100) * 100)
      }
      return { stepS, endMs, cpu, gpu, fan } satisfies History
    }
    case 'getSessions': {
      const now = Date.now(), h = 3600_000
      const done: Session[] = [
        { game: 'Cyberpunk2077', startMs: now - 26 * h, seconds: 5400, avgCpu: 78, peakCpu: 91, avgGpu: 74, peakGpu: 83, secondsHot: 640, active: false },
        { game: 'Elden Ring', startMs: now - 50 * h, seconds: 2520, avgCpu: 71, peakCpu: 84, avgGpu: 69, peakGpu: 79, secondsHot: 0, active: false },
        { game: 'Hades', startMs: now - 74 * h, seconds: 960, avgCpu: 58, peakCpu: 66, avgGpu: null, peakGpu: null, secondsHot: 0, active: false },
      ]
      return mock.boost
        ? [{ game: 'Cyberpunk2077', startMs: now - 12 * 60_000, seconds: 720, avgCpu: 80, peakCpu: 88, avgGpu: 75, peakGpu: 82, secondsHot: 60, active: true }, ...done]
        : done
    }
    case 'getPower': return {
      present: true, percent: 64, state: 'charging', acOnline: true, watts: 38, minutesLeft: 52,
      capacityWh: 68.4, designWh: 83, wearPct: 18, adapterStatus: 'below', adapterWatts: 150,
    } satisfies Power
    case 'getSystem': return {
      model: mock.model, board: '8A44', bios: mock.bios, appVersion: '0.4.0', thermalPolicy: 1, fanCount: 2,
      fanMin: mock.fanMin, fanMax: mock.fanMax, keyboardType: mock.keyboardType, fourZone: mock.fourZone,
      gpuModes: mock.gpuModes, gpuMode: mock.gpuMode,
      hub: { installed: true, inSync: false, differences: ['Keyboard colours'] },
    } satisfies SystemInfo
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
      gpuClock: Math.round(600 + load * 14), gpuMemClock: load > 20 ? 7001 : 810,
      vramUsed: Math.round(900 + load * 52), vramTotal: 8188, gpuLoad: Math.round(load * 0.8),
      powerLimit: null, gpuState: load > 20 ? 'P0' : 'P8',
    }
    listeners.forEach(l => l(t))
  }, 1000)
}

function clamp(v: number, a: number, b: number) { return Math.min(b, Math.max(a, v)) }
