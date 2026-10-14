import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { Minus, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { call, isNative } from './lib/bridge'
import { clearToasts, useStore } from './lib/store'
import { NAV, type Page } from './nav'
import { Kbd, cx } from './components/ui'
import { CommandPalette } from './components/CommandPalette'
import { Toaster } from './components/Toaster'
import { Home } from './pages/Home'
import { Performance } from './pages/Performance'
import { Lighting } from './pages/Lighting'
import { Boost } from './pages/Boost'
import { SettingsPage } from './pages/Settings'

// Screens are composed for this stage size and zoomed uniformly to fit the window (min window 1000×680).
const STAGE_W = 1240, STAGE_H = 776

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [palette, setPalette] = useState(false)
  // Messages belong to the screen that raised them (e.g. Undo for the keyboard).
  const go = (p: Page) => { clearToasts(); setPage(p) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); return }
      const typing = e.target instanceof HTMLInputElement
      if (typing || palette || e.altKey || e.metaKey) return
      const n = Number(e.key)
      if (e.ctrlKey && n >= 1 && n <= NAV.length) { e.preventDefault(); clearToasts(); setPage(NAV[n - 1].id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [palette])

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full flex-col overflow-hidden">
        <TitleStrip onPalette={() => setPalette(true)} />
        <Stage>
          {/* Screen switching is high-frequency: opacity only, ≤ 120 ms, no movement (DESIGN.md §7). */}
          <motion.div key={page} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.1, ease: 'linear' }}>
            {page === 'home' && <Home go={go} />}
            {page === 'performance' && <Performance />}
            {page === 'lighting' && <Lighting />}
            {page === 'boost' && <Boost />}
            {page === 'settings' && <SettingsPage />}
          </motion.div>
        </Stage>
        <Dock page={page} go={go} />
        <CommandPalette open={palette} onClose={() => setPalette(false)} go={go} />
        <Toaster />
      </div>
    </MotionConfig>
  )
}

/** Fits the fixed-size composition into the window with CSS zoom (layout-aware, keeps text crisp). */
function Stage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [zoom, setZoom] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setZoom(Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <main ref={ref} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden">
      <div className="relative" style={{ width: STAGE_W, height: STAGE_H, zoom }}>{children}</div>
    </main>
  )
}

function TitleStrip({ onPalette }: { onPalette: () => void }) {
  const perf = useStore(s => s.hw?.perf)
  const boost = useStore(s => s.hw?.boost)
  return (
    <header
      onPointerDown={e => { if (isNative && e.target === e.currentTarget && e.button === 0) void call('win.drag') }}
      className="relative z-10 flex h-11 shrink-0 items-center gap-5 pl-5 pr-1.5">
      <span className="pointer-events-none text-[14px] font-medium tracking-[-0.01em]">OMEN<span className="text-t3"> Lite</span></span>
      <span className="pointer-events-none mono-label flex items-center gap-2">
        {boost && <span className="size-1.5 rounded-full bg-red" aria-hidden />}
        {boost ? 'boost' : perf?.toLowerCase()}
      </span>
      <span className="pointer-events-none flex-1" />
      <button onClick={onPalette} className="press hover-text flex h-7 items-center gap-2 rounded-pill px-2 text-[12px] text-t3">
        Quick actions <Kbd>Ctrl K</Kbd>
      </button>
      {isNative && (
        <div className="flex">
          <WinButton label="Minimize" onClick={() => void call('win.minimize')}><Minus size={14} /></WinButton>
          <WinButton label="Close to tray" danger onClick={() => void call('win.close')}><X size={14} /></WinButton>
        </div>
      )}
    </header>
  )
}

function WinButton({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button aria-label={label} title={label} onClick={onClick}
      className={cx('grid h-8 w-10 place-items-center rounded-pill text-t3 transition-colors hover:text-t1', danger ? 'hover:bg-red' : 'hover:bg-raise-1')}>
      {children}
    </button>
  )
}

/** The only glass surface (DESIGN.md §6). Active item switches instantly. */
function Dock({ page, go }: { page: Page; go: (p: Page) => void }) {
  const [tip, setTip] = useState<Page | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = (id: Page, delay: number) => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setTip(id), delay) }
  const hide = () => { clearTimeout(timer.current); setTip(null) }
  return (
    <nav aria-label="Screens" className="glass absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-dock p-1.5">
      {NAV.map(({ id, icon: Icon, label }, i) => (
        <button key={id} onClick={() => go(id)} aria-label={label} aria-current={page === id ? 'page' : undefined}
          onPointerEnter={() => show(id, 450)} onPointerLeave={hide} onFocus={() => show(id, 0)} onBlur={hide}
          className={cx('press relative grid size-11 place-items-center rounded-dock-item',
            page === id ? 'bg-white/10 text-t1' : 'text-t3 hover:text-t1')}>
          <Icon size={19} strokeWidth={1.6} />
          <AnimatePresence>
            {tip === id && (
              <motion.span initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }}
                transition={{ duration: 0.14 }}
                className="raised pointer-events-none absolute bottom-[calc(100%+10px)] flex items-center gap-2 whitespace-nowrap rounded-pill px-2.5 py-1.5 text-[12px] text-t1">
                {label} <Kbd>Ctrl {i + 1}</Kbd>
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      ))}
    </nav>
  )
}
