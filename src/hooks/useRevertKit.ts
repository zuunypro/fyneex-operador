import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, ApiError } from '@/services/api'
import { enqueue, patchParticipantInPacket } from '@/services/offline'
import { useOfflineStore } from '@/stores/offlineStore'
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
  queued?: boolean
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

export function useRevertKit() {
  const queryClient = useQueryClient()

  return useMutation<RevertKitResponse, Error, RevertKitPayload, RevertContext>({
    mutationFn: async (data: RevertKitPayload) => {
      const isOnline = useOfflineStore.getState().online !== false
      if (!isOnline) {
        await enqueue({
          type: 'revert-kit',
          eventId: data.eventId,
          participantId: data.participantId,
        })
        patchParticipantInPacket(data.eventId, data.participantId, undefined, {
          kitWithdrawnAt: null,
        }).catch(() => { /* best-effort */ })
        await useOfflineStore.getState().refreshState()
        return { success: true, queued: true }
      }
      return apiPost<RevertKitResponse>('/api/mobile/kit/revert', data)
    },

    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: ['mobile', 'participants', variables.eventId],
      })
      const snapshots: RevertContext['snapshots'] = []
      queryClient.setQueriesData<ParticipantsCache>(
        { queryKey: ['mobile', 'participants', variables.eventId] },
        (old) => {
          if (!old) return old
          snapshots.push({ key: ['mobile', 'participants', variables.eventId], data: old })
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
