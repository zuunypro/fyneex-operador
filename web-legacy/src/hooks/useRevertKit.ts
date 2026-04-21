import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, ApiError } from '../services/api'
import type { MobileParticipant } from './useParticipants'

interface RevertKitPayload {
  participantId: string
  eventId: string
}

interface RevertKitResponse {
  success: boolean
  code?: string
  action?: string
  itemsReversed?: number
  participant?: { name: string; ticketName: string }
}

interface ParticipantsCache {
  participants: MobileParticipant[]
  total: number
  page: number
  pageSize: number
}

type RevertContext = {
  snapshots: Array<{ key: unknown[]; data: ParticipantsCache }>
}

/**
 * Revert a kit hand-off: drops withdrawn_stock, bumps current_stock back,
 * and logs a compensating inventory movement. Hits /api/mobile/kit/revert;
 * returns 409 with code=KIT_NOT_WITHDRAWN when there's nothing to revert.
 */
export function useRevertKit() {
  const queryClient = useQueryClient()

  return useMutation<RevertKitResponse, Error, RevertKitPayload, RevertContext>({
    mutationFn: (data: RevertKitPayload) =>
      apiPost<RevertKitResponse>('/api/mobile/kit/revert', data),

    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['mobile', 'participants', variables.eventId] })
      const snapshots: RevertContext['snapshots'] = []
      queryClient.setQueriesData<ParticipantsCache>(
        { queryKey: ['mobile', 'participants', variables.eventId] },
        (old) => {
          if (!old) return old
          snapshots.push({ key: ['mobile', 'participants', variables.eventId], data: old })
          // Revert clears ALL instances of this order_item (the endpoint is
          // purchase-scoped; there's no instanceIndex).
          const next = old.participants.map((p) =>
            p.participantId === variables.participantId
              ? { ...p, kitWithdrawnAt: null }
              : p,
          )
          return { ...old, participants: next }
        },
      )
      return { snapshots }
    },

    onError: (err, variables, context) => {
      const is409 = err instanceof ApiError && err.status === 409
      if (!is409 && context?.snapshots) {
        for (const snap of context.snapshots) {
          queryClient.setQueryData(snap.key, snap.data)
        }
      }
      if (is409) {
        queryClient.invalidateQueries({
          queryKey: ['mobile', 'participants', variables.eventId],
        })
      }
    },

    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['mobile', 'participants', variables.eventId],
      })
      queryClient.invalidateQueries({
        queryKey: ['mobile', 'inventory', variables.eventId],
      })
    },
  })
}
