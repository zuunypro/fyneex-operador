import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../services/api'

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
  return useQuery({
    queryKey: ['mobile', 'stats', eventId],
    queryFn: () => apiGet<StatsResponse>(`/api/mobile/events/${eventId}/stats`),
    enabled: !!eventId,
    refetchInterval: 30_000,
    staleTime: 10_000,
    gcTime: 60_000,
  })
}
