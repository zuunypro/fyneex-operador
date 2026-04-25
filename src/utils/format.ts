/**
 * Formatadores pra exibir CPF (últimos 5) e telefone BR no portão.
 *
 * `buyerCpfLast5` chega como string crua de 5 dígitos (ex.: "12345"). O
 * CPF completo é `XXX.XXX.XXX-XX` — os últimos 5 dígitos cobrem o final
 * do terceiro grupo + os 2 verificadores. Renderizar como
 * `***.***.123-45` deixa o operador conferir contra o documento sem
 * expor o CPF inteiro.
 *
 * Telefone vem cru do `clients.phone` (formatação varia por
 * organizador). Aceitamos `5511999998888`, `+5511999998888`,
 * `11999998888` e `(11) 99999-8888`. Normalizamos pra
 * `(11) 99999-8888` (móvel 11d) ou `(11) 9999-8888` (fixo 10d). Se o
 * número tiver formato inesperado, retornamos como veio.
 */

export function formatCpfLast5(last5: string | null | undefined): string {
  if (!last5) return '—'
  const digits = last5.replace(/\D/g, '')
  if (digits.length !== 5) return last5
  return `***.***.${digits.slice(0, 3)}-${digits.slice(3)}`
}

export function formatPhoneBR(phone: string | null | undefined): string {
  if (!phone) return '—'
  const trimmed = phone.trim()
  if (!trimmed) return '—'
  let digits = trimmed.replace(/\D/g, '')
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2)
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`
  }
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`
  }
  return trimmed
}
