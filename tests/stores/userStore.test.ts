/**
 * Tests pro userStore (persistência User + accessHash).
 *
 * Cobertura crítica:
 *  - setUser/clearUser persistem corretamente em AsyncStorage + SecureStore
 *  - loadUserFromStorage é resiliente a JSON corrompido
 *  - Migração legacy (accessHash em AsyncStorage → SecureStore) idempotente
 *  - getAccessHashSync espelha o estado in-memory pro api.ts
 *  - Token órfão sem user é limpo na load (defesa contra leak)
 */

describe('userStore', () => {
  beforeEach(() => {
    jest.resetModules()
    // Reset dos mocks de storage entre testes pra isolar estado
    const asMock = require('@react-native-async-storage/async-storage') as {
      default: { __reset: () => void }
    }
    asMock.default.__reset()
    const ss = require('expo-secure-store') as { __reset: () => void }
    ss.__reset()
  })

  it('setUser persiste user separadamente do token', async () => {
    const { useUserStore, getAccessHashSync } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    await useUserStore.getState().setUser({
      id: 'u1',
      name: 'Op A',
      email: 'a@b.com',
      accessHash: 'hash-secret-xxx',
      organizerId: 'org-1',
    })
    expect(useUserStore.getState().user?.id).toBe('u1')
    expect(getAccessHashSync()).toBe('hash-secret-xxx')

    // O AsyncStorage NÃO deve guardar o token
    const asMock = require('@react-native-async-storage/async-storage') as {
      default: { getItem: (k: string) => Promise<string | null> }
    }
    const raw = await asMock.default.getItem('fyneex_mobile_user')
    expect(raw).toBeTruthy()
    expect(raw).not.toContain('hash-secret-xxx')
    expect(JSON.parse(raw!)).toMatchObject({ id: 'u1', name: 'Op A', email: 'a@b.com', organizerId: 'org-1' })
  })

  it('clearUser zera tudo (state + AsyncStorage + SecureStore + mirror)', async () => {
    const { useUserStore, getAccessHashSync } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    await useUserStore.getState().setUser({
      id: 'u1', name: 'Op', email: 'a@b.com', accessHash: 'h1',
    })
    await useUserStore.getState().clearUser()
    expect(useUserStore.getState().user).toBeNull()
    expect(getAccessHashSync()).toBeNull()
    const ss = require('expo-secure-store') as { getItemAsync: (k: string) => Promise<string | null> }
    expect(await ss.getItemAsync('fyneex_access_hash')).toBeNull()
  })

  it('loadUserFromStorage retorna null se nada gravado', async () => {
    const { loadUserFromStorage } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    expect(await loadUserFromStorage()).toBeNull()
  })

  it('loadUserFromStorage migra accessHash legacy de AsyncStorage pra SecureStore', async () => {
    const asMock = require('@react-native-async-storage/async-storage') as {
      default: { setItem: (k: string, v: string) => Promise<void> }
    }
    await asMock.default.setItem('fyneex_mobile_user', JSON.stringify({
      id: 'u1', name: 'Op', email: 'a@b.com',
      accessHash: 'legacy-hash-123', // ← formato pré-hardening
      organizerId: 'org-1',
    }))

    const { loadUserFromStorage } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    const user = await loadUserFromStorage()
    expect(user).toMatchObject({ id: 'u1', accessHash: 'legacy-hash-123' })

    // Após migração, SecureStore tem o token
    const ss = require('expo-secure-store') as { getItemAsync: (k: string) => Promise<string | null> }
    expect(await ss.getItemAsync('fyneex_access_hash')).toBe('legacy-hash-123')

    // E AsyncStorage NÃO tem mais o token (re-salvo sem ele)
    const reread = await (asMock.default as unknown as { getItem: (k: string) => Promise<string | null> })
      .getItem('fyneex_mobile_user')
    expect(reread).not.toContain('legacy-hash-123')
  })

  it('loadUserFromStorage retorna null se SecureStore não tem token (sessão sem cred)', async () => {
    const asMock = require('@react-native-async-storage/async-storage') as {
      default: { setItem: (k: string, v: string) => Promise<void> }
    }
    // User válido em AsyncStorage, mas sem token no SecureStore
    await asMock.default.setItem('fyneex_mobile_user', JSON.stringify({
      id: 'u1', name: 'Op', email: 'a@b.com', organizerId: 'org-1',
    }))

    const { loadUserFromStorage } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    const user = await loadUserFromStorage()
    expect(user).toBeNull()
  })

  it('regressão: JSON corrompido no AsyncStorage → null sem crash', async () => {
    const asMock = require('@react-native-async-storage/async-storage') as {
      default: { setItem: (k: string, v: string) => Promise<void> }
    }
    await asMock.default.setItem('fyneex_mobile_user', '{not valid json')

    const { loadUserFromStorage } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    await expect(loadUserFromStorage()).resolves.toBeNull()
  })

  it('regressão: shape inválido (sem id) → null', async () => {
    const asMock = require('@react-native-async-storage/async-storage') as {
      default: { setItem: (k: string, v: string) => Promise<void> }
    }
    await asMock.default.setItem('fyneex_mobile_user', JSON.stringify({ name: 'só nome' }))

    const { loadUserFromStorage } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    expect(await loadUserFromStorage()).toBeNull()
  })

  it('regressão: token órfão (sem user em AsyncStorage) é limpo do SecureStore', async () => {
    const ss = require('expo-secure-store') as {
      setItemAsync: (k: string, v: string) => Promise<void>
      getItemAsync: (k: string) => Promise<string | null>
    }
    await ss.setItemAsync('fyneex_access_hash', 'orphan-token')

    const { loadUserFromStorage } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    expect(await loadUserFromStorage()).toBeNull()
    expect(await ss.getItemAsync('fyneex_access_hash')).toBeNull()
  })

  it('getAccessHashSync sempre reflete o último setUser', async () => {
    const { useUserStore, getAccessHashSync } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    expect(getAccessHashSync()).toBeNull()
    await useUserStore.getState().setUser({ id: 'u1', name: 'A', email: 'a@b.com', accessHash: 'h1' })
    expect(getAccessHashSync()).toBe('h1')
    await useUserStore.getState().setUser({ id: 'u1', name: 'A', email: 'a@b.com', accessHash: 'h2' })
    expect(getAccessHashSync()).toBe('h2')
    await useUserStore.getState().clearUser()
    expect(getAccessHashSync()).toBeNull()
  })

  it('roundtrip: setUser + loadUserFromStorage retorna o mesmo user (sem token no JSON)', async () => {
    const { useUserStore } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    await useUserStore.getState().setUser({
      id: 'u-rt', name: 'RT', email: 'rt@b.com', accessHash: 'rt-h', organizerId: 'org-rt',
    })

    // Reseta apenas o módulo userStore para simular novo app boot
    jest.resetModules()
    const { loadUserFromStorage } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    const user = await loadUserFromStorage()
    expect(user).toMatchObject({
      id: 'u-rt', name: 'RT', email: 'rt@b.com', accessHash: 'rt-h', organizerId: 'org-rt',
    })
  })
})
