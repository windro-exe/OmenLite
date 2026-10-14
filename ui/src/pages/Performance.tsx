import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { PERF_MODES, type PerfMode } from '../lib/bridge'
import { setManualFan, setMaxFan, setPerf } from '../lib/actions'
import { useStore } from '../lib/store'
import { FanIcon, Lockup, Num, Segmented, cx, dragSpring, heatTone } from '../components/ui'

const MODE_TEXT: Record<PerfMode, string> = {
  Quiet: 'Lowest fan noise, for reading and video.',
  Cool: 'Keeps the chassis cool on your lap.',
  Balanced: 'The everyday default.',
  Performance: 'Highest power limits, for games.',
}

const STEP = 100
const SIZE = 560, C = SIZE / 2, R = 170, SWEEP = 270, START = 135
const polar = (t: number, r = R) => {
  const a = ((START + SWEEP * t) * Math.PI) / 180
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const
}
const [ax, ay] = polar(0), [bx, by] = polar(1)
const ARC = `M${ax},${ay} A${R},${R} 0 1 1 ${bx},${by}`
const ARC_LEN = (R * SWEEP * Math.PI) / 180
// Mode stops sit on an outer ring across the top of the dial
const MODE_ANGLE: Record<PerfMode, number> = { Quiet: 215, Cool: 250, Balanced: 290, Performance: 325 }
const PX_PER_RPM = 1 / 12 // vertical drag: 12 rpm per pixel

type FanMode = 'Auto' | 'Manual' | 'Max'

export function Performance() {
  const hw = useStore(s => s.hw)
  const t = useStore(s => s.t)
  const busy = useStore(s => s.busy.fan)
  const mode: FanMode = hw?.maxFan ? 'Max' : hw?.manualRpm != null ? 'Manual' : 'Auto'
  // Range is this laptop's, from its BIOS fan table; the fallback only covers the frame before state loads.
  const MIN = hw?.fanMin ?? 2000, MAX = hw?.fanMax ?? 5500
  const toFrac = (rpm: number) => Math.min(1, Math.max(0, (rpm - MIN) / (MAX - MIN)))
  const snap = (rpm: number) => Math.min(MAX, Math.max(MIN, Math.round(rpm / STEP) * STEP))
  const [draft, setDraft] = useState(hw?.manualRpm ?? 3500)
  const [dragging, setDragging] = useState(false)
  const [nudging, setNudging] = useState(false) // wheel / arrow keys: show the value now, write once input stops
  // Two drag styles: the face drags vertically; the ball/ring follows the pointer around the circle.
  const drag = useRef<{ kind: 'vertical'; y: number; v: number; last: number } | { kind: 'ring'; last: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pendingNudge = useRef<{ timer: number; rpm: number } | null>(null)
  const frac = useMotionValue(0)
  const live = t?.cpuFan ?? 0
  const adjusting = dragging || nudging
  const target = mode === 'Max' ? MAX : mode === 'Manual' || adjusting ? draft : live
  const active = mode !== 'Auto' || adjusting

  // Arc follows the target with a zero-bounce spring, except while the pointer drives it directly.
  const targetFrac = toFrac(target), draftFrac = toFrac(draft)
  useEffect(() => {
    if (dragging) { frac.set(draftFrac); return }
    const ctl = animate(frac, targetFrac, dragSpring)
    return () => ctl.stop()
  }, [targetFrac, dragging, draftFrac, frac])

  const thumbX = useTransform(frac, f => polar(f)[0])
  const thumbY = useTransform(frac, f => polar(f)[1])
  // Arc fill and ball are derived from the same value in the same frame. Motion's `pathLength` style lagged
  // the ball by ~300 ms during mode changes, so the ball jumped ahead of the arc.
  const arcDash = useTransform(frac, f => `${Math.max(f * ARC_LEN, 0.001)} ${ARC_LEN}`)
  const commit = (rpm: number) => { setDraft(rpm); void setManualFan(rpm) }

  /** Pointer → rpm by angle around the dial centre. In the bottom gap it holds the nearer end instead of flipping. */
  const rpmAtPointer = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect() // screen px, already includes the stage zoom
    const x = ((clientX - r.left) / r.width) * SIZE - C, y = ((clientY - r.top) / r.height) * SIZE - C
    const a = ((((Math.atan2(y, x) * 180) / Math.PI - START) % 360) + 360) % 360
    const f = a <= SWEEP ? a / SWEEP : frac.get() < 0.5 ? 0 : 1
    return snap(MIN + f * (MAX - MIN))
  }
  const startDrag = (state: NonNullable<typeof drag.current>) => {
    drag.current = state
    setDraft(state.last)
    setDragging(true)
  }
  const moveDrag = (rpm: number) => {
    if (!drag.current) return
    drag.current.last = rpm
    setDraft(rpm)
  }
  const endDrag = () => {
    if (!drag.current) return
    const rpm = drag.current.last // the ref, not `draft`: this handler may hold a stale render's value
    drag.current = null
    setDragging(false)
    commit(rpm)
  }

  /** One BIOS write per burst of wheel notches / key presses, 400 ms after the last one. */
  const nudge = (delta: number) => {
    const base = pendingNudge.current?.rpm ?? (mode === 'Manual' ? draft : snap(live))
    const rpm = snap(base + delta)
    if (pendingNudge.current) clearTimeout(pendingNudge.current.timer)
    pendingNudge.current = { rpm, timer: window.setTimeout(() => { pendingNudge.current = null; setNudging(false); commit(rpm) }, 400) }
    setDraft(rpm)
    setNudging(true)
  }
  // Leaving the screen mid-burst still applies the last value.
  useEffect(() => () => {
    const p = pendingNudge.current
    if (p) { clearTimeout(p.timer); void setManualFan(p.rpm) }
  }, [])

  if (!hw) return null
  const tempTone = t ? heatTone(t.cpuTemp) : 'white'

  return (
    <div className="relative size-full">
      <div className="absolute left-14 top-6">
        <h1 className="text-[22px] font-normal tracking-[-0.02em]">Performance</h1>
        <p className="mt-1 text-t3">Choose a mode on the ring. Pull the white ball around the dial, or drag the centre up or down, to set the fans yourself.</p>
      </div>

      {/* Edge readings */}
      <div className="absolute left-14 top-1/2 flex -translate-y-1/2 flex-col gap-10">
        {([['cpu fan', t?.cpuFan], ['gpu fan', t?.gpuFan]] as const).map(([l, v]) => (
          <div key={l} className="flex items-end gap-3">
            <FanIcon rpm={v ?? 0} size={18} className="mb-1 text-t3" />
            <Lockup label={l} value={v} unit="rpm" />
          </div>
        ))}
      </div>
      <div className="absolute right-20 top-1/2 flex w-[220px] -translate-y-1/2 flex-col gap-10">
        <div className="flex flex-col gap-1.5">
          <span className="mono-label">{hw.perf.toLowerCase()}</span>
          <p className="text-[15px] leading-snug text-t2">{MODE_TEXT[hw.perf]}</p>
        </div>
        <Lockup label="cpu" value={t?.cpuTemp} unit="°C" tone={tempTone === 'white' ? undefined : tempTone} />
      </div>

      {/* The subject */}
      <div className="absolute left-1/2 top-[47%] -translate-x-1/2 -translate-y-1/2" style={{ width: SIZE, height: SIZE }}>
        <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 size-full overflow-visible">
          <defs>
            <radialGradient id="dial-face" cx="50%" cy="35%" r="60%">
              <stop offset="0" stopColor="var(--color-raise-1)" />
              <stop offset="1" stopColor="var(--color-stage)" />
            </radialGradient>
          </defs>
          {/* outer mode ring */}
          <circle cx={C} cy={C} r={R + 70} fill="none" stroke="var(--color-hairline)" />
          {/* ticks every 100 rpm, long every 500 */}
          {Array.from({ length: 36 }, (_, i) => {
            const f = i / 35, long = i % 5 === 0
            const [x1, y1] = polar(f, R + 22), [x2, y2] = polar(f, R + (long ? 34 : 28))
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={long ? 'var(--color-t3)' : 'var(--color-t4)'} strokeWidth="1" />
          })}
          <circle cx={C} cy={C} r={R - 26} fill="url(#dial-face)" stroke="var(--color-hairline)" />
          <path d={ARC} fill="none" stroke="var(--color-raise-1)" strokeWidth="8" strokeLinecap="round" />
          <motion.path d={ARC} fill="none" stroke={active ? 'var(--color-red)' : 'var(--color-t2)'} strokeWidth="8" strokeLinecap="round" strokeDasharray={arcDash} />
          {/* Grab the ball or anywhere on the ring and pull it around */}
          <g className={cx('touch-none', mode === 'Max' ? '' : dragging && drag.current?.kind === 'ring' ? 'cursor-grabbing' : 'cursor-grab')}
            onPointerDown={e => {
              if (mode === 'Max' || e.button !== 0) return
              e.currentTarget.setPointerCapture(e.pointerId)
              startDrag({ kind: 'ring', last: rpmAtPointer(e.clientX, e.clientY) })
            }}
            onPointerMove={e => { if (drag.current?.kind === 'ring') moveDrag(rpmAtPointer(e.clientX, e.clientY)) }}
            onPointerUp={endDrag} onPointerCancel={endDrag}>
            <path d={ARC} fill="none" stroke="transparent" strokeWidth="40" strokeLinecap="round" pointerEvents="stroke" />
            <motion.circle cx={thumbX} cy={thumbY} r={9} fill="white" />
            <motion.circle cx={thumbX} cy={thumbY} r={18} fill="transparent" />
          </g>
        </svg>

        {/* Mode stops: dot on the ring, label outside it so the ring never crosses text */}
        {PERF_MODES.map(m => {
          const a = (MODE_ANGLE[m] * Math.PI) / 180
          return (
            <span key={m} aria-hidden className={cx('pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200',
              hw.perf === m ? 'bg-red' : 'bg-raise-2')}
              style={{ left: C + (R + 70) * Math.cos(a), top: C + (R + 70) * Math.sin(a) }} />
          )
        })}
        <div role="radiogroup" aria-label="Performance mode"
          onKeyDown={e => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
            if (!d) return
            e.preventDefault()
            const next = PERF_MODES[(PERF_MODES.indexOf(hw.perf) + d + PERF_MODES.length) % PERF_MODES.length]
            void setPerf(next)
            e.currentTarget.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus()
          }}>
          {PERF_MODES.map(m => {
            const a = (MODE_ANGLE[m] * Math.PI) / 180
            const on = hw.perf === m
            return (
              <button key={m} data-mode={m} onClick={() => void setPerf(m)} role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                className={cx('press hover-text absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-pill px-2 py-1 text-[13px]', on ? 'text-t1' : 'text-t3')}
                style={{ left: C + (R + 98) * Math.cos(a), top: C + (R + 98) * Math.sin(a) }}>
                {m}
              </button>
            )
          })}
        </div>

        {/* Dial face: vertical drag, wheel and arrow keys */}
        <div role="slider" tabIndex={0} aria-label="Fan speed" aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={target}
          aria-valuetext={`${target} rpm${mode === 'Auto' ? ', automatic' : ''}`} aria-disabled={mode === 'Max'}
          className={cx('absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full touch-none',
            mode === 'Max' ? '' : dragging ? 'cursor-ns-resize' : 'cursor-grab')}
          style={{ width: (R - 26) * 2, height: (R - 26) * 2 }}
          onPointerDown={e => {
            if (mode === 'Max' || e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            const start = mode === 'Manual' ? draft : snap(live)
            startDrag({ kind: 'vertical', y: e.clientY, v: start, last: start })
          }}
          onPointerMove={e => {
            const d = drag.current
            if (d?.kind === 'vertical') moveDrag(snap(d.v + (d.y - e.clientY) / PX_PER_RPM))
          }}
          onPointerUp={endDrag} onPointerCancel={endDrag}
          onWheel={e => { if (mode !== 'Max') nudge(e.deltaY < 0 ? STEP : -STEP) }}
          onKeyDown={e => {
            if (mode === 'Max') return
            const step = e.shiftKey ? 500 : STEP
            const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? step : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -step : 0
            if (d) { e.preventDefault(); nudge(d) }
          }}>
          <div className="pointer-events-none flex flex-col items-center">
            <FanIcon rpm={target} size={24} className={cx('mb-3 transition-colors', active ? 'text-red' : 'text-t3')} />
            <Num value={target} unit="rpm" className="text-[72px] font-normal leading-[0.9] tracking-[-0.045em] text-t1" />
            <span className="mono-label mt-3">{busy ? 'applying' : mode === 'Auto' && !adjusting ? 'live' : 'target'}</span>
          </div>
        </div>
      </div>

      {/* Fan control mode */}
      <div className="absolute bottom-[110px] left-1/2 -translate-x-1/2">
        <Segmented<FanMode> label="Fan control" options={['Auto', 'Manual', 'Max']} value={mode} onChange={m => {
          if (m === 'Auto') void setManualFan(null)
          else if (m === 'Max') void setMaxFan(true)
          else commit(draft)
        }} />
      </div>
    </div>
  )
}
