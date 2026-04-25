import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/services/api'
import { loadInventory } from '@/services/offline'
import { useOfflineStore } from '@/stores/offlineStore'

export type InventoryStatus = 'ok' | 'low' | 'out'

export interface InventoryItem {
  id: string
  name: string
  category: string
  variant: string | null
  sku: string | null
  unit: string
  currentStock: number
  reservedStock: number
  withdrawnStock: number
  minStock: number
  autoSynced: boolean
  imageUrl: string | null
  updatedAt: string
  status: InventoryStatus
}

export interface InventoryStats {
  total: number
  totalStock: number
  reserved: number
  withdrawn: number
  low: number
  out: number
  ok: number
}

interface InventoryResponse {
  items: InventoryItem[]
  total: number
  page: number
  pageSize: number
  stats: InventoryStats
}

interface UseInventoryOptions {
  search?: string
  status?: 'all' | InventoryStatus
  page?: number
  pageSize?: number
}

function emptyStats(): InventoryStats {
  return { total: 0, totalStock: 0, reserved: 0, withdrawn: 0, low: 0, out: 0, ok: 0 }
}

export function useInventory(eventId: string, options: UseInventoryOptions = {}) {
  const { search = '', status = 'all', page = 0, pageSize = 200 } = options
  const online = useOfflineStore((s) => s.online)

  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (status !== 'all') params.set('status', status)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))

  return useQuery({
    // `online` faz parte da key — mesma razão de useParticipants.
    queryKey: ['mobile', 'inventory', eventId, { search, status, page, pageSize, online }],
    queryFn: async () => {
      if (online === false) {
        // loadInventory retorna só items+stats — não carrega os 30k participants
        // do packet. Inventário tem volume baixo (~50 items típico), filtro
        // client-side roda em ms.
        const inv = await loadInventory(eventId)
        if (!inv) {
          throw new Error('Sem dados offline pra este evento. Baixe em Perfil → Offline.')
        }
        const all = inv.items
        const s = search.toLowerCase()
        const filtered = all.filter((i) => {
          if (status !== 'all' && i.status !== status) return false
          if (!s) return true
          return (
            i.name.toLowerCase().includes(s) ||
            (i.variant || '').toLowerCase().includes(s) ||
            (i.sku || '').toLowerCase().includes(s)
          )
        })
        return {
          items: filtered.slice(page * pageSize, (page + 1) * pageSize),
          total: filtered.length,
          page,
          pageSize,
          stats: inv.stats || emptyStats(),
        } as InventoryResponse
      }
      return apiGet<InventoryResponse>(
        `/api/mobile/events/${eventId}/inventory?${params.toString()}`,
      )
    },
    enabled: !!eventId,
    refetchInterval: online === false ? false : 20_000,
    staleTime: 8_000,
    gcTime: 60_000,
  })
}
