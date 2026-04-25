import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, ApiError } from '@/services/api'
import { enqueue, patchParticipantInPacket } from '@/services/offline'
import { useOfflineStore } from '@/stores/offlineStore'
import type { MobileParticipant } from './useParticipants'

interface RevertKitPayload {
  participantId: string
  eventId: string
  instanceIndex?: number
  /**
   * Justificativa opcional do operador (ex: "kit errado", "tamanho trocado").
   * Servidor aceita campos extras hoje e ignora os desconhecidos — quando o
   * back agent atualizar, vai ler de `reason` no metadata. Opcional.
   */
  reason?: string
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
  snapshots: { key: unknown[]; data: ParticipantsCache }[]
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
          instanceIndex: data.instanceIndex,
        })
        patchParticipantInPacket(data.eventId, data.participantId, data.instanceIndex, {
          kitWithdrawnAt: null,
        }).catch(() => { /* best-effort */ })
        await useOfflineStore.getState().refreshState()
        return { success: true, queued: true }
      }
      const reason = data.reason && data.reason.trim()
        ? data.reason.trim().slice(0, 500)
        : undefined
      return apiPost<RevertKitResponse>('/api/mobile/kit/revert', {
        participantId: data.participantId,
        eventId: data.eventId,
        instanceIndex: data.instanceIndex,
        ...(reason ? { reason } : {}),
      })
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
          const next = old.participants.map((p) => {
            if (p.participantId !== variables.participantId) return p
            if (variables.instanceIndex !== undefined && p.instanceIndex !== variables.instanceIndex) return p
            return { ...p, kitWithdrawnAt: null }
          })
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

    onSettled: (data, _err, variables) => {
      if (data?.queued) return
      queryClient.invalidateQueries({
        queryKey: ['mobile', 'participants', variables.eventId],
      })
      queryClient.invalidateQueries({
        queryKey: ['mobile', 'inventory', variables.eventId],
      })
    },
  })
}
