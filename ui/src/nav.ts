import { Fan, House, Keyboard, Settings, Zap, type LucideIcon } from 'lucide-react'

// Shared by the shell (App) and the command palette; kept separate so they don't import each other.
export type Page = 'home' | 'performance' | 'lighting' | 'boost' | 'settings'
export const NAV: { id: Page; icon: LucideIcon; label: string }[] = [
  { id: 'home', icon: House, label: 'Home' },
  { id: 'performance', icon: Fan, label: 'Performance' },
  { id: 'lighting', icon: Keyboard, label: 'Keyboard' },
  { id: 'boost', icon: Zap, label: 'Boost' },
  { id: 'settings', icon: Settings, label: 'Settings' },
]
