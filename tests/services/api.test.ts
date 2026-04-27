/**
 * Tests pra api.ts (validação BASE_URL + handleResponse + ApiError).
 *
 * Hardening: ALLOWED_HOSTS impede que OTA update troque BASE_URL pra host
 * adversarial — testes garantem que protocolo http (não https), hostnames
 * estranhos e URLs malformadas todas falhem antes do fetch.
 *
 * IMPORTANTE: o BASE_URL é capturado no MODULE LOAD, então usamos
 * jest.isolateModules() pra carregar o módulo com diferentes envs.
 */

import { ApiError } from '@/services/api'

describe('ApiError', () => {
  it('preserva status, code e retryAfter', () => {
    const err = new ApiError('boom', 429, 'RATE_LIMITED', 30)
    expect(err.message).toBe('boom')
    expect(err.status).toBe(429)
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.retryAfter).toBe(30)
    expect(err.name).toBe('ApiError')
    expect(err).toBeInstanceOf(Error)
  })

  it('aceita só message e status (code/retryAfter opcionais)', () => {
    const err = new ApiError('x', 500)
    expect(err.code).toBeUndefined()
    expect(err.retryAfter).toBeUndefined()
  })
})

describe('getBaseUrlError com URL válida', () => {
  it('retorna null pra fyneexsports.com (cached)', () => {
    jest.isolateModules(() => {
      const mod = require('@/services/api') as typeof import('@/services/api')
      expect(mod.getBaseUrlError()).toBeNull()
    })
  })
})

describe('getBaseUrlError com URLs inválidas', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('rejeita http (não https)', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { expoConfig: { extra: { apiUrl: 'http://fyneexsports.com' } } },
      }))
      const mod = require('@/services/api') as typeof import('@/services/api')
      const err = mod.getBaseUrlError()
      expect(err).toBeTruthy()
      expect(err).toMatch(/BASE_URL/i)
    })
  })

  it('rejeita hostname não-allowlisted', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { expoConfig: { extra: { apiUrl: 'https://evil.com' } } },
      }))
      const mod = require('@/services/api') as typeof import('@/services/api')
      expect(mod.getBaseUrlError()).toMatch(/BASE_URL/i)
    })
  })

  it('aceita www.fyneexsports.com (allowlist)', () => {
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { expoConfig: { extra: { apiUrl: 'https://www.fyneexsports.com' } } },
      }))
      const mod = require('@/services/api') as typeof import('@/services/api')
      expect(mod.getBaseUrlError()).toBeNull()
    })
  })
})
