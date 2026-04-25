/**
 * Storage analysis helpers — usado antes de baixar um evento offline pra
 * estimar se o device tem espaço suficiente, e mostrar UI de aviso.
 *
 * Bytes por participant (média empírica): ~1.5 KB JSON serializado +
 * overhead de índices SQLite ≈ ~2 KB por row. Item de inventário ≈ ~0.5 KB.
 *
 * Margem de segurança: pedimos 2x o tamanho estimado pra ter folga pra cache,
 * fila offline futura, e evitar quase-cheio que pode travar o SQLite (WAL).
 */

import * as FileSystem from 'expo-file-system'

const BYTES_PER_PARTICIPANT = 2_048
const BYTES_PER_ITEM = 512
/** Multiplica o tamanho estimado pra ter folga (cache, queue, growth). */
const SAFETY_MARGIN = 2

export interface StorageEstimate {
  participants: number
  inventoryItems: number
  /** Bytes mínimos que o packet vai ocupar no SQLite. */
  minBytes: number
  /** Bytes recomendados (com margem de segurança 2x). */
  recommendedBytes: number
}

export interface StorageStatus {
  /** Bytes disponíveis no storage do device. null se a API não respondeu. */
  freeBytes: number | null
  /** Bytes totais do storage. null se indisponível. */
  totalBytes: number | null
  estimate: StorageEstimate
  /** true se freeBytes < recommendedBytes (recomenda bloquear download). */
  insufficient: boolean
  /** true se freeBytes < minBytes (CERTAMENTE não cabe). */
  critical: boolean
}

export function estimatePacketBytes(participants: number, inventoryItems: number): StorageEstimate {
  const minBytes = participants * BYTES_PER_PARTICIPANT + inventoryItems * BYTES_PER_ITEM
  return {
    participants,
    inventoryItems,
    minBytes,
    recommendedBytes: Math.ceil(minBytes * SAFETY_MARGIN),
  }
}

/**
 * Lê o espaço livre do filesystem do app. Em Expo SDK 52 usa o módulo legacy
 * `expo-file-system`. Caso o módulo retorne 0 ou falhe (raro, devices novos
 * com permissões restritas), retornamos null e a UI assume "indisponível".
 */
export async function getFreeBytes(): Promise<number | null> {
  try {
    // Tipos do expo-file-system não exportam getFreeDiskStorageAsync no .d.ts
    // de algumas versões; chamamos via cast pra evitar quebrar o build.
    const fs = FileSystem as unknown as {
      getFreeDiskStorageAsync?: () => Promise<number>
    }
    if (typeof fs.getFreeDiskStorageAsync !== 'function') return null
    const free = await fs.getFreeDiskStorageAsync()
    if (typeof free !== 'number' || !Number.isFinite(free) || free <= 0) return null
    return free
  } catch {
    return null
  }
}

export async function getTotalBytes(): Promise<number | null> {
  try {
    const fs = FileSystem as unknown as {
      getTotalDiskCapacityAsync?: () => Promise<number>
    }
    if (typeof fs.getTotalDiskCapacityAsync !== 'function') return null
    const total = await fs.getTotalDiskCapacityAsync()
    if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null
    return total
  } catch {
    return null
  }
}

export async function checkStorageForDownload(
  participants: number,
  inventoryItems: number,
): Promise<StorageStatus> {
  const estimate = estimatePacketBytes(participants, inventoryItems)
  const [freeBytes, totalBytes] = await Promise.all([getFreeBytes(), getTotalBytes()])
  // Se a API de free space não respondeu, NÃO bloqueia (otimismo defensivo:
  // melhor deixar o usuário tentar do que travar por falsa precaução).
  const insufficient =
    typeof freeBytes === 'number' && freeBytes < estimate.recommendedBytes
  const critical =
    typeof freeBytes === 'number' && freeBytes < estimate.minBytes
  return { freeBytes, totalBytes, estimate, insufficient, critical }
}

/* ── Formatters pra UI ──────────────────────────────────────────────────── */

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`
}
