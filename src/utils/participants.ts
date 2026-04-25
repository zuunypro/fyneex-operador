import type { MobileParticipant } from '@/hooks/useParticipants'
import { normalizeForSearch } from '@/utils/text'

export interface GroupInfo {
  pos: number
  total: number
  color: string
  first: boolean
  last: boolean
}

export interface GroupedParticipants {
  items: MobileParticipant[]
  groupOf: Map<string, GroupInfo>
}

const PALETTE = [
  '#8B5CF6', '#EC4899', '#22D3EE', '#0EA5E9',
  '#A855F7', '#14B8A6', '#6366F1', '#F0ABFC',
]

function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Groups tickets by orderNumber so multi-ticket purchases render adjacent and
 * share a color stripe. Single tickets stay unmarked to keep the list clean.
 */
export function groupByOrder(participants: MobileParticipant[]): GroupedParticipants {
  const buckets = new Map<string, MobileParticipant[]>()
  const firstOrder: string[] = []
  const loose: MobileParticipant[] = []
  for (const p of participants) {
    const key = p.orderNumber
    if (!key) { loose.push(p); continue }
    let bucket = buckets.get(key)
    if (!bucket) { bucket = []; buckets.set(key, bucket); firstOrder.push(key) }
    bucket.push(p)
  }
  const items = [...firstOrder.flatMap((k) => buckets.get(k)!), ...loose]

  const groupOf = new Map<string, GroupInfo>()
  for (const k of firstOrder) {
    const bucket = buckets.get(k)!
    if (bucket.length < 2) continue
    const color = PALETTE[hashKey(k) % PALETTE.length]
    bucket.forEach((p, idx) => groupOf.set(p.id, {
      pos: idx + 1,
      total: bucket.length,
      color,
      first: idx === 0,
      last: idx === bucket.length - 1,
    }))
  }
  return { items, groupOf }
}

/** Case-insensitive + accent-insensitive. Cobre nome do participante, nome
 *  do comprador, número do pedido, últimos 5 do CPF do comprador e campos
 *  do formulário. Mantido em sync com `applyFilters` no servidor
 *  (`participants.tsx`) e com `buildSearchText` em `services/offline.ts`.
 *
 *  Aceita o input cru do TextInput (`searchRaw`) — normaliza internamente
 *  pra remover acentos. "João" digitado como "joao" agora bate. */
export function matchParticipant(p: MobileParticipant, searchRaw: string): boolean {
  const s = normalizeForSearch(searchRaw)
  if (!s) return true
  const sDigits = searchRaw.replace(/\D/g, '')
  // Defesa em profundidade: o tipo garante string, mas packets antigos / sync
  // legado podem ter campos null e crashar `.toLowerCase()`.
  return (
    normalizeForSearch(p.name ?? '').includes(s) ||
    normalizeForSearch(p.buyerName ?? '').includes(s) ||
    normalizeForSearch(p.participantId ?? '').includes(s) ||
    normalizeForSearch(p.orderNumber ?? '').includes(s) ||
    (sDigits.length >= 3 && (p.buyerCpfLast5 ?? '').includes(sDigits)) ||
    (p.instanceFields?.some((f) => normalizeForSearch(f.value ?? '').includes(s)) ?? false)
  )
}
