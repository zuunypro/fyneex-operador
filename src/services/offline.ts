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

/* ── Packets (snapshots) ────────────────────────────────────────────────── */

export async function savePacket(packet: EventPacket): Promise<void> {
  await AsyncStorage.setItem(KEY_PACKET(packet.eventId), JSON.stringify(packet))
  const idx = await loadIndex()
  const next = idx.filter((m) => m.eventId !== packet.eventId)
  next.push({
    eventId: packet.eventId,
    downloadedAt: packet.downloadedAt,
    participantCount: packet.participants.length,
    itemCount: packet.inventory.items.length,
  })
  await AsyncStorage.setItem(KEY_INDEX, JSON.stringify(next))
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

export async function removePacket(eventId: string): Promise<void> {
  await AsyncStorage.removeItem(KEY_PACKET(eventId))
  const idx = await loadIndex()
  await AsyncStorage.setItem(
    KEY_INDEX,
    JSON.stringify(idx.filter((m) => m.eventId !== eventId)),
  )
}

export async function wipePackets(): Promise<void> {
  const idx = await loadIndex()
  await Promise.all(idx.map((m) => AsyncStorage.removeItem(KEY_PACKET(m.eventId))))
  await AsyncStorage.removeItem(KEY_INDEX)
}

/* ── Queue (mutations offline) ──────────────────────────────────────────── */

export async function loadQueue(): Promise<PendingAction[]> {
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

async function saveQueue(queue: PendingAction[]): Promise<void> {
  await AsyncStorage.setItem(KEY_QUEUE, JSON.stringify(queue))
}

export async function enqueue(
  action: Omit<PendingAction, 'id' | 'createdAt' | 'status' | 'attempts'>,
): Promise<PendingAction> {
  const queue = await loadQueue()
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
}

export async function updateQueueItem(
  id: string,
  patch: Partial<PendingAction>,
): Promise<void> {
  const queue = await loadQueue()
  const next = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
  await saveQueue(next)
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await loadQueue()
  await saveQueue(queue.filter((q) => q.id !== id))
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(KEY_QUEUE)
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
  const packet = await loadPacket(eventId)
  if (!packet) return
  const next = packet.participants.map((p) => {
    if (p.participantId !== participantId) return p
    if (instanceIndex !== undefined && p.instanceIndex !== instanceIndex) return p
    return { ...p, ...patch }
  })
  await savePacket({ ...packet, participants: next })
}
