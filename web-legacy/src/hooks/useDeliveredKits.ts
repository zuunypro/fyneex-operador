import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Persists which participant rows the operator has marked as "kit delivered"
 * during this device's session. Backend currently does not expose a
 * `kitWithdrawnAt` field on the participants listing, so without this hook a
 * page refresh would erase the visual state and the operator would only learn
 * a kit was already delivered by retrying and getting a 409.
 *
 * Keyed per event so two events open in different tabs don't share state.
 */

const STORAGE_PREFIX = 'fyneex_mobile_delivered_v1::'

function readStorage(eventId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + eventId)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

function writeStorage(eventId: string, ids: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + eventId,
      JSON.stringify(Array.from(ids)),
    )
  } catch {
    /* quota / private mode — ignore */
  }
}

export interface DeliveredKitsApi {
  ids: Set<string>
  has: (id: string) => boolean
  add: (id: string) => void
  remove: (id: string) => void
  /** Drop entries that are no longer present in the freshly fetched list. */
  pruneTo: (presentIds: Iterable<string>) => void
}

export function useDeliveredKits(eventId: string): DeliveredKitsApi {
  const [ids, setIds] = useState<Set<string>>(() => readStorage(eventId))

  // Re-hydrate when switching events.
  useEffect(() => {
    setIds(readStorage(eventId))
  }, [eventId])

  // Persist whenever ids change.
  useEffect(() => {
    writeStorage(eventId, ids)
  }, [eventId, ids])

  const has = useCallback((id: string) => ids.has(id), [ids])

  const add = useCallback((id: string) => {
    setIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const pruneTo = useCallback((presentIds: Iterable<string>) => {
    const present = new Set(presentIds)
    setIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (present.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [])

  return useMemo(() => ({ ids, has, add, remove, pruneTo }), [ids, has, add, remove, pruneTo])
}
