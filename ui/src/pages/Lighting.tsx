import { motion, useSpring } from 'motion/react'
import { HexColorPicker } from 'react-colorful'
import { useEffect, useRef, useState } from 'react'
import { PHYSICAL_ORDER, ZONE_NAMES, setBacklight, setZones } from '../lib/actions'
import { FALLBACK, layoutFor, zoneLabelX } from '../lib/keyboards'
import { useStore } from '../lib/store'
import { Button, HOUSE, Switch, cx } from '../components/ui'

const SWATCHES = ['#FF1E27', '#FF6A1F', '#FFB000', '#3DFF8A', '#00C8FF', '#2E6BFF', '#8A3CFF', '#FF3DB4', '#FFFFFF']

export function Lighting() {
  const hw = useStore(s => s.hw)
  const busy = useStore(s => s.busy.zones)
  const busyBacklight = useStore(s => s.busy.backlight)
  const [brush, setBrush] = useState('#00C8FF')
  const [draft, setDraft] = useState<string[] | null>(null)
  const [hoverZone, setHoverZone] = useState<number | null>(null)
  const stroke = useRef<string[] | null>(null) // draft readable from the window listener
  const zones = draft ?? hw?.zones ?? ['#333333', '#333333', '#333333', '#333333']
  // Drawing comes from the keyboard type the BIOS reports, so another OMEN shows its own keyboard.
  const layout = layoutFor(hw?.keyboardType) ?? FALLBACK
  const { keys: KEYS, width: UW, height: UH } = layout
  const zoneX = zoneLabelX(layout, PHYSICAL_ORDER)
  const on = hw?.backlight ?? true

  // One BIOS write when the stroke ends, anywhere in the window.
  useEffect(() => {
    const up = () => {
      const d = stroke.current
      if (!d) return
      stroke.current = null
      setDraft(null)
      if (hw && d.some((c, i) => c.toLowerCase() !== hw.zones[i].toLowerCase())) void setZones(d, 'Keyboard painted')
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [hw])

  const paint = (zone: number) => {
    const next = [...(stroke.current ?? zones)]
    next[zone] = brush
    stroke.current = next
    setDraft(next)
  }

  const rx = useSpring(10, { stiffness: 120, damping: 22 })
  const ry = useSpring(0, { stiffness: 120, damping: 22 })

  const shuffle = () => {
    const base = Math.random() * 360
    void setZones([0, 1, 2, 3].map(i => hsl((base + i * 40) % 360)), 'Shuffled')
  }

  if (hw && !hw.fourZone) return (
    <div className="grid size-full place-items-center text-center">
      <div>
        <h1 className="text-[22px] font-normal tracking-[-0.02em]">Keyboard</h1>
        <p className="mt-2 text-t3">This laptop's keyboard has no colour zones the BIOS lets apps control.</p>
      </div>
    </div>
  )

  return (
    <div className="relative size-full">
      <div className="absolute left-14 top-6">
        <h1 className="text-[22px] font-normal tracking-[-0.02em]">Keyboard</h1>
        <p className="mt-1 text-t3">Pick a colour, then click or drag across the keys.</p>
        <p className="mono-label mt-2">{layout.name.toLowerCase()}</p>
      </div>

      {/* The subject */}
      <div className="absolute left-14 right-[340px] top-[120px] bottom-[120px] flex flex-col justify-center">
        <div className="relative [perspective:1600px]"
          onPointerMove={e => {
            const r = e.currentTarget.getBoundingClientRect()
            ry.set(((e.clientX - r.left) / r.width - 0.5) * 4)
            rx.set(10 - ((e.clientY - r.top) / r.height - 0.5) * 4)
          }}
          onPointerLeave={() => { rx.set(10); ry.set(0); setHoverZone(null) }}>
          {/* Light cast on the desk: zone colours, shaped by a mask instead of a blur filter */}
          <motion.div aria-hidden className="absolute -inset-x-8 -bottom-16 top-1/3"
            animate={{ opacity: on ? 0.5 : 0 }} transition={{ duration: 0.6, ease: HOUSE }}
            style={{
              background: `linear-gradient(90deg, ${PHYSICAL_ORDER.map(z => zones[z]).join(',')})`,
              // closest-side: fade reaches zero before every edge of the box, so no hard cut-off line
              maskImage: 'radial-gradient(closest-side at 50% 55%, black, transparent)',
            }} />
          <motion.div style={{ rotateX: rx, rotateY: ry, aspectRatio: `${UW} / ${UH}` }}
            className="relative w-full cursor-grab touch-none rounded-[14px] p-[1.1%] active:cursor-grabbing"
            role="group" aria-label="Keyboard zones">
            <div className="absolute inset-0 rounded-[14px] bg-stage shadow-[inset_0_1px_0_var(--color-specular),inset_0_0_0_1px_var(--color-hairline),0_40px_80px_-30px_black]" />
            <div className="relative size-full">
              {KEYS.map((k, i) => {
                const c = zones[k.zone]
                const lit = on && (hoverZone === null || hoverZone === k.zone)
                return (
                  <button key={i} tabIndex={-1} aria-hidden
                    onPointerDown={e => { e.currentTarget.releasePointerCapture(e.pointerId); stroke.current = [...zones]; paint(k.zone) }}
                    onPointerEnter={() => { setHoverZone(k.zone); if (stroke.current) paint(k.zone) }}
                    className="absolute cursor-[inherit] p-[0.2%]"
                    style={{ left: `${(k.x / UW) * 100}%`, top: `${(k.y / UH) * 100}%`, width: `${(k.w / UW) * 100}%`, height: `${(k.h / UH) * 100}%` }}>
                    <span className="flex size-full items-center justify-center rounded-key text-[clamp(8px,0.78vw,11px)] font-medium transition-[color,box-shadow,opacity] duration-300"
                      style={{
                        background: 'var(--color-raise-1)',
                        color: on ? `color-mix(in oklch, ${c} 60%, white)` : 'var(--color-t4)',
                        textShadow: on ? `0 0 10px ${c}` : 'none',
                        boxShadow: `inset 0 1px 0 var(--color-specular), inset 0 -2px 0 rgb(0 0 0 / .4)${on ? `, 0 0 14px -5px ${c}` : ''}`,
                        opacity: lit || !on ? 1 : 0.4,
                      }}>
                      {k.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        </div>

        {/* Zone labels: also a keyboard path to paint a whole zone */}
        <div className="relative mt-8 h-6">
          {PHYSICAL_ORDER.map(z => (
            <button key={z} onPointerEnter={() => setHoverZone(z)} onPointerLeave={() => setHoverZone(null)}
              onClick={() => void setZones(zones.map((c, i) => i === z ? brush : c), `${ZONE_NAMES[z]} zone painted`)}
              aria-label={`Paint ${ZONE_NAMES[z]} zone`}
              className={cx('press absolute flex -translate-x-1/2 items-center gap-2 rounded-pill px-2 py-1 text-[12px]', hoverZone === z ? 'text-t1' : 'text-t3')}
              style={{ left: `${(zoneX[z] / UW) * 100}%` }}>
              <span className="size-2 rounded-full transition-colors duration-300" style={{ background: zones[z] }} />
              {ZONE_NAMES[z]}
            </button>
          ))}
        </div>
      </div>

      {/* Brush */}
      <div className="absolute right-14 top-[120px] flex w-[260px] flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <span className="mono-label">brush</span>
          <span className="mono-label uppercase">{brush}</span>
        </div>
        <div className="picker"><HexColorPicker color={brush} onChange={setBrush} /></div>
        <div className="grid grid-cols-9 gap-1.5" role="radiogroup" aria-label="Brush presets">
          {SWATCHES.map(s => (
            <button key={s} role="radio" aria-checked={brush.toLowerCase() === s.toLowerCase()} aria-label={s} onClick={() => setBrush(s)}
              className={cx('press aspect-square rounded-full', brush.toLowerCase() === s.toLowerCase() && 'shadow-[0_0_0_2px_var(--color-canvas),0_0_0_3.5px_white]')}
              style={{ background: s }} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void setZones([brush, brush, brush, brush], 'Whole keyboard painted')}>Fill all</Button>
          <Button onClick={shuffle}>Shuffle</Button>
        </div>
        <div className="flex items-center justify-between pt-4 shadow-[inset_0_1px_0_var(--color-hairline)]">
          <span className="text-t2">Backlight</span>
          <Switch label="Backlight" checked={on} busy={busyBacklight} onChange={v => void setBacklight(v)} />
        </div>
        <span className="mono-label h-4">{busy ? 'applying' : ''}</span>
      </div>
    </div>
  )
}

function hsl(h: number) {
  const s = 0.95, l = 0.55
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase()
}
