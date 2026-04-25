import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/services/api'
import { loadParticipantsPaginated } from '@/services/offline'
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
  /** Telefone do comprador, string crua (formato varia por organizador). */
  buyerPhone?: string
  /** Últimos 5 dígitos do CPF do comprador (servidor nunca envia completo). */
  buyerCpfLast5?: string
  hasKit?: boolean
  kitWithdrawnAt?: string | null
  /** true = nome veio do formulário pós-compra; false/undefined = fallback
   * pro nome do comprador (form não foi preenchido pelo participante). */
  nameFromForm?: boolean
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
    // `online` faz parte da key pra que a transição offline↔online invalide
    // o cache e force a query a re-executar com o caminho correto (API vs packet).
    queryKey: ['mobile', 'participants', eventId, { search, status, page, pageSize, online }],
    queryFn: async () => {
      // Offline: query paginada direto no SQLite. Antes carregávamos o
      // packet inteiro em RAM e filtrávamos com .filter() — não escalava
      // pra eventos de 30k. SQLite usa índice em (event_id, search_text)
      // pra busca em ms mesmo com volume grande.
      if (online === false) {
        const result = await loadParticipantsPaginated(eventId, {
          search,
          status,
          page,
          pageSize,
        })
        if (result.total === 0 && page === 0 && !search && status === 'all') {
          // Total zero numa query sem filtro = não tem packet local pra esse
          // evento. Diferencia de "filtro não casou" (que é total=0 com search).
          throw new Error('Sem dados offline pra este evento. Baixe em Perfil → Offline.')
        }
        return result as ParticipantsResponse
      }
      return apiGet<ParticipantsResponse>(
        `/api/mobile/events/${eventId}/participants?${params.toString()}`,
      )
    },
    enabled: !!eventId,
    // Refetch background a cada 45s — antes era 15s, mas o pulso do "Ao Vivo"
    // ficava agressivo demais (operador via bolinha piscando direto). Para
    // mutations consistentes em tempo real, syncNow já invalida queries logo
    // após drenar a fila offline. Eventos críticos: pull-to-refresh manual
    // sempre disponível.
    refetchInterval: online === false ? false : 45_000,
    refetchOnWindowFocus: online === false ? false : true,
    staleTime: 10_000,
    gcTime: 60_000,
  })
}
