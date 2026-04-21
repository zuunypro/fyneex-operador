import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, ApiError } from '@/services/api'
import { enqueue, patchParticipantInPacket } from '@/services/offline'
import { useOfflineStore } from '@/stores/offlineStore'
import type { MobileParticipant } from './useParticipants'

interface WithdrawalPayload {
  participantId: string
  eventId: string
  instanceIndex?: number
  allowNoStock?: boolean
}

interface WithdrawalResponse {
  success: boolean
  code?: string
  action?: string
  withdrawnAt?: string
  checkedIn?: boolean
  checkedInAt?: string
  implicitCheckIn?: boolean
  kit?: {
    items: Array<{ label: string; variant: string | null }>
    affected: number
    errors?: Array<{ label: string; itemId: string | null; message: string }>
  }
  warning?: string
  participant?: { name: string; ticketName: string }
  queued?: boolean
}

interface ParticipantsCache {
  participants: MobileParticipant[]
  total: number
  page: number
  pageSize: number
}

type WithdrawalContext = {
  snapshots: Array<{ key: unknown[]; data: ParticipantsCache }>
}

function matchesRow(row: MobileParticipant, v: WithdrawalPayload): boolean {
  if (row.participantId !== v.participantId) return false
  if (v.instanceIndex === undefined) return true
  return row.instanceIndex === v.instanceIndex
}

export function useKitWithdrawal() {
  const queryClient = useQueryClient()

  return useMutation<WithdrawalResponse, Error, WithdrawalPayload, WithdrawalContext>({
    mutationFn: async (data: WithdrawalPayload) => {
      const isOnline = useOfflineStore.getState().online !== false
      if (!isOnline) {
        await enqueue({
          type: 'withdrawal',
          eventId: data.eventId,
          participantId: data.participantId,
          instanceIndex: data.instanceIndex,
          allowNoStock: data.allowNoStock,
        })
        patchParticipantInPacket(data.eventId, data.participantId, data.instanceIndex, {
          kitWithdrawnAt: new Date().toISOString(),
        }).catch(() => { /* best-effort */ })
        await useOfflineStore.getState().refreshState()
        return { success: true, queued: true }
      }
      return apiPost<WithdrawalResponse>('/api/mobile/checkin', { ...data, mode: 'withdrawal' })
    },

    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: ['mobile', 'participants', variables.eventId],
      })
      const snapshots: WithdrawalContext['snapshots'] = []
      const nowIso = new Date().toISOString()
      queryClient.setQueriesData<ParticipantsCache>(
        { queryKey: ['mobile', 'participants', variables.eventId] },
        (old) => {
          if (!old) return old
          snapshots.push({ key: ['mobile', 'participants', variables.eventId], data: old })
          const next = old.participants.map((p) => {
            if (!matchesRow(p, variables)) return p
            return { ...p, kitWithdrawnAt: p.kitWithdrawnAt || nowIso }
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
