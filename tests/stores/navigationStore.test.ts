/**
 * Tests pro navigationStore (logged-in flag, tabs, evento selecionado, logout).
 *
 * Logout em particular tem ordem importante:
 *  1. Invalidar token no servidor (best-effort) ENQUANTO ainda temos o token
 *  2. Limpar storage local
 *  3. Resetar state in-memory
 * Inverter quebra o passo 1 (sem token) ou deixa state stale com user nulo.
 */

describe('navigationStore', () => {
  beforeEach(() => {
    jest.resetModules()
    const asMock = require('@react-native-async-storage/async-storage') as {
      default: { __reset: () => void }
    }
    asMock.default.__reset()
    const ss = require('expo-secure-store') as { __reset: () => void }
    ss.__reset()
  })

  it('estado inicial: deslogado, tab dashboard, sem evento', () => {
    const { useNavigationStore } = require('@/stores/navigationStore') as typeof import('@/stores/navigationStore')
    const s = useNavigationStore.getState()
    expect(s.isLoggedIn).toBe(false)
    expect(s.activeTab).toBe('dashboard')
    expect(s.selectedEvent).toBeNull()
  })

  it('setIsLoggedIn / setActiveTab / setSelectedEvent atualizam state', () => {
    const { useNavigationStore } = require('@/stores/navigationStore') as typeof import('@/stores/navigationStore')
    useNavigationStore.getState().setIsLoggedIn(true)
    expect(useNavigationStore.getState().isLoggedIn).toBe(true)

    useNavigationStore.getState().setActiveTab('checkin')
    expect(useNavigationStore.getState().activeTab).toBe('checkin')

    useNavigationStore.getState().setSelectedEvent({
      id: 'e1', name: 'Run', date: '2026-04-25', time: '08:00',
      location: 'SP', image: '', participants: 100,
    })
    expect(useNavigationStore.getState().selectedEvent?.id).toBe('e1')
  })

  it('logout reseta state e limpa user', async () => {
    const { useNavigationStore } = require('@/stores/navigationStore') as typeof import('@/stores/navigationStore')
    const { useUserStore } = require('@/stores/userStore') as typeof import('@/stores/userStore')

    await useUserStore.getState().setUser({ id: 'u1', name: 'A', email: 'a@b.com', accessHash: 'h1' })
    useNavigationStore.getState().setIsLoggedIn(true)
    useNavigationStore.getState().setActiveTab('stock')
    useNavigationStore.getState().setSelectedEvent({
      id: 'e1', name: 'Run', date: '', time: '', location: '', image: '', participants: 0,
    })

    await useNavigationStore.getState().logout({ skipServer: true })

    const s = useNavigationStore.getState()
    expect(s.isLoggedIn).toBe(false)
    expect(s.selectedEvent).toBeNull()
    expect(s.activeTab).toBe('dashboard')
    expect(useUserStore.getState().user).toBeNull()
  })

  it('logout({ skipServer: true }) NÃO chama apiLogout', async () => {
    // doMock antes de exigir o navigationStore — assegurar isolamento
    jest.resetModules()
    const apiLogoutMock = jest.fn(async () => undefined)
    jest.doMock('@/services/api', () => ({
      __esModule: true,
      apiLogout: apiLogoutMock,
      ApiError: class extends Error {
        status: number
        constructor(m: string, s: number) { super(m); this.status = s }
      },
    }))
    const { useNavigationStore } = require('@/stores/navigationStore') as typeof import('@/stores/navigationStore')
    await useNavigationStore.getState().logout({ skipServer: true })
    expect(apiLogoutMock).not.toHaveBeenCalled()
  })

  it('logout sem opts chama apiLogout antes de limpar', async () => {
    jest.resetModules()
    const apiLogoutMock = jest.fn(async () => undefined)
    jest.doMock('@/services/api', () => ({
      __esModule: true,
      apiLogout: apiLogoutMock,
      ApiError: class extends Error {
        status: number
        constructor(m: string, s: number) { super(m); this.status = s }
      },
    }))
    const { useNavigationStore } = require('@/stores/navigationStore') as typeof import('@/stores/navigationStore')
    await useNavigationStore.getState().logout()
    expect(apiLogoutMock).toHaveBeenCalledTimes(1)
  })

  it('logout é resiliente: clearUser falhando não impede reset de state', async () => {
    jest.resetModules()
    jest.doMock('@/stores/userStore', () => ({
      __esModule: true,
      useUserStore: {
        getState: () => ({
          clearUser: jest.fn(async () => { throw new Error('storage fail') }),
        }),
      },
      getAccessHashSync: () => null,
    }))
    jest.doMock('@/services/api', () => ({
      __esModule: true,
      apiLogout: jest.fn(async () => undefined),
      ApiError: class extends Error {
        status: number
        constructor(m: string, s: number) { super(m); this.status = s }
      },
    }))
    const { useNavigationStore } = require('@/stores/navigationStore') as typeof import('@/stores/navigationStore')
    useNavigationStore.getState().setIsLoggedIn(true)
    await expect(useNavigationStore.getState().logout({ skipServer: true })).resolves.not.toThrow()
    expect(useNavigationStore.getState().isLoggedIn).toBe(false)
  })
})
