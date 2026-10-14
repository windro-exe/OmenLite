import { AnimatePresence, motion } from 'motion/react'
import { dismissToast, useStore } from '../lib/store'
import { EASE_OUT, cx } from './ui'

/** Errors and Undo-able actions only (DESIGN.md §8). Top-centre: the bottom of every screen holds controls and the dock. */
export function Toaster() {
  const toasts = useStore(s => s.toasts)
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[52px] z-40 flex flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {toasts.map(t => (
          <motion.div key={t.id} layout
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }} transition={{ duration: 0.18, ease: EASE_OUT }}
            className="raised pointer-events-auto flex h-10 items-center gap-3 rounded-group pl-4 pr-1.5 text-[13px] shadow-[0_18px_40px_-12px_rgb(0_0_0/0.7)]">
            {t.tone === 'error' && <span className="size-1.5 rounded-full bg-amber" aria-hidden />}
            <span className={cx(t.tone === 'error' ? 'text-t1' : 'text-t2', !t.action && 'pr-2.5')}>{t.text}</span>
            {t.action && (
              <button onClick={() => { t.action?.run(); dismissToast(t.id) }}
                className="press hover-raise h-7 rounded-pill bg-raise-2 px-3 text-[12px] font-medium text-t1">
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
