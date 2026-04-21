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
  clearQueue,
  loadIndex,
  loadQueue,
  loadPacket,
  removeFromQueue,
  removeFromQueueByEvent,
  removePacket,
  savePacket,
  updateQueueItem,
  wipePackets,
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
  /** Reseta status de um item failed pra pending e roda syncNow. */
  retryAction: (id: string) => Promise<void>
  /** Remove um item do queue sem executar (descartar falha). */
  dropAction: (id: string) => Promise<void>
  /** Baixa participants + inventory do evento pra uso offline. */
  downloadEvent: (
    eventId: string,
    onProgress?: (p: DownloadProgress) => void,
  ) => Promise<PacketMeta>
  /** Remove o packet baixado (libera espaço). Limpa tbm items da fila do evento. */
  deleteEvent: (eventId: string) => Promise<void>
  /** Apaga tudo — packets + fila + reseta estado. Usado no logout. */
  wipeAll: () => Promise<void>
}

const MAX_AUTO_ATTEMPTS = 3

const ACTION_TIMEOUT_MS = 15_000

/**
 * Roda o apiPost com timeout estrito pra não travar a fila em conexão lenta.
 * Timeout vira erro normal que vai ser capturado no syncNow e marca o item
 * como failed — o operador pode tentar de novo depois.
 */
async function callApi(action: PendingAction): Promise<void> {
  const race = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Tempo esgotado (15s)')), ACTION_TIMEOUT_MS),
      ),
    ])

  if (action.type === 'checkin') {
    await race(
      apiPost('/api/mobile/checkin', {
        participantId: action.participantId,
        eventId: action.eventId,
        instanceIndex: action.instanceIndex,
        observation: action.observation,
      }),
    )
  } else if (action.type === 'revert-checkin') {
    await race(
      apiPost('/api/mobile/checkin/revert', {
        participantId: action.participantId,
        eventId: action.eventId,
        instanceIndex: action.instanceIndex,
      }),
    )
  } else if (action.type === 'withdrawal') {
    await race(
      apiPost('/api/mobile/checkin', {
        participantId: action.participantId,
        eventId: action.eventId,
        instanceIndex: action.instanceIndex,
        mode: 'withdrawal',
      }),
    )
  } else if (action.type === 'revert-kit') {
    await race(
      apiPost('/api/mobile/kit/revert', {
        participantId: action.participantId,
        eventId: action.eventId,
      }),
    )
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
    let initialOnline = true
    try {
      const first = await NetInfo.fetch()
      initialOnline = first.isInternetReachable !== false && first.isConnected !== false
    } catch {
      initialOnline = true
    }
    set({ online: initialOnline })

    // BUG corrigido: se o app abrir JÁ online e com fila pendente (operador
    // fechou+abriu com net ativa), o listener não dispara "transição online"
    // porque nunca houve offline→online nesta sessão. Disparamos na mão aqui.
    if (initialOnline && queue.some((q) => q.status !== 'synced')) {
      setTimeout(() => void get().syncNow(), 500)
    }

    // Subscribe (guarda unsub pra evitar duplicar listeners em HMR).
    if (netUnsub) netUnsub()
    netUnsub = NetInfo.addEventListener((st) => {
      const isOnline = st.isInternetReachable !== false && st.isConnected !== false
      const prev = get().online
      set({ online: isOnline })
      // Voltou online E tem fila → tenta drenar. Delay de 1.5s pra dar tempo
      // da rede estabilizar (DNS, handshake) — evita falha em rajada.
      if (isOnline && prev === false && get().queue.length > 0) {
        setTimeout(() => void get().syncNow(), 1500)
      }
    })
  },

  refreshState: async () => {
    const [packets, queue] = await Promise.all([loadIndex(), loadQueue()])
    set({ packets, queue })
  },

  retryAction: async (id) => {
    // Reset attempts=0 pra voltar a ser elegível pelo auto-sync também.
    await updateQueueItem(id, { status: 'pending', error: undefined, attempts: 0 })
    await get().refreshState()
    if (get().online !== false) await get().syncNow()
  },

  dropAction: async (id) => {
    await removeFromQueue(id)
    await get().refreshState()
  },

  downloadEvent: async (eventId, onProgress) => {
    // Guard: impede concorrência. Se já tem download rolando, sai cedo.
    if (get().downloading) {
      throw new Error('Já existe um download em andamento — aguarde terminar')
    }
    const emit = (p: DownloadProgress) => {
      set({ downloading: { eventId, progress: p } })
      onProgress?.(p)
    }

    try {
      emit({ step: 'participants', message: 'Baixando participantes...', percent: 5 })

      // Paginado. pageSize=500 cobre a maioria dos eventos em 1 request;
      // loop só pra segurança em eventos gigantes. Máximo de 20 páginas (10k)
      // pra não travar em loop infinito se o backend reportar total errado.
      const participants: MobileParticipant[] = []
      const pageSize = 500
      for (let page = 0; page < 20; page++) {
        const res = await apiGet<ParticipantsPage>(
          `/api/mobile/events/${eventId}/participants?page=${page}&pageSize=${pageSize}`,
        )
        participants.push(...res.participants)
        if (participants.length >= res.total || res.participants.length < pageSize) break
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
      const meta = get().packets.find((p) => p.eventId === eventId)
      if (!meta) throw new Error('Packet salvo mas não indexado — reabra o app')

      emit({ step: 'done', message: 'Concluído', percent: 100 })
      set({ downloading: null })
      return meta
    } catch (err) {
      // Qualquer falha (rede, storage, parsing) libera o estado pra usuário
      // conseguir tentar de novo.
      set({ downloading: null })
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Falha no download: ${msg}`)
    }
  },

  deleteEvent: async (eventId) => {
    await removePacket(eventId)
    // Se tinha items da queue desse evento, limpa junto — sem o packet não
    // temos o contexto pra mostrar no painel nem pra operador autenticar.
    await removeFromQueueByEvent(eventId)
    await get().refreshState()
  },

  wipeAll: async () => {
    await Promise.all([wipePackets(), clearQueue()])
    set({ packets: [], queue: [], lastSync: null })
  },

  syncNow: async () => {
    const state = get()
    if (state.syncing) return { synced: 0, failed: 0 }
    if (state.online === false) return { synced: 0, failed: 0 }

    const queue = await loadQueue()
    // Auto-sync só tenta items que nunca falharam OU que falharam menos de
    // MAX_AUTO_ATTEMPTS vezes. Depois disso, só vai pelo retry manual no
    // painel "Erros de sync" (que reseta attempts pra 0 via retryAction).
    const pending = queue.filter((q) => q.status !== 'synced' && q.attempts < MAX_AUTO_ATTEMPTS)
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
