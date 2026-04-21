/**
 * Offline persistence + sync worker.
 *
 * Modelo: pra cada evento o operador "baixa offline" e gravamos dois snapshots
 * em AsyncStorage — a lista de participantes e o inventário no momento do
 * download. Mutations (checkin, retirada, reverts) feitas offline viram
 * PendingAction numa fila global, que é drenada assim que a net volta.
 *
 * Por que AsyncStorage e não SQLite:
 *  - Volume típico: ~1000 participants × ~1KB cada JSON = ~1MB por evento
 *  - AsyncStorage em RN atual suporta vários MB por chave sem problema
 *  - Zero setup nativo (SQLite exigiria plugin + migrations)
 *  - Se passarmos de 6MB por chave no futuro, migramos pra expo-sqlite
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { MobileParticipant } from '@/hooks/useParticipants'
import type { InventoryItem, InventoryStats } from '@/hooks/useInventory'

const KEY_PACKET = (eventId: string) => `fyneex_offline_packet_v1_${eventId}`
const KEY_INDEX = 'fyneex_offline_index_v1'
const KEY_QUEUE = 'fyneex_offline_queue_v1'

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
  createdAt: string
  status: 'pending' | 'syncing' | 'synced' | 'failed'
  error?: string
  attempts: number
}

function uid(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  )
}

/**
 * Mutex in-memory que serializa operações read-modify-write em AsyncStorage.
 * Sem isso, scans rápidos offline podiam perder mutations porque o segundo
 * write sobrescrevia a versão desatualizada lida antes do primeiro terminar.
 * Todos os helpers abaixo que tocam packet/queue usam `withLock`.
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

/* ── Packets (snapshots) ────────────────────────────────────────────────── */

export async function savePacket(packet: EventPacket): Promise<void> {
  return withLock(async () => {
    await AsyncStorage.setItem(KEY_PACKET(packet.eventId), JSON.stringify(packet))
    const idx = await loadIndexInternal()
    const next = idx.filter((m) => m.eventId !== packet.eventId)
    next.push({
      eventId: packet.eventId,
      downloadedAt: packet.downloadedAt,
      participantCount: packet.participants.length,
      itemCount: packet.inventory.items.length,
    })
    await AsyncStorage.setItem(KEY_INDEX, JSON.stringify(next))
  })
}

async function loadIndexInternal(): Promise<PacketMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_INDEX)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as PacketMeta[]
  } catch {
    return []
  }
}

export async function loadPacket(eventId: string): Promise<EventPacket | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PACKET(eventId))
    if (!raw) return null
    return JSON.parse(raw) as EventPacket
  } catch {
    return null
  }
}

export async function loadIndex(): Promise<PacketMeta[]> {
  return loadIndexInternal()
}

export async function removePacket(eventId: string): Promise<void> {
  return withLock(async () => {
    await AsyncStorage.removeItem(KEY_PACKET(eventId))
    const idx = await loadIndexInternal()
    await AsyncStorage.setItem(
      KEY_INDEX,
      JSON.stringify(idx.filter((m) => m.eventId !== eventId)),
    )
  })
}

export async function wipePackets(): Promise<void> {
  return withLock(async () => {
    const idx = await loadIndexInternal()
    await Promise.all(idx.map((m) => AsyncStorage.removeItem(KEY_PACKET(m.eventId))))
    await AsyncStorage.removeItem(KEY_INDEX)
  })
}

/* ── Queue (mutations offline) ──────────────────────────────────────────── */

async function loadQueueInternal(): Promise<PendingAction[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_QUEUE)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as PendingAction[]
  } catch {
    return []
  }
}

export async function loadQueue(): Promise<PendingAction[]> {
  return loadQueueInternal()
}

async function saveQueue(queue: PendingAction[]): Promise<void> {
  await AsyncStorage.setItem(KEY_QUEUE, JSON.stringify(queue))
}

export async function enqueue(
  action: Omit<PendingAction, 'id' | 'createdAt' | 'status' | 'attempts'>,
): Promise<PendingAction> {
  return withLock(async () => {
    const queue = await loadQueueInternal()
    const entry: PendingAction = {
      ...action,
      id: uid(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      attempts: 0,
    }
    queue.push(entry)
    await saveQueue(queue)
    return entry
  })
}

export async function updateQueueItem(
  id: string,
  patch: Partial<PendingAction>,
): Promise<void> {
  return withLock(async () => {
    const queue = await loadQueueInternal()
    const next = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
    await saveQueue(next)
  })
}

export async function removeFromQueue(id: string): Promise<void> {
  return withLock(async () => {
    const queue = await loadQueueInternal()
    await saveQueue(queue.filter((q) => q.id !== id))
  })
}

export async function removeFromQueueByEvent(eventId: string): Promise<void> {
  return withLock(async () => {
    const queue = await loadQueueInternal()
    await saveQueue(queue.filter((q) => q.eventId !== eventId))
  })
}

export async function clearQueue(): Promise<void> {
  return withLock(async () => {
    await AsyncStorage.removeItem(KEY_QUEUE)
  })
}

/* ── Packet update helpers (manter cache fresco com mutations) ─────────── */

/**
 * Atualiza um participant no packet local. Usado pelas mutations offline
 * pra refletir otimista no cache (ex: marcar kitWithdrawnAt depois de uma
 * retirada offline) — assim reabrir o app no mesmo evento mostra o estado
 * coerente mesmo antes do sync.
 */
export async function patchParticipantInPacket(
  eventId: string,
  participantId: string,
  instanceIndex: number | undefined,
  patch: Partial<MobileParticipant>,
): Promise<void> {
  return withLock(async () => {
    const raw = await AsyncStorage.getItem(KEY_PACKET(eventId))
    if (!raw) return
    let packet: EventPacket
    try {
      packet = JSON.parse(raw) as EventPacket
    } catch {
      return
    }
    const next = packet.participants.map((p) => {
      if (p.participantId !== participantId) return p
      if (instanceIndex !== undefined && p.instanceIndex !== instanceIndex) return p
      return { ...p, ...patch }
    })
    await AsyncStorage.setItem(
      KEY_PACKET(eventId),
      JSON.stringify({ ...packet, participants: next }),
    )
  })
}
