/**
 * Helpers de normalização de texto pra busca operacional.
 *
 * Operadores no portão raramente conseguem digitar acentos no teclado mobile
 * com pressa — "joão" digitado como "joao" não casava antes. `stripAccents`
 * remove diacríticos via decomposição NFD, então `'João'` e `'joao'` ficam
 * equivalentes pro `.includes()`.
 */

/**
 * Decompõe a string em NFD e remove os marcadores de acento Unicode
 * (U+0300..U+036F). 'João' → 'Joao', 'cãopípí' → 'caopipi'.
 *
 * Mantém caracteres não-acentuados intactos (números, hífen, etc.).
 */
export function stripAccents(input: string): string {
  if (!input) return ''
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Normaliza pra comparação fuzzy: lowercase + sem acentos.
 * Usado em busca de nomes/labels onde o operador pode digitar variações.
 */
export function normalizeForSearch(input: string): string {
  if (!input) return ''
  return stripAccents(input).toLowerCase()
}
