/**
 * Classifica os campos de `instanceFields` (form_responses do pedido)
 * em 3 categorias úteis pra UI do operador:
 *
 *   - kit: produtos físicos a entregar (Camiseta, Medalha, Garrafa,
 *          Troféu, Brinde, ou variantes como "Tamanho", "Cor"). Vão
 *          pra seção destacada do StockPage com badge de estoque.
 *   - identity: campos de identidade do participante (Nome, Email,
 *               Telefone, CPF, RG). Já são exibidos no header do card
 *               + na seção "Conferir identidade" — não duplicar.
 *   - other: demais campos do formulário (data nascimento, gênero,
 *            tipo sanguíneo, contato emergência, etc.). Aparecem
 *            na seção "Dados do participante".
 *
 * Mantido em sync com `PRODUCT_FIELD_DEFAULT_NAME` e
 * `FRIENDLY_FIELD_LABEL` no servidor (`productFieldConstants.ts`)
 * — qualquer label novo precisa entrar aqui pra ser categorizado.
 */

const KIT_KEYWORDS = [
  'camiseta',
  'camisa',
  'medalha',
  'garrafa',
  'troféu',
  'trofeu',
  'brinde',
  'kit',
  'tamanho',
  'cor',
  'modelo',
  'variante',
] as const

const IDENTITY_KEYWORDS = [
  'nome',
  'name',
  'email',
  'e-mail',
  'telefone',
  'phone',
  'celular',
  'cpf',
  'rg',
  'documento',
] as const

export function isKitFieldLabel(label: string): boolean {
  if (!label) return false
  const l = label.toLowerCase()
  return KIT_KEYWORDS.some((k) => l.includes(k))
}

export function isIdentityFieldLabel(label: string): boolean {
  if (!label) return false
  const l = label.toLowerCase()
  return IDENTITY_KEYWORDS.some((k) => l.includes(k))
}

/** Particiona um array de campos em kit / identity / other em 1 passada. */
export function classifyFields<T extends { label: string }>(
  fields: readonly T[],
): { kit: T[]; identity: T[]; other: T[] } {
  const kit: T[] = []
  const identity: T[] = []
  const other: T[] = []
  for (const f of fields) {
    if (isKitFieldLabel(f.label)) kit.push(f)
    else if (isIdentityFieldLabel(f.label)) identity.push(f)
    else other.push(f)
  }
  return { kit, identity, other }
}
