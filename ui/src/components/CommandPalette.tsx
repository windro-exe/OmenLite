import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NAV, type Page } from '../nav'
import { PERF_MODES } from '../lib/bridge'
import { setBacklight, setBoost, setMaxFan, setManualFan, setPerf, setZones } from '../lib/actions'
import { currentHw } from '../lib/store'
import { Kbd, cx } from './ui'

interface Cmd { id: string; label: string; group: string; run: () => void }

const COLOURS: [string, string][] = [['red', '#FF1E27'], ['white', '#FFFFFF'], ['cyan', '#00C8FF'], ['violet', '#8A3CFF'], ['amber', '#FFB000']]

/** Ctrl+K: keyboard-initiated and frequent, so it opens instantly (DESIGN.md §7). */
export function CommandPalette({ open, onClose, go }: { open: boolean; onClose: () => void; go: (p: Page) => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const cmds = useMemo<Cmd[]>(() => [
    ...PERF_MODES.map(m => ({ id: `perf-${m}`, label: `${m} mode`, group: 'Performance', run: () => void setPerf(m) })),
    { id: 'maxfan', label: 'Max fan on or off', group: 'Fans', run: () => void setMaxFan(!currentHw()?.maxFan) },
    { id: 'autofan', label: 'Automatic fans', group: 'Fans', run: () => void setManualFan(null) },
    ...COLOURS.map(([n, c]) => ({ id: `kb-${n}`, label: `Keyboard ${n}`, group: 'Keyboard', run: () => void setZones([c, c, c, c], `Keyboard ${n}`) })),
    { id: 'backlight', label: 'Backlight on or off', group: 'Keyboard', run: () => void setBacklight(!currentHw()?.backlight) },
    { id: 'boost', label: 'Game boost on or off', group: 'Boost', run: () => void setBoost(!currentHw()?.boost) },
    ...NAV.map(n => ({ id: `go-${n.id}`, label: `Open ${n.label}`, group: 'Go to', run: () => go(n.id) })),
  ], [go])

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return cmds.filter(c => words.every(w => `${c.label} ${c.group}`.toLowerCase().includes(w)))
  }, [q, cmds])

  useEffect(() => { if (open) { setQ(''); setSel(0); input.current?.focus() } }, [open])
  // Escape closes from anywhere, not only while focus is inside the dialog.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => { listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' }) }, [sel])
  useEffect(() => setSel(0), [q])
  const run = (c: Cmd | undefined) => { if (!c) return; onClose(); c.run() }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/50 pt-[16vh]"
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal aria-label="Quick actions"
        className="raised w-[520px] overflow-hidden rounded-group shadow-[0_24px_60px_-16px_rgb(0_0_0/0.8)]"
        onKeyDown={e => {
          if (e.key === 'Tab') { e.preventDefault(); input.current?.focus() } // the input is the only stop: keep focus in the dialog
          else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(list.length - 1, s + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
          else if (e.key === 'Enter') run(list[sel])
        }}>
        <div className="flex items-center gap-3 px-4 shadow-[inset_0_-1px_0_var(--color-hairline)]">
          <Search size={15} className="text-t3" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Type a command"
            className="no-ring h-12 flex-1 bg-transparent text-[14px] text-t1 outline-none placeholder:text-t3" />
          <Kbd>Esc</Kbd>
        </div>
        <ul ref={listRef} className="max-h-[320px] overflow-y-auto p-1.5" role="listbox">
          {list.length === 0 && <li className="px-3 py-6 text-center text-t3">No command matches “{q}”.</li>}
          {list.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel} onPointerMove={() => setSel(i)} onClick={() => run(c)}
              className={cx('flex h-10 items-center justify-between rounded-pill px-3', i === sel ? 'bg-raise-2 text-t1' : 'text-t2')}>
              <span>{c.label}</span>
              <span className="mono-label flex items-center gap-2">{c.group.toLowerCase()}{i === sel && <CornerDownLeft size={12} />}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
