import { useCallback, useEffect, useState } from 'react'

/**
 * Holds the observation the operator just submitted per participant so it is
 * visible immediately in the expanded row. Persisted in sessionStorage so a
 * page refresh during the event keeps the echoes around until the backend
 * listing starts surfacing the field itself.
 *
 * Scoped per event — switching events loads a different bag.
 */

const STORAGE_PREFIX = 'fyneex_mobile_recent_obs_v1::'

function read(eventId: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + eventId)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function write(eventId: string, map: Record<string, string>) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + eventId, JSON.stringify(map))
  } catch {
    /* quota / disabled — ignore */
  }
}

export function useRecentObservations(eventId: string) {
  const [map, setMap] = useState<Record<string, string>>(() => read(eventId))

  useEffect(() => {
    setMap(read(eventId))
  }, [eventId])

  useEffect(() => {
    write(eventId, map)
  }, [eventId, map])

  const set = useCallback((id: string, text: string) => {
    setMap((prev) => (prev[id] === text ? prev : { ...prev, [id]: text }))
  }, [])

  const remove = useCallback((id: string) => {
    setMap((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  return { map, set, remove }
}
