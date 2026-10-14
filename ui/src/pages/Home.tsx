import { motion } from 'motion/react'
import type { Page } from '../nav'
import { useStore } from '../lib/store'
import { FanIcon, HOUSE, Horizon, Lockup, Num, cx, glow, heatTone } from '../components/ui'

const LIGHT = {
  white: glow('0.96 0.02 250', 0.62),
  amber: glow('0.80 0.15 72', 0.5),
  red: glow('0.63 0.24 27', 0.6),
} as const

/** Home: the heat core. Its light is the CPU — colour from temperature, size from load (DESIGN.md §10). */
export function Home({ go }: { go: (p: Page) => void }) {
  const t = useStore(s => s.t)
  const hw = useStore(s => s.hw)
  const hist = useStore(s => s.cpuHist)
  const temp = t?.cpuTemp ?? 0
  const load = t?.cpuLoad ?? 0
  const tone = heatTone(temp)
  const word = temp >= 85 ? 'hot' : temp >= 80 ? 'warm' : 'cool' // same thresholds as the light colour
  const gpuTone = t?.gpuTemp != null ? heatTone(t.gpuTemp) : 'white'

  return (
    <div className="relative size-full">
      {/* Edge readings, left */}
      <div className="absolute left-14 top-1/2 flex -translate-y-[60%] flex-col gap-10">
        <Lockup label="gpu" value={t?.gpuTemp} unit="°C" tone={gpuTone === 'white' ? undefined : gpuTone} />
        <Lockup label="gpu power" value={t?.gpuPower} unit="W" />
        <div className="flex flex-col gap-1.5">
          <span className="mono-label">graphics</span>
          <span className="text-[15px] text-t2">{hw?.gpuMode ?? '—'}</span>
        </div>
      </div>

      {/* Edge readings, right */}
      <div className="absolute right-20 top-1/2 flex -translate-y-[60%] flex-col items-start gap-10">
        <FanReading label="cpu fan" rpm={t?.cpuFan} />
        <FanReading label="gpu fan" rpm={t?.gpuFan} />
        <Lockup label="cpu load" value={t?.cpuLoad} unit="%" />
      </div>

      {/* The subject */}
      <button onClick={() => go('performance')} aria-label={`CPU ${temp} degrees, ${word}. Open performance.`}
        className="group absolute left-1/2 top-[44%] grid size-[540px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full">
        <div className="dither absolute inset-0 overflow-hidden rounded-full">
          {(['white', 'amber', 'red'] as const).map(k => (
            <motion.div key={k} className="absolute inset-0 rounded-full"
              style={{ background: LIGHT[k] }}
              initial={false}
              animate={{ opacity: tone === k ? 1 : 0, scale: 0.72 + Math.min(load, 100) / 100 * 0.28 }}
              transition={{ duration: 0.6, ease: HOUSE }} />
          ))}
          {/* hover: the core brightens (hover variant only fires on hover-capable pointers) */}
          <div className="absolute inset-[12%] rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            style={{ background: glow('0.97 0.01 250', 0.22) }} />
        </div>
        <div className="relative grid size-[300px] place-items-center rounded-full transition-transform duration-200 [transition-timing-function:var(--ease-out)] group-active:scale-[0.985]"
          style={{
            background: 'radial-gradient(circle at 50% 28%, var(--color-raise-1), var(--color-stage) 70%)',
            boxShadow: 'inset 0 1px 0 var(--color-specular), inset 0 0 0 1px var(--color-hairline), 0 30px 60px -20px rgb(0 0 0 / 0.8)',
          }}>
          <div className="flex flex-col items-center">
            <span className="mono-label">cpu</span>
            <Num value={t?.cpuTemp} unit="°C" className="mt-2 text-[128px] font-normal leading-[0.9] tracking-[-0.05em] text-t1" />
            <span className={cx('mono-label mt-4', tone === 'red' ? 'text-red' : tone === 'amber' ? 'text-amber' : '')}>{word}</span>
          </div>
        </div>
      </button>

      {/* 60 s horizon */}
      <div className="absolute inset-x-14 bottom-[104px] flex items-end gap-4">
        <span className="mono-label pb-0.5">60 s</span>
        <Horizon data={hist} className="h-10 flex-1" />
        <span className="mono-label tabular pb-0.5 text-t2">{t ? `${t.cpuTemp}°` : '—'}</span>
      </div>
    </div>
  )
}

function FanReading({ label, rpm }: { label: string; rpm: number | undefined }) {
  return (
    <div className="flex items-end gap-3">
      <FanIcon rpm={rpm ?? 0} size={18} className="mb-1 text-t3" />
      <Lockup label={label} value={rpm} unit="rpm" />
    </div>
  )
}
