import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useState } from 'react'

/**
 * Segura a observação recém enviada por participante pra aparecer na row
 * expandida. Em web usava sessionStorage; em RN usamos AsyncStorage (persiste
 * mais tempo, mas a semântica "eco imediato" é a que importa). Escopo por
 * evento.
 */

const STORAGE_PREFIX = 'fyneex_mobile_recent_obs_v1::'

async function read(eventId: string): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + eventId)
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

async function write(eventId: string, map: Record<string, string>) {
  try {
    await AsyncStorage.setItem(STORAGE_PREFIX + eventId, JSON.stringify(map))
  } catch { /* ignore */ }
}

export function useRecentObservations(eventId: string) {
  const [map, setMap] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    read(eventId).then((loaded) => { if (alive) setMap(loaded) })
    return () => { alive = false }
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
