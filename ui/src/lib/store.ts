import { useSyncExternalStore } from 'react'
import { call, onTelemetry, type Commands, type HwState, type Telemetry } from './bridge'

export interface Toast {
  id: number
  tone: 'ok' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

interface State {
  hw: HwState | null
  t: Telemetry | null
  cpuHist: number[]
  gpuHist: number[]
  busy: Record<string, boolean>
  toasts: Toast[]
}

const HISTORY = 60 // seconds of live graph

let state: State = { hw: null, t: null, cpuHist: [], gpuHist: [], busy: {}, toasts: [] }
const subs = new Set<() => void>()

function set(patch: (s: State) => Partial<State>) {
  state = { ...state, ...patch(state) }
  subs.forEach(f => f())
}

/** Selector must return a stable reference (a field, not a fresh object). */
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => sel(state))
}

let toastSeq = 0
export function toast(text: string, tone: Toast['tone'] = 'ok', action?: Toast['action']) {
  const id = ++toastSeq
  set(s => ({ toasts: [...s.toasts.slice(-2), { id, text, tone, action }] }))
  setTimeout(() => dismissToast(id), action ? 6000 : tone === 'error' ? 5000 : 2600)
}
export function dismissToast(id: number) {
  set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
}
export function clearToasts() {
  if (state.toasts.length) set(() => ({ toasts: [] }))
}

export type WriteResult<R> = { ok: true; data: R } | { ok: false }

/**
 * Optimistic hardware write: patch local state, call the host, roll back with an error toast on failure.
 * `busyKey` lets controls show a pending state while the BIOS call is in flight.
 */
export async function write<K extends keyof Commands>(
  busyKey: string, patch: Partial<HwState>, cmd: K, arg: Commands[K][0],
): Promise<WriteResult<Commands[K][1]>> {
  const before = state.hw
  if (!before) return { ok: false }
  set(s => ({ hw: { ...before, ...patch }, busy: { ...s.busy, [busyKey]: true } }))
  try {
    const data = await call(cmd, arg)
    return { ok: true, data }
  } catch (e) {
    const rollback = Object.fromEntries(Object.keys(patch).map(k => [k, before[k as keyof HwState]]))
    set(s => ({ hw: s.hw && { ...s.hw, ...rollback } }))
    toast(e instanceof Error ? e.message : String(e), 'error')
    return { ok: false }
  } finally {
    set(s => ({ busy: { ...s.busy, [busyKey]: false } }))
  }
}

/** Re-reads hardware state, for changes the host made as a side effect (e.g. boost sets Performance). */
export async function refreshHw() {
  const hw = await call('getState')
  set(() => ({ hw }))
}

/** Current hardware state for event handlers (components should use useStore). */
export function currentHw() {
  return state.hw
}

call('getState').then(hw => set(() => ({ hw })), e => toast(String(e), 'error'))
// First sample seeds a flat 60 s history so the graph is full from the first frame.
onTelemetry(t => set(s => ({
  t,
  cpuHist: s.cpuHist.length ? [...s.cpuHist, t.cpuTemp].slice(-HISTORY) : Array(HISTORY).fill(t.cpuTemp),
  gpuHist: s.gpuHist.length ? [...s.gpuHist, t.gpuTemp ?? 0].slice(-HISTORY) : Array(HISTORY).fill(t.gpuTemp ?? 0),
})))
