import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost } from '@/services/api'

export type AdjustType = 'entry' | 'exit'
export type AdjustReason = 'purchase' | 'distribution' | 'loss' | 'adjustment' | 'return'

interface AdjustPayload {
  itemId: string
  eventId: string
  type: AdjustType
  quantity: number
  reason: AdjustReason
  notes?: string
}

interface AdjustResponse {
  success: boolean
  item?: {
    id: string
    currentStock: number
    reservedStock: number
    withdrawnStock: number
    minStock: number
    updatedAt: string
  } | null
  movement?: {
    id: string
    type: AdjustType
    quantity: number
    created_at?: string
  }
}

export function useInventoryAdjust() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ eventId: _eventId, ...body }: AdjustPayload) =>
      apiPost<AdjustResponse>('/api/mobile/inventory/adjust', body),

    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['mobile', 'inventory', variables.eventId],
      })
    },
  })
}
