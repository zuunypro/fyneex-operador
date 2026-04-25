import { useCallback, useEffect, useRef, useState } from 'react'

export interface Toast {
  id: number
  message: string
  // 'info' = ação ja processada (ex: 409 "kit já retirado") — não é falha,
  // mas também não é "eu fiz agora". Cor neutra azul/amarelo no Toast.tsx.
  type: 'success' | 'error' | 'info'
}

/**
 * Toast manager. Único toast por vez (novo substitui o antigo) e o timer de
 * auto-dismiss é cancelado no unmount para não setState num componente morto —
 * importante quando o operador troca de evento no meio do toast.
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

  const show = useCallback(
    (message: string, type: 'success' | 'error' | 'info') => {
      if (timerRef.current) clearTimeout(timerRef.current)
      seqRef.current += 1
      const id = seqRef.current
      setToast({ id, message, type })
      timerRef.current = setTimeout(() => {
        setToast((current) => (current && current.id === id ? null : current))
        timerRef.current = null
      }, durationMs)
    },
    [durationMs],
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return { toast, show, dismiss }
}
