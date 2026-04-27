import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import type { User } from '@/schemas/user.schema'
import { clearAccessHash, getAccessHash, setAccessHash } from '@/services/secureToken'

const STORAGE_KEY = 'fyneex_mobile_user'

// In-memory mirror usado por api.ts (getAccessHashSync) porque o cliente HTTP
// não pode virar async. Hidratado em loadUserFromStorage() na inicialização e
// atualizado por setUser/clearUser.
let accessHashMirror: string | null = null

export function getAccessHashSync(): string | null {
  return accessHashMirror
}

interface UserState {
  user: User | null
  setUser: (user: User) => Promise<void>
  clearUser: () => Promise<void>
}

/**
 * Shape persistido no AsyncStorage. Sem accessHash — token vai pra SecureStore.
 * Hardening 2026-04-26: separação de PII (user data) e secret material (token).
 */
interface PersistedUser {
  id: string
  name: string
  email: string
  organizerId?: string
  role?: 'staff' | 'manager' | 'owner'
  eventScope?: string[] | null
}

function pickPersistable(user: User): PersistedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    organizerId: user.organizerId,
    role: user.role,
    eventScope: user.eventScope ?? null,
  }
}

export async function loadUserFromStorage(): Promise<User | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) {
      // Sem user em AsyncStorage; ainda assim limpa SecureStore pra evitar
      // token órfão de sessão anterior travada.
      const orphan = await getAccessHash()
      if (orphan) await clearAccessHash()
      return null
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') {
      return null
    }

    // ─── MIGRAÇÃO BACKWARD-COMPAT ────────────────────────────────────────
    // Se o user persistido ainda tem accessHash legacy (string), copia pra
    // SecureStore e re-salva sem o token. Idempotente — após uma migração,
    // próxima leitura cai no caminho normal.
    if (typeof parsed.accessHash === 'string' && parsed.accessHash.length > 0) {
      const legacyHash = parsed.accessHash
      try {
        await setAccessHash(legacyHash)
      } catch {
        // Se SecureStore falhou, não apaga o token do AsyncStorage — fallback
        // é continuar usando legacy até a próxima tentativa.
        const user: User = {
          id: parsed.id,
          name: String(parsed.name ?? ''),
          email: String(parsed.email ?? ''),
          accessHash: legacyHash,
          organizerId: typeof parsed.organizerId === 'string' ? parsed.organizerId : undefined,
          role: parsed.role === 'staff' || parsed.role === 'manager' || parsed.role === 'owner'
            ? parsed.role
            : undefined,
          eventScope: Array.isArray(parsed.eventScope)
            ? (parsed.eventScope.filter((x) => typeof x === 'string') as string[])
            : null,
        }
        accessHashMirror = legacyHash
        return user
      }
      const persisted = pickPersistable({
        id: parsed.id,
        name: String(parsed.name ?? ''),
        email: String(parsed.email ?? ''),
        accessHash: legacyHash,
        organizerId: typeof parsed.organizerId === 'string' ? parsed.organizerId : undefined,
        role: parsed.role === 'staff' || parsed.role === 'manager' || parsed.role === 'owner'
          ? parsed.role
          : undefined,
        eventScope: Array.isArray(parsed.eventScope)
          ? (parsed.eventScope.filter((x) => typeof x === 'string') as string[])
          : null,
      })
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
      } catch { /* best-effort */ }
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[migration] accessHash moved to SecureStore')
      }
      accessHashMirror = legacyHash
      return {
        id: persisted.id,
        name: persisted.name,
        email: persisted.email,
        accessHash: legacyHash,
        organizerId: persisted.organizerId,
        role: persisted.role,
        eventScope: persisted.eventScope ?? null,
      }
    }

    // ─── Caminho normal: lê user do AsyncStorage + token do SecureStore ──
    // Retry 1x (total 2 tentativas com 500ms de espaçamento). O Keystore do
    // Android falha transitoriamente nos primeiros segundos pós-boot em alguns
    // OEMs (Android 9-11) — sem retry, o usuário cairia direto pra LoginPage
    // mesmo tendo sessão válida persistida. O fallback de `parsed.accessHash`
    // legacy acima NÃO precisa de retry (token já está in-band no AsyncStorage).
    let hash: string | null = null
    for (let i = 0; i < 2; i++) {
      try {
        hash = await getAccessHash()
        if (hash) break
      } catch {
        /* ignore — retry abaixo */
      }
      if (i < 1) await new Promise((r) => setTimeout(r, 500))
    }
    if (!hash) {
      // Sem token = sem sessão. Não retorna user pra evitar UI logada sem
      // credencial pra fazer requests (api.ts retornaria 401 imediato).
      return null
    }
    const user: User = {
      id: parsed.id,
      name: String(parsed.name ?? ''),
      email: String(parsed.email ?? ''),
      accessHash: hash,
      organizerId: typeof parsed.organizerId === 'string' ? parsed.organizerId : undefined,
      role: parsed.role === 'staff' || parsed.role === 'manager' || parsed.role === 'owner'
        ? parsed.role
        : undefined,
      eventScope: Array.isArray(parsed.eventScope)
        ? (parsed.eventScope.filter((x) => typeof x === 'string') as string[])
        : null,
    }
    accessHashMirror = hash
    return user
  } catch {
    return null
  }
}

async function saveToStorage(user: User) {
  try {
    // Token vai pra SecureStore primeiro — se falhar, melhor não persistir
    // o user e deixar caller tratar erro do que ter user sem token.
    await setAccessHash(user.accessHash)
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pickPersistable(user)))
    accessHashMirror = user.accessHash
  } catch {
    // Best-effort: se persistência falha, ainda atualiza o mirror in-memory
    // pra que a sessão atual funcione (fallback degradado).
    accessHashMirror = user.accessHash
  }
}

async function removeFromStorage() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
  try {
    await clearAccessHash()
  } catch { /* ignore */ }
  accessHashMirror = null
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
