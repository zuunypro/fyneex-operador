import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../services/api'

export interface InstanceField {
  label: string
  value: string
}

export interface MobileParticipant {
  /** Unique row id. "{orderItemId}" for single-ticket rows, "{orderItemId}#{idx}" for instances. */
  id: string
  /** Raw order_item id — what the checkin endpoint expects. */
  participantId: string
  /** 1..quantity — only present when the purchase covers multiple tickets. */
  instanceIndex?: number
  /** Total tickets in this order_item (= quantity). */
  instanceTotal?: number
  /** Participant's name (from form_responses when required, otherwise buyer's name). */
  name: string
  email: string
  initials: string
  ticketName: string
  category: string
  batch: string | null
  status: 'pending' | 'checked'
  checkedInAt: string | null
  orderNumber: string
  observation?: string
  /** e.g. "Ingresso 2 de 5" — shown next to the row when part of a multi-ticket purchase. */
  instanceLabel?: string
  /** Identifying form fields for THIS instance (name, CPF, camiseta, etc.). */
  instanceFields?: InstanceField[]
  /** Account holder's name (who paid) — shown only in the expanded details. */
  buyerName?: string
  /** Account holder's email — shown only in the expanded details. */
  buyerEmail?: string
  /** True when this purchase maps to at least one configured inventory_items
   *  row for the event. The Stock screen hides rows with hasKit === false. */
  hasKit?: boolean
  /** ISO timestamp returned by the listing when the kit has already been
   *  delivered. The Stock screen treats this as the authoritative "delivered"
   *  flag and falls back to the localStorage echo only when the field is
   *  absent (older backend deploys). */
  kitWithdrawnAt?: string | null
}

interface ParticipantsResponse {
  participants: MobileParticipant[]
  total: number
  page: number
  pageSize: number
}

interface UseParticipantsOptions {
  search?: string
  status?: 'all' | 'pending' | 'checked'
  page?: number
  pageSize?: number
}

export function useParticipants(eventId: string, options: UseParticipantsOptions = {}) {
  const { search = '', status = 'all', page = 0, pageSize = 100 } = options
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (status !== 'all') params.set('status', status)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))

  return useQuery({
    queryKey: ['mobile', 'participants', eventId, { search, status, page, pageSize }],
    queryFn: () => apiGet<ParticipantsResponse>(`/api/mobile/events/${eventId}/participants?${params.toString()}`),
    enabled: !!eventId,
    refetchInterval: 15_000,
    // Pick up reverts performed on /organizador/participantes the moment the
    // operator switches back to the scanner app, instead of waiting out the
    // 15s interval. Overrides the app-wide refetchOnWindowFocus: false.
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    gcTime: 60_000,
  })
}
