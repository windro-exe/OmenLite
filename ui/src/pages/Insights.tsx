import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { call, type Commands, type Power, type SystemInfo } from '../lib/bridge'
import { toast, useStore } from '../lib/store'
import { Button, Lockup, Num, Segmented, cx, heatTone } from '../components/ui'

const VIEWS = ['History', 'Sessions', 'Power', 'GPU', 'System'] as const
type View = typeof VIEWS[number]

/** Insights: five read-only views, each one subject. Only the visible view mounts, so only it polls. */
export function Insights() {
  const [view, setView] = useState<View>('History')
  return (
    <div className="relative size-full">
      <div className="absolute left-14 top-6 z-10 flex items-center gap-8">
        <h1 className="text-[22px] font-normal tracking-[-0.02em]">Insights</h1>
        <Segmented<View> label="Insights view" options={VIEWS} value={view} onChange={setView} />
      </div>
      <motion.div key={view} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.1, ease: 'linear' }}>
        {view === 'History' && <HistoryView />}
        {view === 'Sessions' && <SessionsView />}
        {view === 'Power' && <PowerView />}
        {view === 'GPU' && <GpuView />}
        {view === 'System' && <SystemView />}
      </motion.div>
    </div>
  )
}

/** undefined while loading, null when the host call failed (the last good value is kept). Skips ticks while hidden. */
function usePoll<K extends 'getHistory' | 'getSessions' | 'getPower' | 'getSystem'>(cmd: K, ms: number | null) {
  const [data, setData] = useState<Commands[K][1] | null | undefined>()
  useEffect(() => {
    const load = () => { call(cmd).then(setData, () => setData(d => d ?? null)) }
    load()
    if (ms == null) return
    const id = setInterval(() => { if (!document.hidden) load() }, ms)
    return () => clearInterval(id)
  }, [cmd, ms])
  return data
}

const num = (v: number | null | undefined, unit: string) => (v == null ? '—' : `${Math.round(v).toLocaleString()} ${unit}`)
const dec = (v: number | null) => (v == null ? '—' : String(Math.round(v * 10) / 10))

function duration(seconds: number) {
  const m = Math.round(seconds / 60)
  if (m < 1) return '<1 min'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

const Note = ({ children }: { children: ReactNode }) => (
  <div className="absolute inset-0 grid place-items-center pb-24 text-[13px] text-t3">{children}</div>
)

function ListRow({ label, value, note, tone, bar }: { label: string; value: string; note?: string; tone?: 'amber' | 'red'; bar?: number | null }) {
  return (
    <div className="py-3">
      <div className="flex min-h-[22px] items-baseline justify-between gap-8">
        <span className="text-t2">{label}</span>
        <span className={cx('tabular text-right', tone === 'red' ? 'text-red' : tone === 'amber' ? 'text-amber' : 'text-t1')}>{value}</span>
      </div>
      {note && <div className="mt-1 max-w-[420px] leading-snug text-t3">{note}</div>}
      {bar != null && (
        <div className="mt-2.5 h-0.5 overflow-hidden rounded-full bg-hairline">
          <div className="h-full origin-left rounded-full bg-t2 motion-reduce:!transition-none"
            style={{ transform: `scaleX(${bar})`, transition: 'transform 600ms var(--ease-house)' }} />
        </div>
      )}
    </div>
  )
}

/** Hero reading on the left, flush hairline list on the right. */
function Split({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="absolute left-[120px] top-[190px]">{hero}</div>
      <div className="absolute right-14 top-[120px] max-h-[540px] w-[560px] divide-y divide-hairline overflow-y-auto">{children}</div>
    </>
  )
}

function Hero({ label, value, unit, word, tone }: { label: string; value: number | null | undefined; unit: string; word?: string; tone?: 'amber' | 'red' }) {
  return (
    <div className="flex flex-col">
      <span className="mono-label">{label}</span>
      <Num value={value} unit={unit}
        className={cx('mt-2 text-[128px] font-normal leading-[0.9] tracking-[-0.05em]', tone === 'red' ? 'text-red' : tone === 'amber' ? 'text-amber' : 'text-t1')} />
      {word && <span className={cx('mono-label mt-4', tone === 'red' ? 'text-red' : tone === 'amber' ? 'text-amber' : '')}>{word}</span>}
    </div>
  )
}

const toneOf = (v: number | null | undefined) => {
  const h = v == null ? 'white' : heatTone(v)
  return h === 'white' ? undefined : h
}

// ---------------- history ----------------

const RANGES = { '15 min': 90, '1 h': 360, '6 h': 2160 } as const // samples at 10 s each
type Range = keyof typeof RANGES
const RANGE_OPTIONS = ['15 min', '1 h', '6 h'] as const

const W = 820, H = 440, L = 36, R = 88, T = 12, B = 30
const PW = W - L - R, PH = H - T - B
// Fixed 30–100 °C like the Home horizon, so the picture stays calm and comparable.
const yTemp = (v: number) => T + PH * (1 - (Math.min(100, Math.max(30, v)) - 30) / 70)

/** Bucket-mean down to at most `max` points; keeps each point's (fractional) source index for x placement. */
function decimate(v: readonly (number | null)[], max: number): [number, number][] {
  const step = Math.ceil(v.length / max)
  const out: [number, number][] = []
  for (let s = 0; s < v.length; s += step) {
    const b = v.slice(s, s + step).filter((x): x is number => x != null)
    if (b.length) out.push([s + (Math.min(step, v.length - s) - 1) / 2, b.reduce((a, x) => a + x, 0) / b.length])
  }
  return out
}

function stats(v: readonly (number | null)[]) {
  const a = v.filter((x): x is number => x != null)
  return a.length ? { min: Math.min(...a), max: Math.max(...a), avg: a.reduce((s, x) => s + x, 0) / a.length } : null
}

function HistoryView() {
  const h = usePoll('getHistory', 10_000)
  const alertTemp = useStore(s => s.hw?.alertTemp ?? 0)
  const [range, setRange] = useState<Range>('1 h')
  if (h === undefined) return null
  if (h === null) return <Note>Not available on this laptop.</Note>
  if (h.cpu.length < 3) return <Note>Collecting… history builds while OmenLite runs.</Note>

  const n = RANGES[range]
  const cpu = h.cpu.slice(-n), gpu = h.gpu.slice(-n), fan = h.fan.slice(-n)
  // Right-aligned; while the history is younger than the range the scale shrinks to what exists, so the line isn't a stub.
  const span = Math.min(n, Math.max(cpu.length, 18))
  const ago = span === n ? `${range} ago` : `${Math.max(1, Math.round(span * 10 / 60))} min ago`
  const x = (i: number) => L + PW - (cpu.length - 1 - i) * PW / (span - 1)
  const fanTop = Math.max(1, ...fan)
  const yFan = (v: number) => T + PH - (v / fanTop) * PH * 0.28
  const pts = (d: [number, number][], y: (v: number) => number) => d.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')
  const cs = stats(cpu), gs = stats(gpu)
  const lastCpu = cpu[cpu.length - 1], lastGpu = gpu[gpu.length - 1], lastFan = fan[fan.length - 1]
  const yCpu = yTemp(lastCpu)
  let yGpu = lastGpu == null ? 0 : yTemp(lastGpu)
  if (Math.abs(yGpu - yCpu) < 14) yGpu = yCpu + (yGpu >= yCpu ? 14 : -14) // keep the direct labels apart
  const label = 'fill-t3 font-mono text-[11px]'
  let yFanLabel = yFan(lastFan)
  while ([yCpu, lastGpu == null ? -99 : yGpu].some(y => Math.abs(y - yFanLabel) < 14)) yFanLabel += 14

  return (
    <>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute left-14 top-[120px]" role="img"
        aria-label={`CPU and GPU temperature over the last ${range}`}>
        {[40, 60, 80, 100].map(v => (
          <g key={v}>
            <line x1={L} x2={L + PW} y1={yTemp(v)} y2={yTemp(v)} stroke="white" strokeOpacity="0.06" />
            <text x={L - 8} y={yTemp(v) + 4} textAnchor="end" className="fill-t4 font-mono text-[11px]">{v}</text>
          </g>
        ))}
        {alertTemp > 30 && alertTemp <= 100 && (
          <g>
            <line x1={L} x2={L + PW} y1={yTemp(alertTemp)} y2={yTemp(alertTemp)} stroke="white" strokeOpacity="0.22" strokeDasharray="2 5" />
            <text x={L + 6} y={yTemp(alertTemp) - 6} className="fill-t4 font-mono text-[11px]">alert {alertTemp}°</text>
          </g>
        )}
        <polyline points={pts(decimate(fan, 300), yFan)} fill="none" stroke="white" strokeOpacity="0.18" strokeWidth="1" strokeLinejoin="round" />
        <polyline points={pts(decimate(gpu, 300), yTemp)} fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="1.5" strokeLinejoin="round" />
        <polyline points={pts(decimate(cpu, 300), yTemp)} fill="none" stroke="white" strokeOpacity="0.92" strokeWidth="1.75" strokeLinejoin="round" />
        <text x={L + PW + 10} y={yCpu + 4} className="fill-t1 font-mono text-[11px]">cpu {lastCpu}°</text>
        {lastGpu != null && <text x={L + PW + 10} y={yGpu + 4} className={label}>gpu {lastGpu}°</text>}
        <text x={L + PW + 10} y={yFanLabel + 4} className="fill-t4 font-mono text-[11px]">fan {lastFan.toLocaleString()}</text>
        <text x={L} y={H - 6} className={label}>{ago}</text>
        <text x={L + PW} y={H - 6} textAnchor="end" className={label}>now</text>
      </svg>

      <div className="absolute right-14 top-[120px] flex flex-col gap-10">
        <Segmented<Range> label="History range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
        <div className="grid grid-flow-col grid-rows-3 gap-x-10 gap-y-8">
          <Lockup label="cpu max" value={cs?.max} unit="°C" tone={toneOf(cs?.max)} />
          <Lockup label="cpu avg" value={cs?.avg} unit="°C" />
          <Lockup label="cpu min" value={cs?.min} unit="°C" />
          <Lockup label="gpu max" value={gs?.max} unit="°C" tone={toneOf(gs?.max)} />
          <Lockup label="gpu avg" value={gs?.avg} unit="°C" />
          <Lockup label="gpu min" value={gs?.min} unit="°C" />
        </div>
      </div>
    </>
  )
}

// ---------------- sessions ----------------

function SessionsView() {
  const sessions = usePoll('getSessions', 10_000)
  if (sessions === undefined) return null
  if (sessions === null) return <Note>Not available on this laptop.</Note>
  if (!sessions.length) return <Note>No sessions yet. Turn on Game Boost on the Boost page, play, then turn it off.</Note>
  const cols = 'grid grid-cols-[1fr_100px_120px_120px_110px] items-center gap-4'
  const pair = (avg: number | null, peak: number | null) => (avg == null ? '—' : `${avg}° / ${peak ?? '—'}°`)
  return (
    <div className="mx-auto mt-[120px] max-h-[540px] w-[900px] overflow-y-auto">
      <div className={cx(cols, 'border-b border-hairline pb-3')}>
        <span /><span className="mono-label">time</span><span className="mono-label">cpu avg / peak</span>
        <span className="mono-label">gpu avg / peak</span><span className="mono-label">above 85°</span>
      </div>
      <div className="divide-y divide-hairline">
        {sessions.slice(0, 30).map(s => (
          <div key={s.startMs} className={cx(cols, 'min-h-[64px] py-3')}>
            <div>
              <div className="flex items-center gap-3 text-[14px] text-t1">
                {s.game}
                {s.active && <span className="mono-label text-red">running</span>}
              </div>
              <div className="mono-label mt-1">
                {new Date(s.startMs).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <span className="tabular text-t1">{duration(s.seconds)}</span>
            <span className="tabular text-t1">{pair(s.avgCpu, s.peakCpu)}</span>
            <span className="tabular text-t1">{pair(s.avgGpu, s.peakGpu)}</span>
            <span className={cx('tabular', s.secondsHot > 0 ? 'text-red' : 'text-t3')}>{s.secondsHot > 0 ? duration(s.secondsHot) : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------- power ----------------

const STATE_WORD: Record<Power['state'], string> = {
  charging: 'charging', discharging: 'on battery', full: 'full', plugged: 'plugged in, not charging',
}
const ADAPTER_TEXT: Record<Power['adapterStatus'], string> = {
  ok: 'Working normally', below: 'Weaker than this laptop needs', battery: 'Not connected',
  notFunctioning: 'Not working', typeC: 'USB-C charger', unknown: 'Not reported',
}
const ADAPTER_NOTE: Partial<Record<Power['adapterStatus'], string>> = {
  below: 'Games can run slower on a weak charger. Use the charger that came with the laptop.',
  notFunctioning: 'The laptop reports that the charger is not working.',
}

function PowerView() {
  const p = usePoll('getPower', 5_000)
  if (p === undefined) return null
  if (p === null) return <Note>Not available on this laptop.</Note>
  if (!p.present) return <Note>No battery detected.</Note>
  return (
    <Split hero={<Hero label="battery" value={p.percent} unit="%" word={STATE_WORD[p.state]} />}>
      <ListRow label={p.state === 'charging' ? 'Power in' : p.state === 'discharging' ? 'Power out' : 'Power flow'} value={num(p.watts, 'W')} />
      <ListRow label={p.state === 'charging' ? 'Time to full' : 'Time left'} value={p.minutesLeft == null ? '—' : duration(p.minutesLeft * 60)} />
      <ListRow label="Charger" value={ADAPTER_TEXT[p.adapterStatus]} tone={p.adapterStatus === 'below' || p.adapterStatus === 'notFunctioning' ? 'amber' : undefined}
        note={ADAPTER_NOTE[p.adapterStatus]} />
      {p.adapterWatts != null && <ListRow label="Charger rating" value={num(p.adapterWatts, 'W')} />}
      {(p.capacityWh != null || p.designWh != null) && <ListRow label="Battery capacity" value={`${dec(p.capacityWh)} of ${dec(p.designWh)} Wh`} />}
      {p.wearPct != null && <ListRow label="Wear" value={`${Math.round(p.wearPct)}% of capacity lost`} />}
    </Split>
  )
}

// ---------------- gpu ----------------

function GpuView() {
  const t = useStore(s => s.t)
  const mode = useStore(s => s.hw?.gpuMode)
  const temp = t?.gpuTemp
  const vram = t?.vramUsed != null && t.vramTotal ? t.vramUsed / t.vramTotal : null
  return (
    <Split hero={<Hero label="gpu" value={temp} unit="°C" tone={toneOf(temp)}
      word={temp == null ? undefined : temp >= 85 ? 'hot' : temp >= 80 ? 'warm' : 'cool'} />}>
      <ListRow label="Core clock" value={num(t?.gpuClock, 'MHz')} />
      <ListRow label="Memory clock" value={num(t?.gpuMemClock, 'MHz')} />
      <ListRow label="Video memory" bar={vram}
        value={t?.vramUsed != null && t.vramTotal != null ? `${t.vramUsed.toLocaleString()} of ${t.vramTotal.toLocaleString()} MiB` : '—'} />
      <ListRow label="Load" value={num(t?.gpuLoad, '%')} />
      <ListRow label="Power draw" value={num(t?.gpuPower, 'W')} />
      <ListRow label="Power limit" value={num(t?.powerLimit, 'W')} />
      <ListRow label="Performance state" value={t?.gpuState ?? '—'} />
      <ListRow label="Graphics mode" value={mode ?? '—'} />
    </Split>
  )
}

// ---------------- system ----------------

const KEYBOARD: Record<number, string> = { 1: 'With number pad', 2: 'Without number pad' }

function hubText({ installed, inSync, differences }: SystemInfo['hub']) {
  if (!installed) return 'Not installed'
  if (inSync === true) return 'In step with OmenLite'
  if (inSync === false) return differences.length ? `Out of step: ${differences.join(', ')}` : 'Out of step'
  return 'Unknown'
}

function SystemView() {
  const s = usePoll('getSystem', null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])
  if (s === undefined) return null
  if (s === null) return <Note>Not available on this laptop.</Note>

  const rows: { label: string; value: string; tone?: 'amber' }[] = [
    { label: 'Model', value: s.model },
    { label: 'Board', value: s.board },
    { label: 'BIOS', value: s.bios },
    { label: 'OmenLite', value: s.appVersion },
    { label: 'Thermal policy', value: s.thermalPolicy == null ? '—' : String(s.thermalPolicy) },
    { label: 'Fans', value: `${s.fanCount != null ? `${s.fanCount} fans, ` : ''}${s.fanMax > 0 ? `${s.fanMin.toLocaleString()} to ${s.fanMax.toLocaleString()} rpm` : '—'}` },
    { label: 'Keyboard', value: (s.keyboardType != null && KEYBOARD[s.keyboardType]) || 'Not reported' },
    { label: 'Keyboard zones', value: s.fourZone ? 'Four colour zones' : 'Not supported' },
    { label: 'Graphics modes', value: s.gpuModes.length ? `${s.gpuModes.join(', ')}${s.gpuMode ? ` (now ${s.gpuMode})` : ''}` : 'No graphics switch' },
    { label: 'HP OMEN app', value: hubText(s.hub), tone: s.hub.installed && s.hub.inSync === false ? 'amber' : undefined },
  ]
  const copy = () => {
    const text = ['OmenLite report', ...rows.map(r => `${r.label}: ${r.value}`)].join('\n')
    navigator.clipboard.writeText(text).then(() => setCopied(true), () => toast('Could not copy the report.', 'error'))
  }

  return (
    <>
      <div className="absolute right-14 top-6">
        <Button onClick={copy} className="min-w-[120px]">{copied ? 'Copied' : 'Copy report'}</Button>
      </div>
      <div className="mx-auto mt-[120px] max-h-[540px] w-[680px] divide-y divide-hairline overflow-y-auto">
        {rows.map(r => <ListRow key={r.label} {...r} />)}
      </div>
    </>
  )
}
