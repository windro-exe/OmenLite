import { AnimatePresence, animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from 'motion/react'
import { Check } from 'lucide-react'
import { useRef, useState } from 'react'
import { call, type BoostResult, type CleanResult } from '../lib/bridge'
import { setBoost } from '../lib/actions'
import { toast, useStore } from '../lib/store'
import { Button, EASE_OUT, HOUSE, Lockup, cx, dragSpring, glow } from '../components/ui'

const HOLD_S = 0.9
let lastResult: BoostResult | null = null // last successful boost-on result; lives as long as the page process

/** Boost: the button is a light. Holding builds it; engaging releases one bloom (the single delight moment). */
export function Boost() {
  const on = useStore(s => s.hw?.boost ?? false)
  const busy = useStore(s => s.busy.boost ?? false)
  const perf = useStore(s => s.hw?.perf)
  const t = useStore(s => s.t)
  // Module-level so the full step list survives switching screens while boost stays on.
  const [result, setResultState] = useState<BoostResult | null>(lastResult)
  const setResult = (r: BoostResult | null) => { lastResult = r; setResultState(r) }
  const [bloom, setBloom] = useState(0) // increments to replay the bloom
  const progress = useMotionValue(0)
  const hold = useRef<AnimationPlaybackControls | null>(null)
  const haloOpacity = useTransform(progress, [0, 1], [0, 1])
  const haloScale = useTransform(progress, [0, 1], [0.7, 1])
  const press = useTransform(progress, [0, 1], [1, 0.96])

  const start = () => {
    if (busy) return
    hold.current = animate(progress, 1, {
      duration: HOLD_S, ease: 'linear',
      onComplete: async () => {
        const r = await setBoost(!on)
        animate(progress, 0, { duration: 0.5, ease: HOUSE })
        if (!r) return
        setResult(r.on ? r : null)
        if (r.on) setBloom(b => b + 1)
      },
    })
  }
  const cancel = () => {
    if (progress.get() >= 1) return
    hold.current?.stop()
    animate(progress, 0, dragSpring)
  }

  const steps = result ? [
    'Performance thermal mode',
    'Best-performance power plan',
    result.target ? `High priority for ${result.target}` : 'No game window found, priority unchanged',
    `Freed memory from ${result.trimmed} background apps`,
  ] : on ? ['Performance thermal mode', 'Best-performance power plan'] : []

  return (
    <div className="relative size-full">
      <div className="absolute left-14 top-6">
        <h1 className="text-[22px] font-normal tracking-[-0.02em]">Boost</h1>
        <p className="mt-1 text-t3">Hold the light for a second to switch everything to game mode. Hold again to undo.</p>
      </div>

      <div className="absolute left-14 top-1/2 flex -translate-y-1/2 flex-col gap-10">
        <div className="flex flex-col gap-1.5">
          <span className="mono-label">mode</span>
          <span className="text-[15px] text-t2">{perf ?? '—'}</span>
        </div>
        <Lockup label="cpu" value={t?.cpuTemp} unit="°C" />
      </div>

      {/* Steps: appear only after a real boost */}
      <ul className="absolute right-20 top-1/2 w-[260px] -translate-y-1/2 space-y-3" aria-label="Boost steps">
        <AnimatePresence>
          {steps.map((s, i) => (
            <motion.li key={s} className="flex items-start gap-3 text-[13px] leading-snug text-t2"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.25, delay: 0.35 + i * 0.12, ease: EASE_OUT }}>
              <Check size={14} className="mt-0.5 shrink-0 text-t1" strokeWidth={2} />
              {s}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {/* The subject */}
      <div className="absolute left-1/2 top-[45%] grid size-[480px] -translate-x-1/2 -translate-y-1/2 place-items-center">
        <div className="dither absolute inset-0 overflow-hidden rounded-full">
          <div className="absolute inset-0 rounded-full" style={{ background: glow('0.96 0.02 250', 0.18) }} />
          <motion.div className="absolute inset-0 rounded-full" style={{ background: glow('0.63 0.24 27', 0.6), opacity: on ? 1 : haloOpacity, scale: on ? 1 : haloScale }} />
          {on && (
            <motion.div className="absolute inset-0 rounded-full" style={{ background: glow('0.63 0.24 27', 0.35) }}
              animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} />
          )}
          <AnimatePresence>
            {bloom > 0 && (
              <motion.div key={bloom} className="absolute inset-0 rounded-full" style={{ background: glow('1 0 0', 0.75) }}
                initial={{ opacity: 0.9, scale: 0.4 }} animate={{ opacity: 0, scale: 1.3 }} transition={{ duration: 0.8, ease: HOUSE }} />
            )}
          </AnimatePresence>
        </div>
        <motion.button aria-label={on ? 'Hold to end game boost' : 'Hold to start game boost'} aria-pressed={on} aria-busy={busy}
          onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel}
          onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start() } }}
          onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') cancel() }}
          style={{ scale: press }}
          className="relative grid size-[220px] touch-none place-items-center rounded-full">
          <svg viewBox="0 0 220 220" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="110" cy="110" r="107" fill="none" stroke="var(--color-hairline)" strokeWidth="2" />
            <motion.circle cx="110" cy="110" r="107" fill="none" stroke={on ? 'var(--color-red)' : 'white'} strokeWidth="2" strokeLinecap="round"
              style={{ pathLength: on ? 1 : progress, opacity: on ? 1 : haloOpacity }} />
          </svg>
          <span className="grid size-[196px] place-items-center rounded-full"
            style={{
              background: on
                ? 'radial-gradient(circle at 50% 30%, oklch(0.68 0.22 29), oklch(0.5 0.2 27) 75%)'
                : 'radial-gradient(circle at 50% 28%, var(--color-raise-1), var(--color-stage) 70%)',
              boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .14), inset 0 0 0 1px var(--color-hairline), 0 30px 60px -20px rgb(0 0 0 / .8)',
              transition: 'background 600ms var(--ease-house)',
            }}>
            <span className="flex flex-col items-center gap-2">
              <span className="text-[22px] font-normal tracking-[-0.02em] text-t1">{busy ? 'Working' : on ? 'Boost on' : 'Hold'}</span>
              <span className={cx('mono-label', on && 'text-white/70')}>{on ? 'hold to end' : 'game boost'}</span>
            </span>
          </span>
        </motion.button>
      </div>

      <Cleaner />
    </div>
  )
}

function Cleaner() {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  const [res, setRes] = useState<CleanResult | null>(null)
  const run = async () => {
    setState('running')
    try { setRes(await call('cleanCache')); setState('done') }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); setState('idle') }
  }
  return (
    <div className="absolute bottom-[104px] left-1/2 flex w-[680px] -translate-x-1/2 items-center gap-6 pt-5 shadow-[inset_0_1px_0_var(--color-hairline)]">
      <div className="flex-1">
        <div className="text-t1">Clean temporary files</div>
        <div className="mt-0.5 text-t3">
          {state === 'done' && res
            ? `Freed ${res.freedMb.toFixed(0)} MB from ${res.files.toLocaleString()} files and trimmed ${res.trimmed} idle apps.`
            : 'Deletes unused temp files, flushes the DNS cache and trims idle apps. Files in use are skipped.'}
        </div>
      </div>
      <Button onClick={run} disabled={state === 'running'} className="w-[92px]">{state === 'running' ? 'Cleaning' : 'Clean'}</Button>
    </div>
  )
}
