import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPost, ApiError } from '../services/api'
import type { MobileParticipant } from './useParticipants'

interface CheckinPayload {
  /** Raw order_item id. Do NOT send the composite "#idx" form here — use instanceIndex instead. */
  participantId: string
  eventId: string
  /** 1..quantity — required when the order_item covers multiple tickets so only this
   *  instance is validated instead of the whole purchase. */
  instanceIndex?: number
  /** Optional free-text observation. Persisted server-side as part of the
   *  participant_actions audit row metadata. Trimmed to 500 chars on the wire. */
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
    mutationFn: (data: CheckinPayload) => {
      const payload: CheckinPayload = {
        participantId: data.participantId,
        eventId: data.eventId,
      }
      if (data.instanceIndex !== undefined) payload.instanceIndex = data.instanceIndex
      if (data.observation && data.observation.trim()) {
        payload.observation = data.observation.trim().slice(0, 500)
      }
      return apiPost<CheckinResponse>('/api/mobile/checkin', payload)
    },

    // Optimistic flip: the row turns green the instant the operator taps
    // Confirm, so fingers-faster-than-wifi crews see instant feedback. The
    // server eventually invalidates the cache; on rollback we restore the
    // snapshot taken here.
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['mobile', 'participants', variables.eventId] })
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
      // Keep the optimistic flip for 409s — the server is telling us the row
      // was already checked, so the green state is actually correct.
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
