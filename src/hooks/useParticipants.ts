import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/services/api'
import { loadPacket } from '@/services/offline'
import { useOfflineStore } from '@/stores/offlineStore'

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
  const online = useOfflineStore((s) => s.online)

  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (status !== 'all') params.set('status', status)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))

  return useQuery({
    queryKey: ['mobile', 'participants', eventId, { search, status, page, pageSize }],
    queryFn: async () => {
      // Offline: tenta servir do packet local. Busca/filtro são aplicados
      // client-side pra replicar a experiência online.
      if (online === false) {
        const packet = await loadPacket(eventId)
        if (!packet) throw new Error('Sem dados offline pra este evento. Baixe em Perfil → Offline.')
        const all = packet.participants
        const s = search.toLowerCase()
        const filtered = all.filter((p) => {
          if (status === 'pending' && p.status !== 'pending') return false
          if (status === 'checked' && p.status !== 'checked') return false
          if (!s) return true
          return (
            p.name.toLowerCase().includes(s) ||
            p.participantId.toLowerCase().includes(s) ||
            p.orderNumber.toLowerCase().includes(s)
          )
        })
        return {
          participants: filtered.slice(page * pageSize, (page + 1) * pageSize),
          total: filtered.length,
          page,
          pageSize,
        } as ParticipantsResponse
      }
      return apiGet<ParticipantsResponse>(
        `/api/mobile/events/${eventId}/participants?${params.toString()}`,
      )
    },
    enabled: !!eventId,
    refetchInterval: online === false ? false : 15_000,
    refetchOnWindowFocus: online === false ? false : true,
    staleTime: 5_000,
    gcTime: 60_000,
  })
}
