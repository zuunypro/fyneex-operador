/**
 * Offline persistence + sync worker.
 *
 * Modelo: pra cada evento o operador "baixa offline" e gravamos um snapshot
 * em SQLite — metadata + lista de participantes (uma row por instance) +
 * inventário (JSON). Mutations (checkin, retirada, reverts) feitas offline
 * viram rows na tabela pending_actions, drenadas quando a net volta.
 *
 * Mudança 2026-04-25: migrado de AsyncStorage pra SQLite (expo-sqlite) pra
 * suportar eventos de 30k+ participantes. AsyncStorage Android tem cap de
 * 6 MB total e 2 MB por chave — explodia em ~6k participants.
 *
 * SQLite ganhos:
 *  - storage cresce até o disco do device
 *  - paginated SELECT não carrega tudo em RAM
 *  - índices em (event_id, search_text) tornam busca em 30k em ms
 *  - bulk INSERT em transação evita JSON.parse gigante no cold start
 *
 * API pública preservada (savePacket, loadPacket, etc.) pra que hooks e
 * stores consumidores não precisem mudar.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MobileParticipant } from '@/hooks/useParticipants'
import type { InventoryItem, InventoryStats } from '@/hooks/useInventory'
import { normalizeForSearch } from '@/utils/text'
import { getDb, withTransaction } from './db'

// Chaves AsyncStorage legacy — mantidas só pra migration one-shot do v1.
const LEGACY_KEY_PACKET = (eventId: string) => `fyneex_offline_packet_v1_${eventId}`
const LEGACY_KEY_INDEX = 'fyneex_offline_index_v1'
const LEGACY_KEY_QUEUE = 'fyneex_offline_queue_v1'
const LEGACY_MIGRATION_DONE = 'fyneex_offline_migrated_to_sqlite_v1'

export interface EventPacket {
  eventId: string
  downloadedAt: string
  participants: MobileParticipant[]
  inventory: {
    items: InventoryItem[]
    stats?: InventoryStats
  }
}

export interface PacketMeta {
  eventId: string
  downloadedAt: string
  participantCount: number
  itemCount: number
}

export type PendingActionType =
  | 'checkin'
  | 'revert-checkin'
  | 'withdrawal'
  | 'revert-kit'

export interface PendingAction {
  id: string
  type: PendingActionType
  eventId: string
  participantId: string
  instanceIndex?: number
  observation?: string
  allowNoStock?: boolean
  /** Pareado com allowNoStock=true: o servidor exige motivo (FORCE_REASON_REQUIRED). */
  allowNoStockReason?: string
  createdAt: string
  status: 'pending' | 'syncing' | 'synced' | 'failed'
  error?: string
  attempts: number
  /**
   * Timestamp ISO em que a próxima tentativa pode ocorrer (set após falha
   * retryable: 5xx/timeout/network). Antes desse instante, syncNow ignora a
   * ação. Usa exponential backoff com jitter pra evitar thundering herd quando
   * múltiplos scanners voltam online juntos.
   */
  nextRetryAt?: string
}

function uid(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  )
}

/**
 * Mutex in-memory que serializa operações que precisam ser atômicas no nível
 * lógico. SQLite já tem locking interno, mas mantemos o mutex pra coordenar
 * leituras+escritas que dependem de outras leituras dentro do app (ex: ler
 * queue, decidir, atualizar estado em zustand).
 */
let lockChain: Promise<unknown> = Promise.resolve()
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lockChain
  let release!: () => void
  const next = new Promise<void>((r) => { release = r })
  lockChain = next
  try {
    await prev
    return await fn()
  } finally {
    release()
  }
}

/* ── Search-text builder (denormalized) ────────────────────────────────── */

/**
 * Concatena os campos buscáveis em uma string lowercase + sem acentos única,
 * gravada na coluna `search_text` pra busca via LIKE indexado. Mantido em
 * sync com `matchParticipant` em utils/participants.ts.
 *
 * Inclui buyerName e buyerCpfLast5 pra que operador no portão consiga buscar
 * por "quem comprou" e pelos últimos dígitos do CPF que o cliente passa.
 *
 * O normalize remove acentos pra que "joão" e "joao" sejam equivalentes —
 * teclado mobile na pressa raramente acerta acento. Pra que essa equivalência
 * funcione no LIKE, o lado do usuário (input search) também precisa passar
 * pelo mesmo normalizeForSearch antes da query (feito em useParticipants
 * online via `applyFilters` server-side e em `loadParticipantsPaginated`
 * offline via search param que será normalizado no caller).
 */
function buildSearchText(p: MobileParticipant): string {
  const parts = [
    p.name ?? '',
    p.buyerName ?? '',
    p.participantId ?? '',
    p.orderNumber ?? '',
    p.buyerCpfLast5 ?? '',
    ...(p.instanceFields?.map((f) => f.value ?? '') ?? []),
  ]
  return normalizeForSearch(parts.join(' '))
}

/* ── Packets (snapshots) ────────────────────────────────────────────────── */

interface PacketRow {
  event_id: string
  downloaded_at: string
  inventory_json: string
  stats_json: string | null
  participant_count: number
  item_count: number
}

interface ParticipantRow {
  data_json: string
}

export async function savePacket(packet: EventPacket): Promise<void> {
  await withTransaction(async (db) => {
    // Replace garante que re-download substitui o packet inteiro de forma
    // atômica. ON DELETE CASCADE limpa rows da tabela participants.
    await db.runAsync('DELETE FROM event_packets WHERE event_id = ?', packet.eventId)
    await db.runAsync(
      `INSERT INTO event_packets
        (event_id, downloaded_at, inventory_json, stats_json, participant_count, item_count)
        VALUES (?, ?, ?, ?, ?, ?)`,
      packet.eventId,
      packet.downloadedAt,
      JSON.stringify(packet.inventory.items),
      packet.inventory.stats ? JSON.stringify(packet.inventory.stats) : null,
      packet.participants.length,
      packet.inventory.items.length,
    )
    // Bulk insert de participants. SQLite roda muito rápido em transação.
    // Em testes locais: 30k inserts em ~1.5s no Android midrange.
    for (const p of packet.participants) {
      await db.runAsync(
        `INSERT INTO participants
          (event_id, participant_id, instance_index, search_text, status, kit_withdrawn, order_number, data_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        packet.eventId,
        p.participantId,
        p.instanceIndex ?? null,
        buildSearchText(p),
        p.status,
        p.kitWithdrawnAt ? 1 : 0,
        p.orderNumber ?? '',
        JSON.stringify(p),
      )
    }
  })
}

export async function loadPacket(eventId: string): Promise<EventPacket | null> {
  const db = await getDb()
  const meta = await db.getFirstAsync<PacketRow>(
    'SELECT * FROM event_packets WHERE event_id = ?',
    eventId,
  )
  if (!meta) return null

  const rows = await db.getAllAsync<ParticipantRow>(
    'SELECT data_json FROM participants WHERE event_id = ? ORDER BY pk',
    eventId,
  )
  const participants: MobileParticipant[] = []
  for (const r of rows) {
    try {
      participants.push(JSON.parse(r.data_json) as MobileParticipant)
    } catch {
      // Linha corrompida — pula em vez de quebrar todo o load.
    }
  }
  let inventoryItems: InventoryItem[] = []
  try { inventoryItems = JSON.parse(meta.inventory_json) as InventoryItem[] } catch { /* keep empty */ }
  let stats: InventoryStats | undefined
  if (meta.stats_json) {
    try { stats = JSON.parse(meta.stats_json) as InventoryStats } catch { /* keep undefined */ }
  }
  return {
    eventId: meta.event_id,
    downloadedAt: meta.downloaded_at,
    participants,
    inventory: { items: inventoryItems, stats },
  }
}

export async function loadIndex(): Promise<PacketMeta[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<PacketRow>(
    'SELECT * FROM event_packets ORDER BY downloaded_at DESC',
  )
  return rows.map((r) => ({
    eventId: r.event_id,
    downloadedAt: r.downloaded_at,
    participantCount: r.participant_count,
    itemCount: r.item_count,
  }))
}

export async function removePacket(eventId: string): Promise<void> {
  const db = await getDb()
  // CASCADE em participants já cuida via FK.
  await db.runAsync('DELETE FROM event_packets WHERE event_id = ?', eventId)
}

export async function wipePackets(): Promise<void> {
  const db = await getDb()
  await db.execAsync('DELETE FROM event_packets;')
  await db.execAsync('DELETE FROM participants;')
}

/* ── Queue (mutations offline) ──────────────────────────────────────────── */

interface ActionRow {
  id: string
  type: string
  event_id: string
  participant_id: string
  instance_index: number | null
  data_json: string
  status: string
  attempts: number
  created_at: string
  next_retry_at: string | null
  error: string | null
}

function rowToAction(r: ActionRow): PendingAction {
  let extras: Partial<PendingAction> = {}
  try { extras = JSON.parse(r.data_json) as Partial<PendingAction> } catch { /* empty */ }
  return {
    id: r.id,
    type: r.type as PendingActionType,
    eventId: r.event_id,
    participantId: r.participant_id,
    instanceIndex: r.instance_index ?? undefined,
    observation: extras.observation,
    allowNoStock: extras.allowNoStock,
    allowNoStockReason: extras.allowNoStockReason,
    status: r.status as PendingAction['status'],
    attempts: r.attempts,
    createdAt: r.created_at,
    nextRetryAt: r.next_retry_at ?? undefined,
    error: r.error ?? undefined,
  }
}

export async function loadQueue(): Promise<PendingAction[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<ActionRow>(
    'SELECT * FROM pending_actions ORDER BY created_at',
  )
  return rows.map(rowToAction)
}

export async function enqueue(
  action: Omit<PendingAction, 'id' | 'createdAt' | 'status' | 'attempts'>,
): Promise<PendingAction> {
  return withLock(async () => {
    const db = await getDb()
    const entry: PendingAction = {
      ...action,
      id: uid(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
    }
    await db.runAsync(
      `INSERT INTO pending_actions
        (id, type, event_id, participant_id, instance_index, data_json, status, attempts, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.type,
      entry.eventId,
      entry.participantId,
      entry.instanceIndex ?? null,
      JSON.stringify({
        observation: entry.observation,
        allowNoStock: entry.allowNoStock,
        allowNoStockReason: entry.allowNoStockReason,
      }),
      entry.status,
      entry.attempts,
      entry.createdAt,
    )
    return entry
  })
}

export async function updateQueueItem(
  id: string,
  patch: Partial<PendingAction>,
): Promise<void> {
  return withLock(async () => {
    const db = await getDb()
    // Atualiza só os campos presentes no patch — colunas conhecidas + data_json
    // pra extras (observation/allowNoStock/reason). Em vez de fazer COALESCE
    // por cada coluna, pega o estado atual e re-escreve.
    const cur = await db.getFirstAsync<ActionRow>(
      'SELECT * FROM pending_actions WHERE id = ?',
      id,
    )
    if (!cur) return
    const merged: PendingAction = { ...rowToAction(cur), ...patch }
    await db.runAsync(
      `UPDATE pending_actions SET
        type = ?, event_id = ?, participant_id = ?, instance_index = ?,
        data_json = ?, status = ?, attempts = ?, created_at = ?,
        next_retry_at = ?, error = ?
        WHERE id = ?`,
      merged.type,
      merged.eventId,
      merged.participantId,
      merged.instanceIndex ?? null,
      JSON.stringify({
        observation: merged.observation,
        allowNoStock: merged.allowNoStock,
        allowNoStockReason: merged.allowNoStockReason,
      }),
      merged.status,
      merged.attempts,
      merged.createdAt,
      merged.nextRetryAt ?? null,
      merged.error ?? null,
      id,
    )
  })
}

export async function removeFromQueue(id: string): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM pending_actions WHERE id = ?', id)
}

export async function removeFromQueueByEvent(eventId: string): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM pending_actions WHERE event_id = ?', eventId)
}

export async function clearQueue(): Promise<void> {
  const db = await getDb()
  await db.execAsync('DELETE FROM pending_actions;')
}

/* ── Packet update helpers (manter cache fresco com mutations) ─────────── */

/**
 * Atualiza um participant no packet local. Usado pelas mutations offline pra
 * refletir otimista no cache (ex: marcar kitWithdrawnAt depois de retirada
 * offline). Re-grava JSON + denormalizados (status, kit_withdrawn).
 */
export async function patchParticipantInPacket(
  eventId: string,
  participantId: string,
  instanceIndex: number | undefined,
  patch: Partial<MobileParticipant>,
): Promise<void> {
  const db = await getDb()
  // Localiza row(s) — se instanceIndex undefined, pega todas as instances
  // do participant naquele evento.
  const where = instanceIndex !== undefined
    ? 'event_id = ? AND participant_id = ? AND instance_index = ?'
    : 'event_id = ? AND participant_id = ?'
  const params = instanceIndex !== undefined
    ? [eventId, participantId, instanceIndex]
    : [eventId, participantId]

  const rows = await db.getAllAsync<{ pk: number; data_json: string }>(
    `SELECT pk, data_json FROM participants WHERE ${where}`,
    ...params,
  )
  for (const r of rows) {
    let p: MobileParticipant
    try { p = JSON.parse(r.data_json) as MobileParticipant } catch { continue }
    const merged = { ...p, ...patch }
    await db.runAsync(
      `UPDATE participants SET
        data_json = ?, status = ?, kit_withdrawn = ?, search_text = ?
        WHERE pk = ?`,
      JSON.stringify(merged),
      merged.status,
      merged.kitWithdrawnAt ? 1 : 0,
      buildSearchText(merged),
      r.pk,
    )
  }
}

/* ── Paginated participant queries (offline-first reads) ───────────────── */

export interface LoadParticipantsOptions {
  search?: string
  status?: 'all' | 'pending' | 'checked'
  page?: number
  pageSize?: number
}

export interface ParticipantsPageResult {
  participants: MobileParticipant[]
  total: number
  page: number
  pageSize: number
}

/**
 * Lê participantes do packet local com filtros e paginação. Substitui o
 * pattern antigo de carregar packet inteiro e filtrar em JS — escala pra
 * 30k+ porque a busca acontece via índice SQL (não O(n) sobre JS array).
 */
export async function loadParticipantsPaginated(
  eventId: string,
  opts: LoadParticipantsOptions = {},
): Promise<ParticipantsPageResult> {
  const db = await getDb()
  const page = opts.page ?? 0
  const pageSize = Math.min(500, Math.max(1, opts.pageSize ?? 200))
  const filters: string[] = ['event_id = ?']
  const params: (string | number)[] = [eventId]

  if (opts.search && opts.search.trim()) {
    // Normaliza o input do operador (lowercase + sem acentos) pra casar com
    // search_text que foi gravado já normalizado em buildSearchText. Sem essa
    // simetria, "joao" digitado pelo operador não casaria com "joão" do form.
    filters.push('search_text LIKE ?')
    params.push(`%${normalizeForSearch(opts.search.trim())}%`)
  }
  if (opts.status === 'pending') {
    filters.push("status = 'pending'")
  } else if (opts.status === 'checked') {
    filters.push("status = 'checked'")
  }

  const whereSql = `WHERE ${filters.join(' AND ')}`
  const totalRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM participants ${whereSql}`,
    ...params,
  )
  const total = totalRow?.c ?? 0

  const rows = await db.getAllAsync<ParticipantRow>(
    `SELECT data_json FROM participants ${whereSql} ORDER BY pk LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    page * pageSize,
  )
  const participants: MobileParticipant[] = []
  for (const r of rows) {
    try { participants.push(JSON.parse(r.data_json) as MobileParticipant) } catch { /* skip */ }
  }
  return { participants, total, page, pageSize }
}

/** Carrega só o inventory (items + stats) — sem participants. */
export async function loadInventory(eventId: string): Promise<{ items: InventoryItem[]; stats?: InventoryStats } | null> {
  const db = await getDb()
  const meta = await db.getFirstAsync<PacketRow>(
    'SELECT inventory_json, stats_json FROM event_packets WHERE event_id = ?',
    eventId,
  )
  if (!meta) return null
  let items: InventoryItem[] = []
  try { items = JSON.parse(meta.inventory_json) as InventoryItem[] } catch { /* keep empty */ }
  let stats: InventoryStats | undefined
  if (meta.stats_json) {
    try { stats = JSON.parse(meta.stats_json) as InventoryStats } catch { /* keep undefined */ }
  }
  return { items, stats }
}

/* ── Migration AsyncStorage → SQLite (one-shot) ────────────────────────── */

/**
 * Chamada uma vez no boot. Se há packets/queue antigos no AsyncStorage de
 * versões anteriores, copia pra SQLite e marca como migrado. Subsequentes
 * boots checam o flag e fazem skip imediato.
 */
export async function migrateLegacyAsyncStorage(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(LEGACY_MIGRATION_DONE)
    if (done === 'true') return

    // 1. Migrar index + packets
    const idxRaw = await AsyncStorage.getItem(LEGACY_KEY_INDEX)
    if (idxRaw) {
      let idx: PacketMeta[] = []
      try {
        const parsed = JSON.parse(idxRaw) as unknown
        if (Array.isArray(parsed)) idx = parsed as PacketMeta[]
      } catch { /* skip */ }
      for (const meta of idx) {
        try {
          const raw = await AsyncStorage.getItem(LEGACY_KEY_PACKET(meta.eventId))
          if (!raw) continue
          const packet = JSON.parse(raw) as EventPacket
          await savePacket(packet)
        } catch { /* skip individual packet failures */ }
      }
    }

    // 2. Migrar queue (com nextRetryAt se existir)
    const qRaw = await AsyncStorage.getItem(LEGACY_KEY_QUEUE)
    if (qRaw) {
      try {
        const parsed = JSON.parse(qRaw) as unknown
        if (Array.isArray(parsed)) {
          const db = await getDb()
          for (const a of parsed as PendingAction[]) {
            await db.runAsync(
              `INSERT OR IGNORE INTO pending_actions
                (id, type, event_id, participant_id, instance_index, data_json, status,
                 attempts, created_at, next_retry_at, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              a.id,
              a.type,
              a.eventId,
              a.participantId,
              a.instanceIndex ?? null,
              JSON.stringify({
                observation: a.observation,
                allowNoStock: a.allowNoStock,
                allowNoStockReason: a.allowNoStockReason,
              }),
              a.status,
              a.attempts,
              a.createdAt,
              a.nextRetryAt ?? null,
              a.error ?? null,
            )
          }
        }
      } catch { /* skip queue migration failures */ }
    }

    // 3. Marca migrado e limpa AsyncStorage legacy
    await AsyncStorage.setItem(LEGACY_MIGRATION_DONE, 'true')
    // Limpa as chaves antigas pra recuperar storage. Best-effort.
    const idxParsed = idxRaw ? (JSON.parse(idxRaw) as PacketMeta[]) : []
    const keysToRemove = [
      LEGACY_KEY_INDEX,
      LEGACY_KEY_QUEUE,
      ...idxParsed.map((m) => LEGACY_KEY_PACKET(m.eventId)),
    ]
    await AsyncStorage.multiRemove(keysToRemove).catch(() => { /* ignore */ })
  } catch {
    // Se a migration falhar, não bloqueia o boot — usuário só perde o packet
    // antigo (precisa baixar de novo). Marcamos como done pra não tentar de
    // novo a cada boot.
    await AsyncStorage.setItem(LEGACY_MIGRATION_DONE, 'true').catch(() => {})
  }
}
