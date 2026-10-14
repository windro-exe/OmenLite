import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GPU_MODES, isNative, type GpuMode } from '../lib/bridge'
import { setAutostart, setGpuMode } from '../lib/actions'
import { useStore } from '../lib/store'
import { Button, EASE_OUT, Segmented, Switch } from '../components/ui'

const GPU_TEXT: Record<GpuMode, string> = {
  Hybrid: 'Integrated graphics drive the screen; NVIDIA joins for games. Longest battery life.',
  Discrete: 'NVIDIA drives the screen directly. Lowest latency, highest power use.',
  Optimus: 'The NVIDIA driver switches between the two automatically.',
}

/** Settings: no subject, one flush list split by hairlines (DESIGN.md §2, §10). */
export function SettingsPage() {
  const hw = useStore(s => s.hw)
  const busyAuto = useStore(s => s.busy.autostart)
  const [pending, setPending] = useState<GpuMode | null>(null)
  const [changed, setChanged] = useState(false)
  const gpuRow = useRef<HTMLDivElement>(null)
  // Return focus to the active graphics option, so keyboard users land where they started.
  const closeDialog = () => {
    setPending(null)
    requestAnimationFrame(() => gpuRow.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
  if (!hw) return null
  return (
    <div className="relative size-full">
      <div className="absolute left-14 top-6">
        <h1 className="text-[22px] font-normal tracking-[-0.02em]">Settings</h1>
      </div>
      <div className="mx-auto w-[680px] divide-y divide-hairline pt-[120px]">
        <Row title="Graphics mode" text={GPU_TEXT[hw.gpuMode]} note={changed ? 'Restart to apply' : undefined}>
          <div ref={gpuRow}>
            <Segmented<GpuMode> label="Graphics mode" options={GPU_MODES} value={hw.gpuMode} onChange={m => { if (m !== hw.gpuMode) setPending(m) }} />
          </div>
        </Row>
        <Row title="Start with Windows" text="Opens quietly in the tray when you sign in.">
          <Switch label="Start with Windows" checked={hw.autostart} busy={busyAuto} onChange={v => void setAutostart(v)} />
        </Row>
        <Row title="Model" text={hw.model}><span /></Row>
        <Row title="BIOS" text={`Version ${hw.bios}`}>
          <span className="mono-label">{isNative ? 'connected' : 'simulated'}</span>
        </Row>
      </div>

      <ConfirmGpu mode={pending} onCancel={closeDialog} onConfirm={async m => {
        closeDialog()
        const r = await setGpuMode(m)
        if (r.ok) setChanged(true)
      }} />
    </div>
  )
}

function Row({ title, text, note, children }: { title: string; text: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[76px] items-center gap-8 py-4">
      <div className="flex-1">
        <div className="flex items-center gap-3 text-[14px] text-t1">
          {title}
          {note && <span className="mono-label text-amber">{note.toLowerCase()}</span>}
        </div>
        <div className="mt-1 leading-snug text-t3">{text}</div>
      </div>
      {children}
    </div>
  )
}

function ConfirmGpu({ mode, onCancel, onConfirm }: { mode: GpuMode | null; onCancel: () => void; onConfirm: (m: GpuMode) => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (mode) cancel.current?.focus() }, [mode])
  return (
    <AnimatePresence>
      {mode && (
        <motion.div className="fixed inset-0 z-30 grid place-items-center bg-black/55"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.18 }}
          onPointerDown={e => { if (e.target === e.currentTarget) onCancel() }}
          onKeyDown={e => { if (e.key === 'Escape') onCancel() }}>
          <motion.div role="alertdialog" aria-modal aria-labelledby="gpu-title" aria-describedby="gpu-desc"
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="raised w-[420px] rounded-group p-6 shadow-[0_24px_60px_-16px_rgb(0_0_0/0.8)]">
            <h2 id="gpu-title" className="text-[17px] font-normal tracking-[-0.01em]">Switch graphics to {mode}?</h2>
            <p id="gpu-desc" className="mt-2 leading-relaxed text-t2">
              The change applies after a restart. If the screen stays black afterwards, connect an external monitor or reset the BIOS to defaults with F10.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button ref={cancel} variant="quiet" onClick={onCancel}>Cancel</Button>
              <Button onClick={() => onConfirm(mode)}>Switch to {mode}</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
