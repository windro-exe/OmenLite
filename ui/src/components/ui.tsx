import NumberFlow from '@number-flow/react'
import { motion, useAnimationFrame, useMotionValue, useReducedMotion } from 'motion/react'
import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'

/** Zero-bounce springs (DESIGN.md §7): direct manipulation and telemetry smoothing. */
export const dragSpring = { type: 'spring', stiffness: 300, damping: 30 } as const
export const dataSpring = { type: 'spring', stiffness: 120, damping: 22 } as const
export const HOUSE = [0.2, 0.715, 0.205, 0.99] as const
export const EASE_OUT = [0.23, 1, 0.32, 1] as const

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/** Live number: Geist 400, tabular, unit hung outside the optical centre. */
export function Num({ value, unit, className }: { value: number | null | undefined; unit?: string; className?: string }) {
  return (
    <span className={cx('relative inline-block w-fit tabular', className)}>
      {value == null ? '—' : <NumberFlow value={Math.round(value)} format={{ useGrouping: true }} />}
      {/* Hung at cap height: % of the number's box, which scales with its size (em here would use the unit's own 11px). */}
      {unit && <span className="mono-label absolute left-full top-[23%] ml-1.5 whitespace-nowrap">{unit}</span>}
    </span>
  )
}

/** Edge reading: mono label over a mid-size value. No container. */
export function Lockup({ label, value, unit, tone }: { label: string; value: number | null | undefined; unit?: string; tone?: 'amber' | 'red' }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="mono-label">{label}</span>
      <Num value={value} unit={unit} className={cx('text-[28px] font-normal leading-none tracking-[-0.03em]',
        tone === 'red' ? 'text-red' : tone === 'amber' ? 'text-amber' : 'text-t1')} />
    </div>
  )
}

type ButtonProps = ComponentProps<'button'> & { variant?: 'raised' | 'quiet' }
export function Button({ variant = 'raised', className, ...rest }: ButtonProps) {
  return (
    <button
      className={cx('press inline-flex h-9 items-center justify-center gap-2 rounded-pill px-4 text-[13px] font-medium',
        variant === 'raised' ? 'raised hover-raise text-t1' : 'hover-text text-t2', className)}
      {...rest}
    />
  )
}

export function Switch({ checked, onChange, label, busy, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; busy?: boolean; disabled?: boolean
}) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} aria-busy={busy} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('press relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-red' : 'raised')}>
      <motion.span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white"
        animate={{ x: checked ? 16 : 0, opacity: busy ? 0.6 : 1 }} transition={dragSpring} />
    </button>
  )
}

/**
 * Segmented control with the clip-path exclusion technique (Paco Coursey): an inverted copy of the labels
 * is clipped to the active segment, so text colour flips exactly under the indicator.
 */
export function Segmented<T extends string>({ options, value, onChange, label, tone = 'neutral', render }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; label: string; tone?: 'red' | 'neutral'; render?: (o: T) => ReactNode
}) {
  const row = useRef<HTMLDivElement>(null)
  const [clip, setClip] = useState<string | null>(null)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    const measure = () => {
      const btn = el.children[options.indexOf(value)] as HTMLElement | undefined
      if (!btn) return
      const right = el.clientWidth - btn.offsetLeft - btn.offsetWidth
      setClip(`inset(0 ${right}px 0 ${btn.offsetLeft}px round var(--radius-pill))`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [value, options])
  const seg = 'flex h-8 items-center justify-center whitespace-nowrap px-4 text-[13px] font-medium'
  return (
    <div role="radiogroup" aria-label={label} className="raised relative inline-flex rounded-group p-1">
      <div ref={row} className="flex">
        {options.map(o => (
          <button key={o} role="radio" aria-checked={o === value} onClick={() => onChange(o)}
            className={cx(seg, 'press hover-text rounded-pill text-t2')}>
            {render ? render(o) : o}
          </button>
        ))}
      </div>
      {clip && (
        <div aria-hidden className={cx('pointer-events-none absolute inset-1 flex rounded-pill', tone === 'red' ? 'bg-red' : 'bg-raise-2')}
          style={{ clipPath: clip, transition: 'clip-path 260ms var(--ease-morph)' }}>
          {options.map(o => <span key={o} className={cx(seg, 'text-white')}>{render ? render(o) : o}</span>)}
        </div>
      )}
    </div>
  )
}

/** Fan glyph rotating at a rate tied to real RPM; speed eases, never restarts. */
export function FanIcon({ rpm, size = 20, className }: { rpm: number; size?: number; className?: string }) {
  const rotate = useMotionValue(0)
  const reduced = useReducedMotion()
  const speed = useRef(0)
  useAnimationFrame((_, dt) => {
    if (reduced) return
    speed.current += ((rpm / 60) * 0.1 - speed.current) * Math.min(1, dt / 500)
    rotate.set((rotate.get() + speed.current * 360 * (dt / 1000)) % 360)
  })
  return (
    <motion.svg viewBox="0 0 24 24" width={size} height={size} style={{ rotate }} className={className} aria-hidden>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      {[0, 60, 120, 180, 240, 300].map(a => (
        <path key={a} transform={`rotate(${a} 12 12)`} fill="currentColor"
          d="M12.6 9.8C12 7 13.2 3.4 16 2.6c1.5 2.4.6 5.8-1.9 7.9-.5.4-1.2.1-1.5-.7z" />
      ))}
    </motion.svg>
  )
}

/** 60 s temperature horizon: one line, direct labels, no axes. Fixed 30–100 °C so it stays calm. */
export function Horizon({ data, className }: { data: number[]; className?: string }) {
  const W = 1000, H = 60, step = W / 59
  const y = (v: number) => H - ((Math.min(100, Math.max(30, v)) - 30) / 70) * H
  const pts = data.map((v, i) => `${W - (data.length - 1 - i) * step},${y(v)}`)
  const id = useId()
  if (pts.length < 2) return null
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cx('overflow-visible', className)} aria-hidden>
      <defs>
        {/* userSpaceOnUse: a flat line has a zero-height bounding box, which makes a bbox gradient render nothing */}
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
          <stop offset="0" stopColor="white" stopOpacity="0.08" />
          <stop offset="1" stopColor="white" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <polyline points={pts.join(' ')} fill="none" stroke={`url(#${id})`} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-tag px-1.5 py-0.5 font-mono text-[10px] text-t3 shadow-[inset_0_0_0_1px_var(--color-hairline)]">{children}</kbd>
}

/** Light colour for a temperature: cold white → amber (80) → red (85+). DESIGN.md §3 red rule. */
export function heatTone(t: number) {
  return t >= 85 ? 'red' : t >= 80 ? 'amber' : 'white'
}

/**
 * Radial light with eased alpha stops (no blur filter). Linear radial gradients band into visible rings on
 * dark backgrounds; easing the falloff spreads the 8-bit steps out. `lch` is "L C H", `a` the peak alpha.
 */
export function glow(lch: string, a: number) {
  const stops = [[1, 0], [0.8, 14], [0.58, 28], [0.38, 42], [0.22, 56], [0.1, 72], [0.03, 86], [0, 100]]
  return `radial-gradient(closest-side, ${stops.map(([k, p]) => `oklch(${lch} / ${(a * k).toFixed(3)}) ${p}%`).join(', ')})`
}
