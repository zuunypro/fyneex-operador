import { create } from 'zustand'

export type TabId = 'dashboard' | 'checkin' | 'stock' | 'profile'

export interface EventInfo {
  id: string
  name: string
  date: string
  time: string
  location: string
  image: string
  participants: number
}

interface NavigationStore {
  isLoggedIn: boolean
  activeTab: TabId
  selectedEvent: EventInfo | null
  setIsLoggedIn: (v: boolean) => void
  setActiveTab: (tab: TabId) => void
  setSelectedEvent: (event: EventInfo | null) => void
  logout: () => void
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  isLoggedIn: false,
  activeTab: 'dashboard',
  selectedEvent: null,
  setIsLoggedIn: (v) => set({ isLoggedIn: v }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedEvent: (event) => set({ selectedEvent: event }),
  logout: () => {
    try { localStorage.removeItem('fyneex_mobile_user') } catch { /* ignore */ }
    set({ isLoggedIn: false, selectedEvent: null, activeTab: 'dashboard' })
  },
}))
