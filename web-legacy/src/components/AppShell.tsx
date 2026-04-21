import type { ReactNode } from 'react'
import { StatusBar } from './StatusBar'
import { BottomNav } from './BottomNav'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame no-scrollbar" style={{ background: '#111111', minHeight: '100dvh' }}>
      <StatusBar />
      {children}
      <BottomNav />
    </div>
  )
}
