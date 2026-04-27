/**
 * Tests pro offlineStore. Foco no comportamento de sync (drenar fila),
 * tratamento de status codes (429/409/401/404/400), backoff, online/offline,
 * wipeAll, retryAction, dropAction.
 *
 * O offline.ts subjacente é mockado (não usa SQLite) — testamos a coreografia
 * do store + a lógica de tratamento de erro, não o storage. Os tests stateful
 * de offline.ts ficam em `services/offline-stateful.test.ts`.
 */

import { ApiError } from '@/services/api'
import type { PendingAction } from '@/services/offline'

interface OfflineMock {
  queue: PendingAction[]
  packets: { eventId: string; downloadedAt: string; participantCount: number; itemCount: number }[]
}

function setupMocks(mock: OfflineMock) {
  jest.doMock('@/services/offline', () => ({
    __esModule: true,
    loadQueue: jest.fn(async () => [...mock.queue]),
    loadIndex: jest.fn(async () => [...mock.packets]),
    updateQueueItem: jest.fn(async (id: string, patch: Partial<PendingAction>) => {
      const i = mock.queue.findIndex((q) => q.id === id)
      if (i >= 0) mock.queue[i] = { ...mock.queue[i], ...patch }
    }),
    removeFromQueue: jest.fn(async (id: string) => {
      mock.queue = mock.queue.filter((q) => q.id !== id)
    }),
    removeFromQueueByEvent: jest.fn(async (eventId: string) => {
      mock.queue = mock.queue.filter((q) => q.eventId !== eventId)
    }),
    clearQueue: jest.fn(async () => { mock.queue = [] }),
    wipePackets: jest.fn(async () => { mock.packets = [] }),
    removePacket: jest.fn(async (eventId: string) => {
      mock.packets = mock.packets.filter((p) => p.eventId !== eventId)
    }),
    savePacket: jest.fn(async () => undefined),
    countParticipantsInPacket: jest.fn(async () => 0),
    saveQueueBackup: jest.fn(async () => undefined),
    listQueueBackups: jest.fn(async () => []),
    migrateLegacyAsyncStorage: jest.fn(async () => undefined),
    purgeLegacyQueueBackup: jest.fn(async () => undefined),
    getPendingActionsForEvent: jest.fn(async (eventId: string) =>
      mock.queue.filter((q) => q.eventId === eventId && q.status !== 'synced').length,
    ),
  }))
}

function setupApiMock(behavior: 'ok' | 'rate' | 'conflict' | 'auth' | 'gone' | 'badreq' | 'fail' = 'ok') {
  const apiPost = jest.fn(async () => {
    if (behavior === 'ok') return undefined
    if (behavior === 'rate') throw new ApiError('rate', 429, undefined, 5)
    if (behavior === 'conflict') throw new ApiError('dup', 409)
    if (behavior === 'auth') throw new ApiError('expired', 401)
    if (behavior === 'gone') throw new ApiError('gone', 404)
    if (behavior === 'badreq') throw new ApiError('bad', 400)
    if (behavior === 'fail') throw new ApiError('boom', 500)
    return undefined
  })
  jest.doMock('@/services/api', () => ({
    __esModule: true,
    apiGet: jest.fn(),
    apiPost,
    apiLogout: jest.fn(async () => undefined),
    ApiError,
  }))
  return apiPost
}

const baseAction = (o: Partial<PendingAction>): PendingAction => ({
  id: 'a1',
  type: 'checkin',
  eventId: 'e1',
  participantId: 'p1',
  status: 'pending',
  attempts: 0,
  createdAt: '2026-04-26T00:00:00.000Z',
  ...o,
})

describe('offlineStore — syncNow happy path', () => {
  it('sincroniza ações pendentes (200 ok) e remove da fila', async () => {
    const state: OfflineMock = {
      queue: [baseAction({ id: 'a1' }), baseAction({ id: 'a2', participantId: 'p2' })],
      packets: [],
    }
    let apiCalls = 0
    await jest.isolateModulesAsync(async () => {
      jest.doMock('@/services/api', () => ({
        __esModule: true,
        apiGet: jest.fn(),
        apiPost: jest.fn(async () => { apiCalls++ }),
        apiLogout: jest.fn(),
        ApiError,
      }))
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      const result = await useOfflineStore.getState().syncNow()
      expect(result.synced).toBe(2)
      expect(result.failed).toBe(0)
      expect(state.queue).toHaveLength(0)
      expect(apiCalls).toBe(2)
    })
  })

  it('online=false → syncNow não roda', async () => {
    const state: OfflineMock = {
      queue: [baseAction({})], packets: [],
    }
    await jest.isolateModulesAsync(async () => {
      const apiPost = setupApiMock('ok')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: false })
      const result = await useOfflineStore.getState().syncNow()
      expect(result.synced).toBe(0)
      expect(apiPost).not.toHaveBeenCalled()
      expect(state.queue).toHaveLength(1)
    })
  })

  it('queue vazia → no-op', async () => {
    const state: OfflineMock = { queue: [], packets: [] }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('ok')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      const result = await useOfflineStore.getState().syncNow()
      expect(result).toEqual({ synced: 0, failed: 0 })
    })
  })
})

describe('offlineStore — syncNow status code handling', () => {
  it('429 → marca failed, NÃO remove da queue', async () => {
    const state: OfflineMock = { queue: [baseAction({})], packets: [] }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('rate')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      await useOfflineStore.getState().syncNow()
      expect(state.queue).toHaveLength(1)
      expect(state.queue[0].status).toBe('failed')
      expect(state.queue[0].nextRetryAt).toBeTruthy()
    })
  })

  it('409 conflict → REMOVE da queue (já processado), conta como synced', async () => {
    const state: OfflineMock = { queue: [baseAction({})], packets: [] }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('conflict')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      const result = await useOfflineStore.getState().syncNow()
      expect(result.synced).toBe(1)
      expect(state.queue).toHaveLength(0)
    })
  })

  it('401 auth expired → marca failed, NÃO remove (operador precisa relogar)', async () => {
    const state: OfflineMock = { queue: [baseAction({})], packets: [] }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('auth')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      const result = await useOfflineStore.getState().syncNow()
      expect(result.failed).toBe(1)
      expect(state.queue[0].status).toBe('failed')
      expect(state.queue[0].error).toMatch(/login|relog/i)
    })
  })

  it('404 not found → REMOVE silenciosamente (recurso deletado)', async () => {
    const state: OfflineMock = { queue: [baseAction({})], packets: [] }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('gone')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      const result = await useOfflineStore.getState().syncNow()
      expect(result.synced).toBe(1)
      expect(state.queue).toHaveLength(0)
    })
  })

  it('400 bad request → marca failed sem nextRetryAt (retry não resolve)', async () => {
    const state: OfflineMock = { queue: [baseAction({})], packets: [] }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('badreq')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      const result = await useOfflineStore.getState().syncNow()
      expect(result.failed).toBe(1)
      expect(state.queue[0].status).toBe('failed')
      // 400 não pega nextRetryAt — retry inútil pra payload inválido
      expect(state.queue[0].nextRetryAt).toBeUndefined()
    })
  })

  it('500 → marca failed COM nextRetryAt (retry pode resolver)', async () => {
    const state: OfflineMock = { queue: [baseAction({})], packets: [] }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('fail')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      await useOfflineStore.getState().syncNow()
      expect(state.queue[0].status).toBe('failed')
      expect(state.queue[0].nextRetryAt).toBeTruthy()
    })
  })

  it('attempts incrementa a cada tentativa', async () => {
    const state: OfflineMock = { queue: [baseAction({ attempts: 1 })], packets: [] }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('fail')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      await useOfflineStore.getState().syncNow()
      expect(state.queue[0].attempts).toBe(2)
    })
  })

  it('attempts >= MAX_AUTO_ATTEMPTS (3) NÃO entra no batch', async () => {
    const state: OfflineMock = { queue: [baseAction({ attempts: 3 })], packets: [] }
    await jest.isolateModulesAsync(async () => {
      const apiPost = setupApiMock('ok')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      const result = await useOfflineStore.getState().syncNow()
      expect(result.synced).toBe(0)
      expect(apiPost).not.toHaveBeenCalled()
    })
  })
})

describe('offlineStore — retryAction', () => {
  it('reseta attempts/status/nextRetryAt e dispara syncNow', async () => {
    const state: OfflineMock = {
      queue: [baseAction({ id: 'a1', status: 'failed', attempts: 3, nextRetryAt: 'future', error: 'boom' })],
      packets: [],
    }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('ok')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      await useOfflineStore.getState().retryAction('a1')
      // Após retry + syncNow successful, item foi removido (synced)
      expect(state.queue).toHaveLength(0)
    })
  })
})

describe('offlineStore — dropAction', () => {
  it('remove ação sem chamar API', async () => {
    const state: OfflineMock = { queue: [baseAction({ id: 'a1' })], packets: [] }
    await jest.isolateModulesAsync(async () => {
      const apiPost = setupApiMock('ok')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: true })
      await useOfflineStore.getState().dropAction('a1')
      expect(state.queue).toHaveLength(0)
      expect(apiPost).not.toHaveBeenCalled()
    })
  })
})

describe('offlineStore — wipeAll', () => {
  it('limpa packets + queue + state', async () => {
    const state: OfflineMock = {
      queue: [baseAction({ status: 'pending' })],
      packets: [{ eventId: 'e1', downloadedAt: 't', participantCount: 5, itemCount: 1 }],
    }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('ok')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({
        packets: state.packets,
        queue: state.queue,
        lastSync: { at: 't', synced: 0, failed: 0 },
      })
      await useOfflineStore.getState().wipeAll()
      expect(state.queue).toHaveLength(0)
      expect(state.packets).toHaveLength(0)
      const s = useOfflineStore.getState()
      expect(s.packets).toEqual([])
      expect(s.queue).toEqual([])
      expect(s.lastSync).toBeNull()
    })
  })

  it('faz backup das ações não-sincronizadas antes de limpar', async () => {
    const state: OfflineMock = {
      queue: [
        baseAction({ id: 'a1', status: 'pending' }),
        baseAction({ id: 'a2', status: 'failed' }),
        baseAction({ id: 'a3', status: 'synced' }), // não vira backup
      ],
      packets: [],
    }
    let backupArg: PendingAction[] | null = null
    await jest.isolateModulesAsync(async () => {
      setupApiMock('ok')
      setupMocks(state)
      const offline = require('@/services/offline') as { saveQueueBackup: jest.Mock }
      offline.saveQueueBackup.mockImplementationOnce(async (acts: PendingAction[]) => { backupArg = acts })
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ queue: state.queue, packets: state.packets })
      await useOfflineStore.getState().wipeAll()
    })
    expect(backupArg).toHaveLength(2)
    expect(backupArg!.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })
})

describe('offlineStore — deleteEvent', () => {
  it('remove packet + ações da queue do mesmo evento', async () => {
    const state: OfflineMock = {
      queue: [
        baseAction({ id: 'a1', eventId: 'e1' }),
        baseAction({ id: 'a2', eventId: 'e2' }),
      ],
      packets: [
        { eventId: 'e1', downloadedAt: 't', participantCount: 1, itemCount: 0 },
        { eventId: 'e2', downloadedAt: 't', participantCount: 1, itemCount: 0 },
      ],
    }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('ok')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      await useOfflineStore.getState().deleteEvent('e1')
      expect(state.queue.map((q) => q.id)).toEqual(['a2'])
      expect(state.packets.map((p) => p.eventId)).toEqual(['e2'])
    })
  })
})

describe('offlineStore — getPendingActionsForEvent', () => {
  it('delega pro service offline e conta apenas !synced', async () => {
    const state: OfflineMock = {
      queue: [
        baseAction({ id: 'a1', eventId: 'e1', status: 'pending' }),
        baseAction({ id: 'a2', eventId: 'e1', status: 'synced' }),
        baseAction({ id: 'a3', eventId: 'e1', status: 'failed' }),
      ],
      packets: [],
    }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('ok')
      setupMocks(state)
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      const count = await useOfflineStore.getState().getPendingActionsForEvent('e1')
      expect(count).toBe(2) // pending + failed
    })
  })
})

describe('offlineStore — recoverBackup', () => {
  it('soma action_count dos backups disponíveis', async () => {
    await jest.isolateModulesAsync(async () => {
      setupApiMock('ok')
      const state: OfflineMock = { queue: [], packets: [] }
      setupMocks(state)
      const offline = require('@/services/offline') as { listQueueBackups: jest.Mock }
      offline.listQueueBackups.mockResolvedValueOnce([
        { key: 'b1', at: 1, count: 3 },
        { key: 'b2', at: 2, count: 5 },
      ])
      const { useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      const result = await useOfflineStore.getState().recoverBackup()
      expect(result.found).toBe(8)
    })
  })
})

describe('offlineStore — isOnlineNow + getPacketMeta helpers', () => {
  it('isOnlineNow true se online=true ou null (otimismo)', async () => {
    const state: OfflineMock = { queue: [], packets: [] }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('ok')
      setupMocks(state)
      const { isOnlineNow, useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ online: null })
      expect(isOnlineNow()).toBe(true)
      useOfflineStore.setState({ online: true })
      expect(isOnlineNow()).toBe(true)
      useOfflineStore.setState({ online: false })
      expect(isOnlineNow()).toBe(false)
    })
  })

  it('getPacketMeta retorna packet ou undefined', async () => {
    const packets = [{ eventId: 'e1', downloadedAt: 't', participantCount: 5, itemCount: 0 }]
    const state: OfflineMock = { queue: [], packets }
    await jest.isolateModulesAsync(async () => {
      setupApiMock('ok')
      setupMocks(state)
      const { getPacketMeta, useOfflineStore } = require('@/stores/offlineStore') as typeof import('@/stores/offlineStore')
      useOfflineStore.setState({ packets })
      expect(getPacketMeta('e1')?.eventId).toBe('e1')
      expect(getPacketMeta('eX')).toBeUndefined()
    })
  })
})
