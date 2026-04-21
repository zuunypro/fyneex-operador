import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../services/api'

export interface MobileEvent {
  id: string
  name: string
  date: string
  time: string
  location: string
  image: string
  category: string
  status: string
  participantsCount: number
}

interface EventsResponse {
  events: MobileEvent[]
}

export function useEvents() {
  return useQuery({
    queryKey: ['mobile', 'events'],
    queryFn: () => apiGet<EventsResponse>('/api/mobile/events'),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  })
}
