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
const LEGACY_MIGRATION_ATTEMPTS = 'fyneex_offline_migrated_attempts'
const LEGACY_MIGRATION_MAX_ATTEMPTS = 3

/** Janela conceitual pra purga de backups da queue salvos no logout (7 dias). */
export const QUEUE_BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000
/**
 * Prefix das chaves AsyncStorage legacy. Hardening 2026-04-26 moveu o storage
 * pra tabela pending_actions_backup no SQLite (allowBackup:false + escopo do
 * app). Mantemos o prefix só pra one-shot cleanup no boot.
 */
const QUEUE_BACKUP_PREFIX = 'fyneex_offline_queue_backup_'
const QUEUE_BACKUP_LEGACY_CLEAN_FLAG = 'fyneex_queue_backup_legacy_cleaned_v1'

/**
 * Stale threshold default pro packet local (em horas). Configurável via prop
 * em <StalePacketWarning>; centralizado aqui pra reuso futuro (ex: cron de
 * lembrete pra re-baixar).
 */
export const DEFAULT_STALE_PACKET_HOURS = 12
/** Threshold reduzido pra eventos do dia — janela de mudança é mais curta. */
export const SAME_DAY_STALE_PACKET_HOURS = 4

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
  /**
   * P1-5: gate `requireCheckIn` do servidor. Quando o usuário tenta retirar
   * kit pós-evento sem ter feito check-in, o servidor bloqueia se este flag
   * for true (default). UI pode pedir override (false) pra entrega antecipada
   * autorizada pelo organizador. Persistido no queue offline pra que o replay
   * envie a MESMA decisão tomada no momento do scan — antes desta migração o
   * replay sempre defaultava no servidor (true), divergindo do comportamento
   * online quando o operador escolheu override pré-evento.
   */
  requireCheckIn?: boolean
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
 *
 * IMPORTANTE: roda em cima do MobileParticipant ORIGINAL (pré-redação) pra
 * preservar busca por buyerCpfLast5 mesmo após redactForOffline limpar o
 * campo do data_json — o índice mantém os 5 dígitos pra LIKE, o JSON não.
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

/**
 * Regex de campos sensíveis em instanceFields (formulário pós-compra) que
 * não precisam ficar em SQLite plain-text. Operador no portão só usa nome +
 * ticketName + status — CPF/email/telefone são PII e ficam só no servidor.
 * Match case-insensitive contra o `label` do field (que é o que o organizador
 * configurou no painel).
 */
const SENSITIVE_FIELD_KEY_RE = /(cpf|email|phone|telefone|rg|cnpj)/i

/**
 * LGPD: redação defensiva antes de gravar em SQLite. SQLCipher exigiria Expo
 * prebuild (saímos do Expo Go), então optamos por NÃO persistir o que não é
 * necessário pra UX offline. Search continua funcionando porque o search_text
 * (índice) é construído a partir do MobileParticipant ORIGINAL ANTES da
 * redação — buyerCpfLast5 vira buscável sem ser persistido em data_json.
 *
 * Mantemos: name, ticketName, category, status, kitWithdrawnAt, instanceLabel,
 * orderNumber e flags de UI. Removemos: buyerEmail, buyerPhone, buyerCpfLast5
 * e instanceFields cujo label match com SENSITIVE_FIELD_KEY_RE.
 */
export function redactForOffline(p: MobileParticipant): MobileParticipant {
  const filteredInstance = p.instanceFields?.filter(
    (f) => !SENSITIVE_FIELD_KEY_RE.test(f.label || ''),
  )
  return {
    ...p,
    buyerEmail: undefined,
    buyerPhone: undefined,
    buyerCpfLast5: undefined,
    instanceFields: filteredInstance,
  }
}

/* ── Packets (snapshots) ────────────────────────────────────────────────── */

interface PacketRow {
  event_id: string
  downloaded_at: string
  inventory_json: string
  stats_json: string | null
  participant_count: number
  item_count: number
  download_complete?: number
}

interface ParticipantRow {
  data_json: string
}

export async function savePacket(packet: EventPacket): Promise<void> {
  await withTransaction(async (db) => {
    // Replace garante que re-download substitui o packet inteiro de forma
    // atômica. ON DELETE CASCADE limpa rows da tabela participants.
    await db.runAsync('DELETE FROM event_packets WHERE event_id = ?', packet.eventId)
    // download_complete=0 enquanto o INSERT bulk roda — só vira 1 no fim.
    // Se o app crashar/processo morrer no meio, loadPacket retorna null e o
    // operador é forçado a re-baixar (em vez de operar com snapshot parcial).
    await db.runAsync(
      `INSERT INTO event_packets
        (event_id, downloaded_at, inventory_json, stats_json, participant_count, item_count, download_complete)
        VALUES (?, ?, ?, ?, ?, ?, 0)`,
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
      // Search text é montado ANTES da redação pra preservar busca por
      // buyerCpfLast5 mesmo sem persistir o campo em data_json (LGPD).
      const searchText = buildSearchText(p)
      const redacted = redactForOffline(p)
      await db.runAsync(
        `INSERT INTO participants
          (event_id, participant_id, instance_index, search_text, status, kit_withdrawn, order_number, data_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        packet.eventId,
        p.participantId,
        p.instanceIndex ?? null,
        searchText,
        p.status,
        p.kitWithdrawnAt ? 1 : 0,
        p.orderNumber ?? '',
        JSON.stringify(redacted),
      )
    }
    // Marca completo só ao final — atomicamente, dentro da mesma transação.
    await db.runAsync(
      'UPDATE event_packets SET download_complete = 1 WHERE event_id = ?',
      packet.eventId,
    )
  })
}

/**
 * UPSERT delta: aplica adições/atualizações + remoções pontuais sem destruir
 * o packet inteiro. Pensado pra refresh incremental (escala melhor que o
 * full replace do savePacket em eventos de 30k). Mantém atomicidade via
 * transação: se algo falhar no meio, ROLLBACK preserva o estado anterior.
 *
 * TODO: depende de backend expor `?since=<iso>` em
 * `/api/mobile/events/:id/participants` retornando só o delta. Por enquanto
 * `downloadEvent` ainda usa savePacket (full). Helper já fica pronto pra
 * quando o endpoint evoluir.
 */
export async function savePacketDelta(
  eventId: string,
  addedOrUpdated: MobileParticipant[],
  removedIds: { participantId: string; instanceIndex?: number }[],
  inventory?: { items: InventoryItem[]; stats?: InventoryStats },
): Promise<void> {
  await withTransaction(async (db) => {
    // Pré-condição: precisa existir um packet base. Sem isso, delta não faz
    // sentido — caller deve fazer full download primeiro.
    const meta = await db.getFirstAsync<{ event_id: string }>(
      'SELECT event_id FROM event_packets WHERE event_id = ?',
      eventId,
    )
    if (!meta) {
      throw new Error('savePacketDelta sem packet base — chame savePacket primeiro')
    }

    // INSERT OR REPLACE precisa de UNIQUE constraint na chave lógica. Como o
    // schema atual usa AUTOINCREMENT pk e índice composto (não UNIQUE), fazemos
    // DELETE+INSERT por chave lógica antes — equivalente em comportamento.
    for (const p of addedOrUpdated) {
      const searchText = buildSearchText(p)
      const redacted = redactForOffline(p)
      await db.runAsync(
        `DELETE FROM participants
          WHERE event_id = ? AND participant_id = ?
            AND ((instance_index IS NULL AND ? IS NULL) OR instance_index = ?)`,
        eventId,
        p.participantId,
        p.instanceIndex ?? null,
        p.instanceIndex ?? null,
      )
      await db.runAsync(
        `INSERT INTO participants
          (event_id, participant_id, instance_index, search_text, status, kit_withdrawn, order_number, data_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        eventId,
        p.participantId,
        p.instanceIndex ?? null,
        searchText,
        p.status,
        p.kitWithdrawnAt ? 1 : 0,
        p.orderNumber ?? '',
        JSON.stringify(redacted),
      )
    }

    for (const r of removedIds) {
      await db.runAsync(
        `DELETE FROM participants
          WHERE event_id = ? AND participant_id = ?
            AND ((instance_index IS NULL AND ? IS NULL) OR instance_index = ?)`,
        eventId,
        r.participantId,
        r.instanceIndex ?? null,
        r.instanceIndex ?? null,
      )
    }

    // Recalcula participant_count direto do COUNT pra não desviar do real.
    const countRow = await db.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) as c FROM participants WHERE event_id = ?',
      eventId,
    )
    const newCount = countRow?.c ?? 0

    if (inventory) {
      await db.runAsync(
        `UPDATE event_packets SET
          downloaded_at = ?, inventory_json = ?, stats_json = ?,
          participant_count = ?, item_count = ?, download_complete = 1
          WHERE event_id = ?`,
        new Date().toISOString(),
        JSON.stringify(inventory.items),
        inventory.stats ? JSON.stringify(inventory.stats) : null,
        newCount,
        inventory.items.length,
        eventId,
      )
    } else {
      await db.runAsync(
        `UPDATE event_packets SET
          downloaded_at = ?, participant_count = ?, download_complete = 1
          WHERE event_id = ?`,
        new Date().toISOString(),
        newCount,
        eventId,
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
  // Packet incompleto (download interrompido / app crash no meio do
  // savePacket) → trata como ausente pra forçar re-download.
  if (meta.download_complete === 0) return null

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
    // P1-5: legacy rows criadas antes desta migração não tinham `requireCheckIn`
    // no data_json; defaulta pra true (matches default do servidor). Replay
    // dessas rows mantém o comportamento safe.
    requireCheckIn: extras.requireCheckIn ?? true,
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

/**
 * Hard cap pra fila offline. Acima disso dropamos novos inserts em vez de
 * encher disco silenciosamente. 5000 cobre qualquer evento real (típico
 * < 3000 entries/dia inteiro de balcão); ultrapassar = bug ou esquecimento
 * extremo. Mensagem clara força operador a sincronizar antes de continuar.
 */
const QUEUE_HARD_CAP = 5000

export async function enqueue(
  action: Omit<PendingAction, 'id' | 'createdAt' | 'status' | 'attempts'>,
): Promise<PendingAction> {
  return withLock(async () => {
    const db = await getDb()
    const countRow = await db.getFirstAsync<{ c: number }>(
      'SELECT COUNT(*) as c FROM pending_actions',
    )
    if ((countRow?.c ?? 0) >= QUEUE_HARD_CAP) {
      throw new Error('Fila offline cheia (5000+) — sincronize antes de continuar')
    }
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
        requireCheckIn: entry.requireCheckIn,
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
        requireCheckIn: merged.requireCheckIn,
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
    // Re-aplica redação após o merge — patch pode trazer campos voláteis
    // (ex: kitWithdrawnAt) sem reintroduzir PII (já não estava no JSON
    // persistido, mas defensivamente re-redigimos).
    const redacted = redactForOffline(merged)
    await db.runAsync(
      `UPDATE participants SET
        data_json = ?, status = ?, kit_withdrawn = ?, search_text = ?
        WHERE pk = ?`,
      JSON.stringify(redacted),
      merged.status,
      merged.kitWithdrawnAt ? 1 : 0,
      buildSearchText(merged),
      r.pk,
    )
  }
}

/** Quantas ações pendentes/falhadas/em-sync existem pra um evento (UI). */
export async function getPendingActionsForEvent(eventId: string): Promise<number> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM pending_actions WHERE event_id = ? AND status != 'synced'",
    eventId,
  )
  return row?.c ?? 0
}

/** Conta participants gravados pra um evento — usado pra checksum pós-download. */
export async function countParticipantsInPacket(eventId: string): Promise<number> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM participants WHERE event_id = ?',
    eventId,
  )
  return row?.c ?? 0
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

/* ── Queue backup (logout / wipeAll safety net) ────────────────────────── */

/**
 * Backup pré-wipe da fila. Salva tentativas que seriam descartadas em logout
 * acidental (operador toca "Sair" sem perceber que há ações offline). UI
 * pode oferecer recovery via recoverQueueBackup() se detectar backups
 * recentes — não restauramos automaticamente porque o usuário logado depois
 * pode ser outro (token diferente, queue do user A no contexto do user B
 * geraria erros de auth confusos).
 *
 * Hardening 2026-04-26: backup migrado de AsyncStorage pra tabela
 * pending_actions_backup no SQLite. AsyncStorage Android era visível em
 * backup automático + ADB; SQLite + allowBackup:false fica protegido pelo
 * sandbox do app.
 */
export async function saveQueueBackup(actions: PendingAction[]): Promise<void> {
  if (actions.length === 0) return
  try {
    const db = await getDb()
    const ts = Date.now()
    const id = `backup_${ts}_${Math.random().toString(36).slice(2, 8)}`
    await db.runAsync(
      'INSERT INTO pending_actions_backup (id, backed_up_at, action_count, payload_json) VALUES (?, ?, ?, ?)',
      id,
      ts,
      actions.length,
      JSON.stringify(actions),
    )
  } catch {
    // Best-effort: se o backup falha, logout não fica travado.
  }
}

/**
 * Lista backups existentes que ainda estão dentro do TTL (7d). Backups
 * antigos são purgados aqui — best-effort, executado a cada chamada de
 * hydrate pra que devices pouco usados não acumulem.
 */
export async function listQueueBackups(): Promise<{ key: string; at: number; count: number }[]> {
  try {
    const db = await getDb()
    const now = Date.now()
    // Purga expirados primeiro (TTL 7d).
    await db.runAsync(
      'DELETE FROM pending_actions_backup WHERE backed_up_at < ?',
      now - QUEUE_BACKUP_TTL_MS,
    )
    const rows = await db.getAllAsync<{ id: string; backed_up_at: number; action_count: number }>(
      'SELECT id, backed_up_at, action_count FROM pending_actions_backup ORDER BY backed_up_at DESC',
    )
    return rows.map((r) => ({ key: r.id, at: r.backed_up_at, count: r.action_count }))
  } catch {
    return []
  }
}

/**
 * One-shot cleanup das chaves AsyncStorage legacy `fyneex_offline_queue_backup_*`
 * que ficaram do tempo pré-SQLite. Roda a cada boot até confirmar zero chaves
 * restantes — após a primeira execução bem-sucedida grava flag pra skip.
 *
 * Por que limpar agressivamente: AsyncStorage no Android era exposto via
 * adb backup / autoBackup quando allowBackup=true (default antigo). Embora
 * agora desabilitemos o backup, queremos zerar histórico no device pra que
 * dumps antigos não tenham PII residual.
 */
export async function purgeLegacyQueueBackup(): Promise<void> {
  try {
    const flag = await AsyncStorage.getItem(QUEUE_BACKUP_LEGACY_CLEAN_FLAG)
    if (flag === 'true') return
    const keys = await AsyncStorage.getAllKeys()
    const legacy = keys.filter((k) => k.startsWith(QUEUE_BACKUP_PREFIX))
    if (legacy.length > 0) {
      await AsyncStorage.multiRemove(legacy).catch(() => {})
    }
    await AsyncStorage.setItem(QUEUE_BACKUP_LEGACY_CLEAN_FLAG, 'true').catch(() => {})
  } catch {
    // best-effort
  }
}

/* ── Migration AsyncStorage → SQLite (one-shot) ────────────────────────── */

/**
 * Chamada uma vez no boot. Se há packets/queue antigos no AsyncStorage de
 * versões anteriores, copia pra SQLite e marca como migrado. Subsequentes
 * boots checam o flag e fazem skip imediato.
 */
export async function migrateLegacyAsyncStorage(): Promise<void> {
  const done = await AsyncStorage.getItem(LEGACY_MIGRATION_DONE).catch(() => null)
  if (done === 'true') return

  // Retry budget pra que falhas transitórias (storage cheio, race em SQLite
  // open) não desistam permanente já no 1º boot — mas que também não fiquem
  // tentando pra sempre se o packet legacy estiver corrompido. Após
  // LEGACY_MIGRATION_MAX_ATTEMPTS, marca como done pra desbloquear o app.
  const attemptsRaw = await AsyncStorage.getItem(LEGACY_MIGRATION_ATTEMPTS).catch(() => null)
  const attempts = attemptsRaw ? Number.parseInt(attemptsRaw, 10) || 0 : 0
  await AsyncStorage.setItem(LEGACY_MIGRATION_ATTEMPTS, String(attempts + 1)).catch(() => {})

  try {
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
                requireCheckIn: a.requireCheckIn,
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

    // 3. SÓ marca migrado se chegou ao fim sem throw. Caso contrário, próximo
    // boot tenta de novo (até LEGACY_MIGRATION_MAX_ATTEMPTS).
    await AsyncStorage.setItem(LEGACY_MIGRATION_DONE, 'true')
    // Limpa as chaves antigas pra recuperar storage. Best-effort.
    const idxParsed = idxRaw ? (JSON.parse(idxRaw) as PacketMeta[]) : []
    const keysToRemove = [
      LEGACY_KEY_INDEX,
      LEGACY_KEY_QUEUE,
      LEGACY_MIGRATION_ATTEMPTS,
      ...idxParsed.map((m) => LEGACY_KEY_PACKET(m.eventId)),
    ]
    await AsyncStorage.multiRemove(keysToRemove).catch(() => { /* ignore */ })
  } catch {
    // Falha na migration: se já tentamos demais (>=MAX), marca como done pra
    // desbloquear o app. Caso contrário, deixa pra próximo boot — usuário
    // só perde o packet antigo se todas as 3 tentativas falharem.
    if (attempts + 1 >= LEGACY_MIGRATION_MAX_ATTEMPTS) {
      await AsyncStorage.setItem(LEGACY_MIGRATION_DONE, 'true').catch(() => {})
    }
  }
}
