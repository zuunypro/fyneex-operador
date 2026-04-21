import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/services/api'
import { useOfflineStore } from '@/stores/offlineStore'

export interface EventStockStats {
  totalItems: number
  totalStock: number
  lowStockItems: number
  healthyItems: number
  totalReserved: number
  totalWithdrawn: number
  pendingWithdrawals: number
  rate: number
}

export interface EventStats {
  total: number
  validated: number
  pending: number
  checkinRate: number
  stock: EventStockStats
}

interface StatsResponse {
  stats: EventStats
}

export function useEventStats(eventId: string) {
  const online = useOfflineStore((s) => s.online)

  return useQuery({
    queryKey: ['mobile', 'stats', eventId],
    queryFn: () => apiGet<StatsResponse>(`/api/mobile/events/${eventId}/stats`),
    // Desabilita quando offline — mantém o último valor em cache sem tentar
    // refetch que vai falhar e mostrar erro. gcTime de 60s garante que o
    // valor cacheado sobrevive pra ser exibido quando a query re-enable.
    enabled: !!eventId && online !== false,
    refetchInterval: online === false ? false : 30_000,
    staleTime: 10_000,
    gcTime: 60_000,
  })
}
