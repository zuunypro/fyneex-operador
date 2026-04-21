import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Persiste localmente quais rows o operador marcou como "kit entregue" durante
 * a sessão no device. AsyncStorage é async, então o Set inicial é vazio e a
 * hidratação acontece no primeiro effect. Keyed por eventId.
 */

const STORAGE_PREFIX = 'fyneex_mobile_delivered_v1::'

async function readStorage(eventId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + eventId)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

async function writeStorage(eventId: string, ids: Set<string>) {
  try {
    await AsyncStorage.setItem(
      STORAGE_PREFIX + eventId,
      JSON.stringify(Array.from(ids)),
    )
  } catch { /* ignore */ }
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
  const [ids, setIds] = useState<Set<string>>(new Set())

  // Hidrata quando eventId muda.
  useEffect(() => {
    let alive = true
    readStorage(eventId).then((loaded) => {
      if (alive) setIds(loaded)
    })
    return () => { alive = false }
  }, [eventId])

  // Persiste a cada mudança.
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
