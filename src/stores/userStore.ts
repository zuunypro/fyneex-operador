import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import type { User } from '@/schemas/user.schema'

const STORAGE_KEY = 'fyneex_mobile_user'

// In-memory mirror usado por api.ts (getAccessHashSync) porque o cliente HTTP
// não pode virar async. Hidratado em loadUserFromStorage() na inicialização.
let accessHashMirror: string | null = null

export function getAccessHashSync(): string | null {
  return accessHashMirror
}

interface UserState {
  user: User | null
  setUser: (user: User) => Promise<void>
  clearUser: () => Promise<void>
}

export async function loadUserFromStorage(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      'id' in parsed &&
      'accessHash' in parsed &&
      typeof (parsed as Record<string, unknown>).accessHash === 'string'
    ) {
      const user = parsed as User
      accessHashMirror = user.accessHash
      return user
    }
    return null
  } catch {
    return null
  }
}

async function saveToStorage(user: User) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    accessHashMirror = user.accessHash
  } catch { /* ignore */ }
}

async function removeFromStorage() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY)
    accessHashMirror = null
  } catch { /* ignore */ }
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  setUser: async (user) => {
    await saveToStorage(user)
    set({ user })
  },
  clearUser: async () => {
    await removeFromStorage()
    set({ user: null })
  },
}))
