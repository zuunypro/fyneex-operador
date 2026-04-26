import { create } from 'zustand'
import { apiLogout } from '@/services/api'
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

interface LogoutOpts {
  /** Skipar chamada ao servidor (útil quando origem é 401 — token já inválido). */
  skipServer?: boolean
}

interface NavigationStore {
  isLoggedIn: boolean
  activeTab: TabId
  selectedEvent: EventInfo | null
  setIsLoggedIn: (v: boolean) => void
  setActiveTab: (tab: TabId) => void
  setSelectedEvent: (event: EventInfo | null) => void
  logout: (opts?: LogoutOpts) => Promise<void>
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  isLoggedIn: false,
  activeTab: 'dashboard',
  selectedEvent: null,
  setIsLoggedIn: (v) => set({ isLoggedIn: v }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedEvent: (event) => set({ selectedEvent: event }),
  logout: async (opts) => {
    // 1) Invalida o access_hash no servidor enquanto ainda temos o token em memória.
    //    Best-effort com timeout curto (3s) — se offline, segue jogo.
    if (!opts?.skipServer) {
      await apiLogout()
    }
    // 2) clearUser limpa AsyncStorage + SecureStore + reseta accessHashMirror.
    try { await useUserStore.getState().clearUser() } catch { /* ignore */ }
    set({ isLoggedIn: false, selectedEvent: null, activeTab: 'dashboard' })
  },
}))
