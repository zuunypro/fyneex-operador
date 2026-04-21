import { useCallback, useEffect, useRef, useState } from 'react'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

/**
 * Toast manager. Keeps a single toast at a time (newer replaces older) and
 * cancels the auto-dismiss timer on unmount so we never call setState on an
 * unmounted page — matters when the operator swaps events mid-toast.
 */
export function useToast(durationMs = 3000) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef(0)

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setToast(null)
  }, [])

  const show = useCallback((message: string, type: 'success' | 'error') => {
    if (timerRef.current) clearTimeout(timerRef.current)
    seqRef.current += 1
    const id = seqRef.current
    setToast({ id, message, type })
    timerRef.current = setTimeout(() => {
      setToast((current) => (current && current.id === id ? null : current))
      timerRef.current = null
    }, durationMs)
  }, [durationMs])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return { toast, show, dismiss }
}
