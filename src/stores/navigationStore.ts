import { create } from 'zustand'
import { useUserStore } from '@/stores/userStore'

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
  logout: () => Promise<void>
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  isLoggedIn: false,
  activeTab: 'dashboard',
  selectedEvent: null,
  setIsLoggedIn: (v) => set({ isLoggedIn: v }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedEvent: (event) => set({ selectedEvent: event }),
  logout: async () => {
    // clearUser limpa AsyncStorage + reseta accessHashMirror (token em memória).
    // Centraliza aqui pra garantir que os dois stores ficam em sincronia.
    try { await useUserStore.getState().clearUser() } catch { /* ignore */ }
    set({ isLoggedIn: false, selectedEvent: null, activeTab: 'dashboard' })
  },
}))
