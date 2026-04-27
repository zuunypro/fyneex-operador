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
  countParticipantsInPacket,
  getPendingActionsForEvent as offlineGetPendingActionsForEvent,
  listQueueBackups,
  loadIndex,
  loadQueue,
  migrateLegacyAsyncStorage,
  purgeLegacyQueueBackup,
  removeFromQueue,
  removeFromQueueByEvent,
  removePacket,
  savePacket,
  saveQueueBackup,
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
  /** Hidrata o estado inicial do disco. Idempotente — chamadas paralelas retornam a mesma Promise. */
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
  /** Quantas ações pending/syncing/failed existem pra um evento (UI gate). */
  getPendingActionsForEvent: (eventId: string) => Promise<number>
  /**
   * Verifica se existem backups recentes da fila (gerados em logout/wipe
   * acidental). NÃO restaura automaticamente — só sinaliza pra UI exibir
   * recovery opcional. Restauração efetiva fica numa segunda iteração.
   */
  recoverBackup: () => Promise<{ found: number }>
}

const MAX_AUTO_ATTEMPTS = 3
const ACTION_TIMEOUT_MS = 15_000
/** Número de ações processadas em paralelo por rodada de sync. */
const BATCH_SIZE = 10
/** Delay mínimo entre batches pra evitar rajada de requests (ms). */
const MIN_BATCH_DELAY_MS = 200

/** Cap do backoff (60s). Acima disso, espera é demais e operador deve drenar manual. */
const BACKOFF_CAP_MS = 60_000

/**
 * Calcula o instante da próxima tentativa após uma falha retryable.
 * Fórmula: `min(cap, base * 2^attempts) + jitter`. O jitter (0-500ms) evita
 * thundering herd quando múltiplos scanners voltam online simultaneamente —
 * sem ele, todos retentariam no mesmo tick e atacariam o servidor em rajada.
 */
function computeNextRetryAt(attempts: number): string {
  const base = 1_000
  const exp = Math.min(BACKOFF_CAP_MS, base * 2 ** Math.max(0, attempts - 1))
  const jitter = Math.floor(Math.random() * 500)
  return new Date(Date.now() + exp + jitter).toISOString()
}

/** Ação está pronta pra próxima tentativa? `nextRetryAt` ausente = sim (primeira). */
function isReadyForRetry(action: PendingAction, nowMs: number): boolean {
  if (!action.nextRetryAt) return true
  const t = Date.parse(action.nextRetryAt)
  return Number.isNaN(t) || t <= nowMs
}

function humanizeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'TIMEOUT') return 'Timeout (rede lenta)'
    if (err.status === 0) return 'Sem conexão com o servidor'
    return err.message || `Erro ${err.status}`
  }
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('Tempo esgotado') || msg.toLowerCase().includes('aborted')) {
    return 'Timeout (rede lenta)'
  }
  return msg
}

/**
 * Chama a API pra drenar uma ação da fila. Usa AbortController com o signal
 * passado pelo syncNow (que tem timeout próprio de 15s), cancelando o fetch
 * subjacente em vez de só ignorar a resposta como o Promise.race fazia.
 */
async function callApi(action: PendingAction, signal: AbortSignal): Promise<void> {
  // Idempotency-Key é o `action.id` gerado em enqueue() — único por intenção
  // do operador. Servidor pode usar pra dedupe explícito; cliente garante que
  // retentativas dessa mesma ação carregam a mesma chave (mesmo após reload
  // do app, porque o id vive no AsyncStorage da fila).
  const idempotencyHeaders = { 'Idempotency-Key': action.id }
  if (action.type === 'checkin') {
    await apiPost(
      '/api/mobile/checkin',
      {
        participantId: action.participantId,
        eventId: action.eventId,
        instanceIndex: action.instanceIndex,
        observation: action.observation,
      },
      signal,
      idempotencyHeaders,
    )
  } else if (action.type === 'revert-checkin') {
    await apiPost(
      '/api/mobile/checkin/revert',
      {
        participantId: action.participantId,
        eventId: action.eventId,
        instanceIndex: action.instanceIndex,
      },
      signal,
      idempotencyHeaders,
    )
  } else if (action.type === 'withdrawal') {
    // P1-5 fix: persistir e replayar `requireCheckIn`. Antes desta migração
    // o replay ignorava o flag e o servidor sempre defaultava `true`. Em
    // operações pré-evento autorizadas (organizador permitiu retirada
    // antecipada sem check-in), o item entrava no queue offline com
    // requireCheckIn=false; ao voltar online, o replay disparava
    // CHECKIN_REQUIRED e o operador via "falhou — faça login novamente"
    // (mensagem genérica do path 401/403, errada).
    await apiPost(
      '/api/mobile/checkin',
      {
        participantId: action.participantId,
        eventId: action.eventId,
        instanceIndex: action.instanceIndex,
        mode: 'withdrawal',
        allowNoStock: action.allowNoStock,
        allowNoStockReason: action.allowNoStockReason,
        // Default true se ausente — matches default do servidor pra rows
        // legacy que não tinham o campo no data_json.
        requireCheckIn: action.requireCheckIn ?? true,
      },
      signal,
      idempotencyHeaders,
    )
  } else if (action.type === 'revert-kit') {
    await apiPost(
      '/api/mobile/kit/revert',
      {
        participantId: action.participantId,
        eventId: action.eventId,
        instanceIndex: action.instanceIndex,
      },
      signal,
      idempotencyHeaders,
    )
  }
}

let netUnsub: (() => void) | null = null

/**
 * Timer de retry automático. Acionado quando há ações `failed` retentáveis
 * com `nextRetryAt` no futuro. A cada tick (BACKOFF_TICK_MS) verifica se
 * algum item venceu o backoff e tenta sincronizar. Auto-cancelado quando
 * não há mais nada elegível, pra não drenar bateria à toa.
 */
const BACKOFF_TICK_MS = 5_000
let autoRetryTimer: ReturnType<typeof setInterval> | null = null

function stopAutoRetryTimer() {
  if (autoRetryTimer) {
    clearInterval(autoRetryTimer)
    autoRetryTimer = null
  }
}

/**
 * Promise singleton pra hydrate — garante que chamadas paralelas (ex: HMR,
 * dois componentes montando ao mesmo tempo) executem a inicialização uma
 * única vez e compartilhem o resultado.
 */
let hydratePromise: Promise<void> | null = null

/**
 * Flag atômica fora do Zustand pra evitar race condition no syncNow.
 * Zustand set() tem lag de propagação — se dois calls passam pelo
 * `if (state.syncing)` antes do set propagar, ambos executariam sync em
 * paralelo. Um booleano de módulo é síncrono e não tem esse problema.
 */
let syncRunning = false

/**
 * QueryClient ref pra invalidar queries de participants/inventory quando o
 * sync drena ações com sucesso. Sem isso, operador precisava puxar pra baixo
 * (pull-to-refresh) pra ver os items sincronizados refletidos como "feitos".
 *
 * Setado uma vez por App.tsx no boot via setSyncQueryClient().
 */
type MinimalQueryClient = {
  invalidateQueries: (filters: { queryKey: unknown[] }) => void | Promise<void>
}
let syncQueryClient: MinimalQueryClient | null = null
export function setSyncQueryClient(client: MinimalQueryClient): void {
  syncQueryClient = client
}

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

  hydrate: () => {
    if (hydratePromise) return hydratePromise
    hydratePromise = (async () => {
      // One-shot migration de packets/queue antigos do AsyncStorage pra
      // SQLite. Subsequentes boots fazem skip imediato via flag.
      await migrateLegacyAsyncStorage()
      // Hardening 2026-04-26: limpa chaves AsyncStorage residuais do antigo
      // queue backup (pré-SQLite). One-shot via flag — best-effort, não
      // bloqueia hydrate se falhar.
      purgeLegacyQueueBackup().catch(() => { /* ignore */ })
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

      // Subscribe (guarda unsub pra evitar duplicar listeners — hydratePromise
      // garante que só roda uma vez, mas netUnsub é safety net adicional).
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
        // Caiu offline → para o tick de auto-retry. NetInfo vai reativar via
        // syncNow quando voltar online (a transition acima reagenda o timer).
        if (!isOnline) stopAutoRetryTimer()
      })
    })()
    return hydratePromise
  },

  refreshState: async () => {
    const [packets, queue] = await Promise.all([loadIndex(), loadQueue()])
    set({ packets, queue })
  },

  retryAction: async (id) => {
    // Reset attempts=0 + limpa nextRetryAt pra voltar elegível pelo auto-sync
    // imediatamente (sem o reset, ficaria preso esperando o backoff vencer).
    await updateQueueItem(id, {
      status: 'pending',
      error: undefined,
      attempts: 0,
      nextRetryAt: undefined,
    })
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
      // loop com cap de 200 páginas (100k participantes) pra não travar em
      // loop infinito caso o backend reporte total errado. Antes da migração
      // pra SQLite o cap era 10k por causa do limite do AsyncStorage Android.
      const participants: MobileParticipant[] = []
      const pageSize = 500
      for (let page = 0; page < 200; page++) {
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

      // Checksum: confere se a contagem real no SQLite bate com o esperado.
      // Se não bate, savePacket pode ter aplicado redação/merge inconsistente
      // ou a transação parcial. Não atualiza estado pra success — operador
      // re-baixa em vez de operar com snapshot suspeito.
      const persistedCount = await countParticipantsInPacket(eventId)
      if (persistedCount !== participants.length) {
        throw new Error(
          `Download incompleto — tente novamente (esperado ${participants.length}, gravado ${persistedCount})`,
        )
      }

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
    // Sinaliza pro syncNow em andamento que deve abortar (ele verifica no loop).
    syncRunning = false
    stopAutoRetryTimer()
    // Backup defensivo: se há ações não-sincronizadas, persiste antes de
    // limpar pra que logout acidental não destrua escaneamentos do operador.
    // Recovery fica conceitualmente disponível (recoverBackup()).
    const queue = get().queue
    const unsynced = queue.filter((q) => q.status !== 'synced')
    if (unsynced.length > 0) {
      await saveQueueBackup(unsynced)
    }
    await Promise.all([wipePackets(), clearQueue()])
    set({ packets: [], queue: [], lastSync: null, syncing: false })
  },

  getPendingActionsForEvent: async (eventId) => {
    return offlineGetPendingActionsForEvent(eventId)
  },

  recoverBackup: async () => {
    const backups = await listQueueBackups()
    return { found: backups.reduce((acc, b) => acc + b.count, 0) }
  },

  syncNow: async () => {
    // syncRunning é atômico (JS single-threaded): leitura + escrita acontecem
    // antes de qualquer await, então não há race entre dois calls simultâneos.
    if (syncRunning || get().online === false) return { synced: 0, failed: 0 }
    syncRunning = true
    set({ syncing: true })
    let synced = 0
    let failed = 0
    // Coletamos os eventIds de ações que sincronizaram com sucesso (incluindo
    // 409/404/410 que removemos do queue). Invalidação no finally vira por
    // evento — antes era genérica `['mobile', 'participants']` e disparava
    // refetch global desnecessário em todos os eventos baixados.
    const syncedEventIds = new Set<string>()

    // try/finally garante que `syncing: false` SEMPRE volta pra false, mesmo
    // se AsyncStorage ou algo inesperado lançar fora do try interno. Antes,
    // um throw de updateQueueItem deixava a store presa em syncing=true até
    // reabrir o app — e syncNow recusava rodar de novo.
    try {
      const queue = await loadQueue()
      const nowMs = Date.now()
      const pending = queue.filter(
        (q) =>
          q.status !== 'synced' &&
          q.attempts < MAX_AUTO_ATTEMPTS &&
          isReadyForRetry(q, nowMs),
      )
      if (pending.length === 0) {
        set({ queue })
        return { synced: 0, failed: 0 }
      }

      // Processa ações em batches de BATCH_SIZE pra evitar 429 ao drenar filas
      // grandes (até 5000 itens). Após cada batch:
      //   1. Respeita `Retry-After` do servidor se algum request retornou 429.
      //   2. Aguarda MIN_BATCH_DELAY_MS entre batches mesmo sem 429 (anti-burst).
      // BUG 5 fix: cada request cria seu próprio AbortController — abortar um
      // request não cancela os outros do mesmo batch.
      for (let batchStart = 0; batchStart < pending.length; batchStart += BATCH_SIZE) {
        // Se wipeAll foi chamado durante o loop (logout), interrompe gracefully.
        if (!syncRunning) break

        const batch = pending.slice(batchStart, batchStart + BATCH_SIZE)
        let retryAfterMs = 0

        // Processa o batch em paralelo — cada ação com seu próprio controller.
        await Promise.all(
          batch.map(async (action) => {
            if (!syncRunning) return

            // BUG 5: novo AbortController por request, não compartilhado.
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), ACTION_TIMEOUT_MS)

            try {
              await updateQueueItem(action.id, {
                status: 'syncing',
                attempts: action.attempts + 1,
              })
              await callApi(action, controller.signal)
              clearTimeout(timeoutId)
              await removeFromQueue(action.id)
              synced++
              syncedEventIds.add(action.eventId)
            } catch (err) {
              clearTimeout(timeoutId)
              const apiErr = err instanceof ApiError ? err : null

              // 429 = rate-limit. Captura Retry-After pra aguardar antes do
              // próximo batch. Não marca como failed — ficará pending e tentará
              // no próximo syncNow ou quando o timer vencer.
              if (apiErr?.status === 429) {
                const retryAfterRaw = apiErr.retryAfter ?? 0
                const retryAfterSec =
                  typeof retryAfterRaw === 'number'
                    ? retryAfterRaw
                    : parseInt(String(retryAfterRaw), 10) || 0
                retryAfterMs = Math.max(retryAfterMs, retryAfterSec * 1000)
                await updateQueueItem(action.id, {
                  status: 'failed',
                  error: 'Rate limit — aguardando servidor',
                  nextRetryAt: computeNextRetryAt(action.attempts + 1),
                }).catch(() => {})
                failed++
                return
              }

              // 409 = já processado no servidor (outro operador ou double scan).
              // Remove da fila — conta como sync.
              if (apiErr?.status === 409) {
                await removeFromQueue(action.id).catch(() => {})
                synced++
                syncedEventIds.add(action.eventId)
                return
              }

              // 401/403 = token expirado ou sem permissão. NÃO removemos da fila
              // pra operador perceber que precisa re-logar. Itens ficam visíveis
              // no painel de erros em Perfil.
              if (apiErr && (apiErr.status === 401 || apiErr.status === 403)) {
                await updateQueueItem(action.id, {
                  status: 'failed',
                  error: 'Token expirado — faça login novamente',
                }).catch(() => {})
                failed++
                return
              }

              // 404/410 = recurso não existe mais no servidor (participante/evento
              // deletado). Nada a fazer — remove silenciosamente.
              if (apiErr && (apiErr.status === 404 || apiErr.status === 410)) {
                await removeFromQueue(action.id).catch(() => {})
                synced++
                syncedEventIds.add(action.eventId)
                return
              }

              // 400/422 = payload inválido. Retry não resolve — marca como falha
              // pra operador ver a mensagem do servidor e poder descartar.
              if (apiErr && (apiErr.status === 400 || apiErr.status === 422)) {
                await updateQueueItem(action.id, {
                  status: 'failed',
                  error: apiErr.message || `Erro de validação (${apiErr.status})`,
                }).catch(() => {})
                failed++
                return
              }

              // Outros erros (rede, timeout, 5xx) → marca failed, elegível pra retry.
              // Backoff exponencial com jitter pra evitar thundering herd quando
              // múltiplos scanners voltam online juntos. nextRetryAt é checado pelo
              // filter de pending no próximo syncNow.
              const msg = humanizeError(err)
              await updateQueueItem(action.id, {
                status: 'failed',
                error: msg,
                nextRetryAt: computeNextRetryAt(action.attempts + 1),
              }).catch(() => {})
              failed++
            }
          }),
        )

        // Não aguarda delay após o último batch.
        const hasMore = batchStart + BATCH_SIZE < pending.length
        if (hasMore && syncRunning) {
          // Respeita Retry-After do servidor; aplica pelo menos MIN_BATCH_DELAY_MS.
          const waitMs = Math.max(retryAfterMs, MIN_BATCH_DELAY_MS)
          await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
        }
      }
    } finally {
      syncRunning = false
      const next = await loadQueue().catch(() => get().queue)
      set({
        syncing: false,
        queue: next,
        lastSync: { at: new Date().toISOString(), synced, failed },
      })
      // Se algo foi efetivamente sincronizado, invalida queries por evento.
      // Antes era genérico `['mobile', 'participants']` e disparava refetch
      // global em TODOS os eventos baixados — em prod com 5+ eventos cada
      // sync gerava ~10 fetches paralelos. Stats fica genérica de propósito
      // (resumo geral é leve).
      if (synced > 0 && syncQueryClient) {
        try {
          for (const evId of syncedEventIds) {
            syncQueryClient.invalidateQueries({ queryKey: ['mobile', 'participants', evId] })
            syncQueryClient.invalidateQueries({ queryKey: ['mobile', 'inventory', evId] })
          }
          syncQueryClient.invalidateQueries({ queryKey: ['mobile', 'stats'] })
        } catch { /* invalidate é best-effort, não falha sync por causa disso */ }
      }
      // Decide se mantém ou para o auto-retry timer:
      // - Se há ação retryable com nextRetryAt no futuro, mantém o tick.
      // - Caso contrário, para pra não drenar bateria sem necessidade.
      const hasPendingRetry = next.some(
        (q) =>
          q.status === 'failed' &&
          q.attempts < MAX_AUTO_ATTEMPTS &&
          q.nextRetryAt !== undefined,
      )
      if (hasPendingRetry && get().online !== false) {
        if (!autoRetryTimer) {
          autoRetryTimer = setInterval(() => {
            // Só dispara se há item realmente pronto e estamos online.
            const s = useOfflineStore.getState()
            if (s.online === false) return
            const ready = s.queue.some(
              (q) =>
                q.status === 'failed' &&
                q.attempts < MAX_AUTO_ATTEMPTS &&
                isReadyForRetry(q, Date.now()),
            )
            if (ready) void s.syncNow()
          }, BACKOFF_TICK_MS)
        }
      } else {
        stopAutoRetryTimer()
      }
    }

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

