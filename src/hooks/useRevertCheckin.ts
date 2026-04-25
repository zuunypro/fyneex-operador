import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, ApiError } from '@/services/api'
import { enqueue, patchParticipantInPacket } from '@/services/offline'
import { useOfflineStore } from '@/stores/offlineStore'
import type { MobileParticipant } from './useParticipants'

interface RevertCheckinPayload {
  participantId: string
  eventId: string
  instanceIndex?: number
  /**
   * Justificativa opcional do operador pra auditoria (ex: "ingresso duplicado",
   * "checkin acidental"). Servidor aceita campos extras no body e ignora os
   * desconhecidos — quando back agent atualizar, vai ler de `reason` no
   * metadata. Não bloqueia: operador pode reverter sem motivo.
   */
  reason?: string
}

interface RevertCheckinResponse {
  success: boolean
  code?: string
  action?: string
  instanceIndex?: number
  allValidated?: boolean
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

function matchesRow(row: MobileParticipant, v: RevertCheckinPayload): boolean {
  if (row.participantId !== v.participantId) return false
  if (v.instanceIndex === undefined) return true
  return row.instanceIndex === v.instanceIndex
}

export function useRevertCheckin() {
  const queryClient = useQueryClient()

  return useMutation<RevertCheckinResponse, Error, RevertCheckinPayload, RevertContext>({
    mutationFn: async (data: RevertCheckinPayload) => {
      const payload: RevertCheckinPayload = {
        participantId: data.participantId,
        eventId: data.eventId,
      }
      if (data.instanceIndex !== undefined) payload.instanceIndex = data.instanceIndex
      // Servidor ignora campos desconhecidos hoje, mas chega no audit log via
      // body raw. Quando back agent ler, vai jogar em metadata.reason.
      if (data.reason && data.reason.trim()) {
        payload.reason = data.reason.trim().slice(0, 500)
      }

      const isOnline = useOfflineStore.getState().online !== false
      if (!isOnline) {
        await enqueue({
          type: 'revert-checkin',
          eventId: data.eventId,
          participantId: data.participantId,
          instanceIndex: data.instanceIndex,
        })
        patchParticipantInPacket(data.eventId, data.participantId, data.instanceIndex, {
          status: 'pending',
          checkedInAt: null,
        }).catch(() => { /* best-effort */ })
        await useOfflineStore.getState().refreshState()
        return { success: true, queued: true }
      }

      return apiPost<RevertCheckinResponse>('/api/mobile/checkin/revert', payload)
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
            if (!matchesRow(p, variables)) return p
            return { ...p, status: 'pending' as const, checkedInAt: null }
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
        queryKey: ['mobile', 'stats', variables.eventId],
      })
    },
  })
}
