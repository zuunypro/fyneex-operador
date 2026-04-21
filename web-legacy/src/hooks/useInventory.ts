import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../services/api'

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

export function useInventory(eventId: string, options: UseInventoryOptions = {}) {
  const { search = '', status = 'all', page = 0, pageSize = 200 } = options
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (status !== 'all') params.set('status', status)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))

  return useQuery({
    queryKey: ['mobile', 'inventory', eventId, { search, status, page, pageSize }],
    queryFn: () =>
      apiGet<InventoryResponse>(`/api/mobile/events/${eventId}/inventory?${params.toString()}`),
    enabled: !!eventId,
    refetchInterval: 20_000,
    staleTime: 8_000,
    gcTime: 60_000,
  })
}
