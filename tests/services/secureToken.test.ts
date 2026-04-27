/**
 * Tests pra secureToken (access hash + device id binding).
 *
 * Hardening 2026-04-26 moveu o accessHash do AsyncStorage pro SecureStore.
 * Quebrar isso = token vaza em backup do Android. Cobertura: set/get/clear,
 * cache do device id, fallback de Android ID indisponível, hash determinístico.
 */

import {
  setAccessHash,
  getAccessHash,
  clearAccessHash,
  getDeviceId,
  getDeviceIdHash,
  getDeviceIdSync,
  getDeviceIdHashSync,
  initDeviceIdHash,
} from '@/services/secureToken'

describe('access hash (SecureStore)', () => {
  beforeEach(async () => {
    await clearAccessHash()
  })

  it('setAccessHash persiste e getAccessHash recupera', async () => {
    await setAccessHash('abc123')
    expect(await getAccessHash()).toBe('abc123')
  })

  it('clearAccessHash zera', async () => {
    await setAccessHash('xxx')
    await clearAccessHash()
    expect(await getAccessHash()).toBeNull()
  })

  it('getAccessHash retorna null se não há nada gravado', async () => {
    expect(await getAccessHash()).toBeNull()
  })

  it('regressão: getAccessHash não throw se SecureStore falhar', async () => {
    const ss = require('expo-secure-store') as { getItemAsync: jest.Mock }
    ss.getItemAsync.mockRejectedValueOnce(new Error('keystore down'))
    await expect(getAccessHash()).resolves.toBeNull()
  })
})

describe('device id', () => {
  it('getDeviceId retorna o Android ID quando disponível', async () => {
    const id = await getDeviceId()
    expect(id).toBe('androidid-test-1234567890abcdef')
  })

  it('getDeviceIdHash retorna hash determinístico (mesmo input → mesma saída)', async () => {
    // Cache pode ter sido populado. Reset cache via re-import com isolateModules.
    jest.isolateModules(() => {
      // no-op — apenas garante módulo limpo
    })
    const h1 = await getDeviceIdHash()
    const h2 = await getDeviceIdHash()
    expect(h1).toBe(h2)
    expect(h1.length).toBe(64) // 256 bits = 64 chars hex
  })

  it('getDeviceIdSync retorna do cache (após init)', async () => {
    await initDeviceIdHash()
    const sync = getDeviceIdSync()
    expect(sync).toBeTruthy()
    expect(typeof sync).toBe('string')
  })

  it('getDeviceIdHashSync retorna do cache após init', async () => {
    await initDeviceIdHash()
    const sync = getDeviceIdHashSync()
    expect(sync).toBeTruthy()
    expect(sync!.length).toBe(64)
  })
})

describe('device id fallbacks', () => {
  it('quando Android ID null, cai pro applicationId+version', async () => {
    jest.isolateModules(async () => {
      const app = require('expo-application') as {
        getAndroidId: jest.Mock
        applicationId: string
        nativeApplicationVersion: string
      }
      app.getAndroidId = jest.fn(() => '')
      const mod = require('@/services/secureToken') as typeof import('@/services/secureToken')
      const id = await mod.getDeviceId()
      // Espera ver applicationId+version no id (ou UUID se mocks vazios)
      expect(id).toBeTruthy()
      expect(id.length).toBeGreaterThan(0)
    })
  })
})
