import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, ApiError } from '@/services/api'
import { enqueue, patchParticipantInPacket } from '@/services/offline'
import { useOfflineStore } from '@/stores/offlineStore'
import type { MobileParticipant } from './useParticipants'

interface CheckinPayload {
  participantId: string
  eventId: string
  instanceIndex?: number
  observation?: string
}

interface CheckinResponse {
  success: boolean
  code?: string
  checkedInAt?: string
  instanceIndex?: number
  allValidated?: boolean
  error?: string
  participant?: {
    name: string
    ticketName: string
  }
  queued?: boolean
}

interface ParticipantsCache {
  participants: MobileParticipant[]
  total: number
  page: number
  pageSize: number
}

type CheckinContext = {
  snapshots: Array<{ key: unknown[]; data: ParticipantsCache }>
}

function matchesRow(row: MobileParticipant, v: CheckinPayload): boolean {
  if (row.participantId !== v.participantId) return false
  if (v.instanceIndex === undefined) return true
  return row.instanceIndex === v.instanceIndex
}

export function useCheckin() {
  const queryClient = useQueryClient()

  return useMutation<CheckinResponse, Error, CheckinPayload, CheckinContext>({
    mutationFn: async (data: CheckinPayload) => {
      const payload: CheckinPayload = {
        participantId: data.participantId,
        eventId: data.eventId,
      }
      if (data.instanceIndex !== undefined) payload.instanceIndex = data.instanceIndex
      if (data.observation && data.observation.trim()) {
        payload.observation = data.observation.trim().slice(0, 500)
      }

      const isOnline = useOfflineStore.getState().online !== false
      if (!isOnline) {
        // enqueue ANTES do patch: se enqueue falhar por algum motivo (quota,
        // storage bloqueado), não deixamos a UI mentindo "entregue" sem o
        // servidor jamais ser avisado.
        await enqueue({
          type: 'checkin',
          eventId: data.eventId,
          participantId: data.participantId,
          instanceIndex: data.instanceIndex,
          observation: payload.observation,
        })
        await patchParticipantInPacket(
          data.eventId,
          data.participantId,
          data.instanceIndex,
          { status: 'checked', checkedInAt: new Date().toISOString() },
        )
        await useOfflineStore.getState().refreshState()
        return { success: true, queued: true }
      }

      return apiPost<CheckinResponse>('/api/mobile/checkin', payload)
    },

    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: ['mobile', 'participants', variables.eventId],
      })
      const snapshots: CheckinContext['snapshots'] = []
      const nowIso = new Date().toISOString()
      queryClient.setQueriesData<ParticipantsCache>(
        { queryKey: ['mobile', 'participants', variables.eventId] },
        (old) => {
          if (!old) return old
          snapshots.push({ key: ['mobile', 'participants', variables.eventId], data: old })
          const next = old.participants.map((p) => {
            if (!matchesRow(p, variables)) return p
            return {
              ...p,
              status: 'checked' as const,
              checkedInAt: p.checkedInAt || nowIso,
            }
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

    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['mobile', 'participants', variables.eventId],
      })
      queryClient.invalidateQueries({
        queryKey: ['mobile', 'stats', variables.eventId],
      })
    },
  })
}
