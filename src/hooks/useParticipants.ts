import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/services/api'

export interface InstanceField {
  label: string
  value: string
}

export interface MobileParticipant {
  id: string
  participantId: string
  instanceIndex?: number
  instanceTotal?: number
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
  instanceLabel?: string
  instanceFields?: InstanceField[]
  buyerName?: string
  buyerEmail?: string
  hasKit?: boolean
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
    queryFn: () =>
      apiGet<ParticipantsResponse>(
        `/api/mobile/events/${eventId}/participants?${params.toString()}`,
      ),
    enabled: !!eventId,
    refetchInterval: 15_000,
    // Em RN o equivalente a refetchOnWindowFocus é refetchOnFocus, que é true
    // por padrão quando AppState vira 'active'. Mantemos para capturar edits
    // feitos no painel organizador enquanto o app estava em background.
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    gcTime: 60_000,
  })
}
