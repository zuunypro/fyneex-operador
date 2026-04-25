import { useEffect, useState } from 'react'

/**
 * Retorna `value` defasado em `delay` ms. Cancela atualizações pendentes
 * se `value` muda antes do timeout vencer (mantém só o "último estável").
 *
 * Uso típico: input de busca onde cada keystroke não deve disparar
 * fetch/SQL imediato. Em listas de 30k+ participantes, sem debounce o
 * `LIKE %term%` rodava a cada letra, gerando lag perceptível na digitação.
 *
 * Não usa lodash pra economizar bundle — basta setTimeout com cleanup.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value)
      return
    }
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])

  return debounced
}
