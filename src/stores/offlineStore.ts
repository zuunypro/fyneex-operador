/**
 * Offline store — estado global de conectividade, fila de ações pendentes e
 * packets baixados. A responsabilidade de persistência fica em
 * `@/services/offline`; este arquivo só expõe o estado reativo pro React.
 *
 * Sync: um único worker roda `syncNow()` sempre que voltamos online E tem
 * item pendente. Drena a fila em ordem, chamando a API diretamente (sem
 * passar pelos hooks, porque isso gera loops).
 */

import NetInfo from '@react-native-community/netinfo'
import { create } from 'zustand'
import { apiGet, apiPost, ApiError } from '@/services/api'
import type { MobileParticipant } from '@/hooks/useParticipants'
import type { InventoryItem, InventoryStats } from '@/hooks/useInventory'
import {
  loadIndex,
  loadQueue,
  loadPacket,
  removeFromQueue,
  removePacket,
  savePacket,
  updateQueueItem,
  type PacketMeta,
  type PendingAction,
} from '@/services/offline'

interface DownloadProgress {
  step: 'participants' | 'inventory' | 'saving' | 'done'
  message: string
  percent: number
}

interface OfflineState {
  /** null = estado inicial desconhecido; true/false depois que NetInfo reportou. */
  online: boolean | null
  packets: PacketMeta[]
  queue: PendingAction[]
  syncing: boolean
  downloading: { eventId: string; progress: DownloadProgress } | null
  /** Contador do último sync pra mostrar toast. */
  lastSync: {
    at: string
    synced: number
    failed: number
  } | null
  /** Hidrata o estado inicial do disco. Idempotente. */
  hydrate: () => Promise<void>
  /** Dispara manualmente (pull-to-refresh, botão "Sincronizar agora"). */
  syncNow: () => Promise<{ synced: number; failed: number }>
  /** Atualiza packets/queue depois de operações externas. */
  refreshState: () => Promise<void>
  /** Baixa participants + inventory do evento pra uso offline. */
  downloadEvent: (
    eventId: string,
    onProgress?: (p: DownloadProgress) => void,
  ) => Promise<PacketMeta>
  /** Remove o packet baixado (libera espaço). */
  deleteEvent: (eventId: string) => Promise<void>
}

async function callApi(action: PendingAction): Promise<void> {
  if (action.type === 'checkin') {
    await apiPost('/api/mobile/checkin', {
      participantId: action.participantId,
      eventId: action.eventId,
      instanceIndex: action.instanceIndex,
      observation: action.observation,
    })
  } else if (action.type === 'revert-checkin') {
    await apiPost('/api/mobile/checkin/revert', {
      participantId: action.participantId,
      eventId: action.eventId,
      instanceIndex: action.instanceIndex,
    })
  } else if (action.type === 'withdrawal') {
    await apiPost('/api/mobile/checkin', {
      participantId: action.participantId,
      eventId: action.eventId,
      instanceIndex: action.instanceIndex,
      mode: 'withdrawal',
    })
  } else if (action.type === 'revert-kit') {
    await apiPost('/api/mobile/kit/revert', {
      participantId: action.participantId,
      eventId: action.eventId,
    })
  }
}

let netUnsub: (() => void) | null = null
let hydrated = false

interface ParticipantsPage {
  participants: MobileParticipant[]
  total: number
  page: number
  pageSize: number
}

interface InventoryPage {
  items: InventoryItem[]
  total: number
  page: number
  pageSize: number
  stats: InventoryStats
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  online: null,
  packets: [],
  queue: [],
  syncing: false,
  downloading: null,
  lastSync: null,

  hydrate: async () => {
    if (hydrated) return
    hydrated = true

    const [packets, queue] = await Promise.all([loadIndex(), loadQueue()])
    set({ packets, queue })

    // Primeira leitura do NetInfo.
    try {
      const first = await NetInfo.fetch()
      set({ online: first.isInternetReachable !== false && first.isConnected !== false })
    } catch {
      set({ online: true })
    }

    // Subscribe (guarda unsub pra evitar duplicar listeners em HMR).
    if (netUnsub) netUnsub()
    netUnsub = NetInfo.addEventListener((st) => {
      const isOnline = st.isInternetReachable !== false && st.isConnected !== false
      const prev = get().online
      set({ online: isOnline })
      // Voltou online E tem fila → tenta drenar.
      if (isOnline && !prev && get().queue.length > 0) {
        void get().syncNow()
      }
    })
  },

  refreshState: async () => {
    const [packets, queue] = await Promise.all([loadIndex(), loadQueue()])
    set({ packets, queue })
  },

  downloadEvent: async (eventId, onProgress) => {
    const emit = (p: DownloadProgress) => {
      set({ downloading: { eventId, progress: p } })
      onProgress?.(p)
    }

    emit({ step: 'participants', message: 'Baixando participantes...', percent: 5 })

    // Paginado. pageSize=500 cobre a maioria dos eventos em 1 request;
    // loop só pra segurança em eventos gigantes.
    const participants: MobileParticipant[] = []
    let page = 0
    const pageSize = 500
    while (true) {
      const res = await apiGet<ParticipantsPage>(
        `/api/mobile/events/${eventId}/participants?page=${page}&pageSize=${pageSize}`,
      )
      participants.push(...res.participants)
      if (participants.length >= res.total || res.participants.length < pageSize) break
      page++
      emit({
        step: 'participants',
        message: `Baixando participantes... (${participants.length} de ${res.total})`,
        percent: 5 + Math.min(45, Math.floor((participants.length / res.total) * 45)),
      })
    }

    emit({ step: 'inventory', message: 'Baixando estoque...', percent: 60 })

    let inventoryItems: InventoryItem[] = []
    let inventoryStats: InventoryStats | undefined
    try {
      const inv = await apiGet<InventoryPage>(
        `/api/mobile/events/${eventId}/inventory?page=0&pageSize=500`,
      )
      inventoryItems = inv.items
      inventoryStats = inv.stats
    } catch {
      // Evento pode não ter inventário — não bloqueia o download.
    }

    emit({ step: 'saving', message: 'Gravando no dispositivo...', percent: 85 })

    await savePacket({
      eventId,
      downloadedAt: new Date().toISOString(),
      participants,
      inventory: { items: inventoryItems, stats: inventoryStats },
    })

    await get().refreshState()
    const meta = get().packets.find((p) => p.eventId === eventId)!

    emit({ step: 'done', message: 'Concluído', percent: 100 })
    set({ downloading: null })
    return meta
  },

  deleteEvent: async (eventId) => {
    await removePacket(eventId)
    await get().refreshState()
  },

  syncNow: async () => {
    const state = get()
    if (state.syncing) return { synced: 0, failed: 0 }
    if (state.online === false) return { synced: 0, failed: 0 }

    const queue = await loadQueue()
    const pending = queue.filter((q) => q.status !== 'synced')
    if (pending.length === 0) {
      set({ queue })
      return { synced: 0, failed: 0 }
    }

    set({ syncing: true })
    let synced = 0
    let failed = 0

    for (const action of pending) {
      await updateQueueItem(action.id, { status: 'syncing', attempts: action.attempts + 1 })
      try {
        await callApi(action)
        // Remove da fila no sucesso — não queremos acumular.
        await removeFromQueue(action.id)
        synced++
      } catch (err) {
        // 409 = já processado no servidor (ex: duplo scan). Conta como sync
        // pra não travar a fila para sempre.
        if (err instanceof ApiError && err.status === 409) {
          await removeFromQueue(action.id)
          synced++
          continue
        }
        const msg = err instanceof Error ? err.message : String(err)
        await updateQueueItem(action.id, { status: 'failed', error: msg })
        failed++
      }
    }

    const next = await loadQueue()
    set({
      syncing: false,
      queue: next,
      lastSync: {
        at: new Date().toISOString(),
        synced,
        failed,
      },
    })
    return { synced, failed }
  },
}))

/**
 * Helper síncrono pro api.ts: retorna se tá online segundo o último estado
 * conhecido. Antes de hydrate() ser chamado, assume online (não bloqueia
 * requests reais até termos sinal claro).
 */
export function isOnlineNow(): boolean {
  const s = useOfflineStore.getState().online
  return s !== false // null ou true = assume online
}

/** Packet meta pro eventId informado, sem acessar disco. */
export function getPacketMeta(eventId: string): PacketMeta | undefined {
  return useOfflineStore.getState().packets.find((p) => p.eventId === eventId)
}

/** Carrega o packet do disco — usado pelos hooks quando offline. */
export { loadPacket } from '@/services/offline'
