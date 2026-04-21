import { create } from 'zustand'
import type { User } from '../schemas/user.schema'

const STORAGE_KEY = 'fyneex_mobile_user'

interface UserState {
  user: User | null
  setUser: (user: User) => void
  clearUser: () => void
  loadFromStorage: () => User | null
}

function saveToStorage(user: User) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
  } catch { /* ignore */ }
}

function removeFromStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}

export function loadUserFromStorage(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'id' in parsed &&
      'accessHash' in parsed &&
      typeof (parsed as Record<string, unknown>).accessHash === 'string'
    ) {
      return parsed as User
    }
    return null
  } catch {
    return null
  }
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  setUser: (user) => {
    saveToStorage(user)
    set({ user })
  },
  clearUser: () => {
    removeFromStorage()
    set({ user: null })
  },
  loadFromStorage: () => {
    const user = loadUserFromStorage()
    if (user) set({ user })
    return user
  },
}))
