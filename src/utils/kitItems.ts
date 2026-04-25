/**
 * Constrói a lista canônica de itens do kit a entregar pro participante.
 *
 * Fonte da verdade: `inventory_items` configurados pra esse ticket
 * (`stockByCategory`, key = "ticket - label" em lowercase). O FormBuilder
 * controla o que o cliente *preenche* no checkout — Camiseta tem variantes
 * (P/M/G), então o cliente escolhe — mas Garrafa/Brinde podem ter uma
 * variante única, ficam ocultas no formulário e mesmo assim precisam
 * ser entregues. Antes só mostrávamos o que o cliente preencheu, então
 * Garrafa "sumia" do app mesmo quando o organizador cadastrou no estoque.
 *
 * Pra cada categoria do estoque, casamos o label com `instanceFields` pra
 * puxar a variante escolhida pelo cliente. Sem casamento → value vazio
 * (item de variante única). Categorias customizadas (Boné, Mochila) caem
 * aqui automaticamente — não precisa atualizar lista hardcoded de keywords.
 */
import type { InstanceField, MobileParticipant } from '@/hooks/useParticipants'

export interface StockInfo {
  currentStock: number
  reservedStock: number
  status: string
  /**
   * Breakdown por variante (P/M/G ou cor) — pra UI mostrar "P: 0, M: 3, G: 2"
   * quando o operador expande o card. Sem isso, "1 em estoque" pode esconder
   * que a variante PEDIDA tá zerada (servidor erra com KIT_NO_STOCK_CONFIGURED
   * mesmo aparecendo estoque). Vazio/undefined quando categoria tem só uma
   * variante (Garrafa, Brinde sem tamanho).
   */
  variants?: { variant: string; currentStock: number; status: string }[]
}

export interface KitItem {
  /** Label exibido — vem do form_responses se cliente preencheu, senão
   *  é title-case da categoria do estoque ("camiseta" → "Camiseta"). */
  label: string
  /** Variante escolhida pelo cliente (ex: "GG", "Ouro"). String vazia
   *  significa item de variante única (Garrafa, Brinde) — UI deve mostrar
   *  como "Único" ou ocultar a sub-linha de valor. */
  value: string
  /** Estoque cadastrado pra essa categoria. null quando o item veio só
   *  do form_responses sem entrada no estoque (ex: organizador removeu
   *  a categoria do estoque depois — operador ainda precisa ver). */
  stock: StockInfo | null
}

/** Labels que NÃO são produto — mesmo que apareçam no form_responses,
 *  não entram em "Kit a entregar" (Nome/CPF/Telefone vão pra outra seção
 *  do card, "Conferir identidade"). */
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
  'nascimento',
  'idade',
  'gênero',
  'genero',
  'sexo',
  'endereço',
  'endereco',
  'sangu',
  'alerg',
  'condi',
  'empresa',
  'clube',
  'emergência',
  'emergencia',
] as const

function isIdentityLabel(labelLower: string): boolean {
  return IDENTITY_KEYWORDS.some(kw => labelLower.includes(kw))
}

function titleCase(s: string): string {
  return s
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function buildKitItems(
  participant: Pick<MobileParticipant, 'instanceFields' | 'ticketName'>,
  stockByCategory: Map<string, StockInfo>,
): KitItem[] {
  const ticketLower = (participant.ticketName || '').toLowerCase().trim()
  const fields = participant.instanceFields || []

  // Index de fields por label normalizado pra match O(1).
  const fieldByLabel = new Map<string, InstanceField>()
  for (const f of fields) {
    const key = f.label.toLowerCase().trim()
    if (key && !fieldByLabel.has(key)) fieldByLabel.set(key, f)
  }

  const list: KitItem[] = []
  const claimedLabels = new Set<string>()

  // ❶ Enumera as categorias do estoque cadastradas pra esse ticket
  // (formato "ticket - label"). É a fonte da verdade — Garrafa sem
  // variante aparece aqui mesmo sem o cliente ter preenchido nada.
  if (ticketLower) {
    const prefix = `${ticketLower} - `
    for (const [stockKey, stock] of stockByCategory.entries()) {
      if (!stockKey.startsWith(prefix)) continue
      const labelLower = stockKey.slice(prefix.length).trim()
      if (!labelLower) continue
      const matched = fieldByLabel.get(labelLower)
      list.push({
        label: matched?.label || titleCase(labelLower),
        value: matched?.value || '',
        stock,
      })
      claimedLabels.add(labelLower)
    }
  }

  // ❷ Fallback: campos do formulário que não bateram com nenhum item
  // do estoque (ex: organizador removeu a categoria depois de orders
  // já existirem). Filtra identidade (Nome/CPF/...) — esses ficam na
  // seção separada do card.
  for (const f of fields) {
    const key = f.label.toLowerCase().trim()
    if (!key || claimedLabels.has(key)) continue
    if (isIdentityLabel(key)) continue
    list.push({ label: f.label, value: f.value, stock: null })
    claimedLabels.add(key)
  }

  return list
}

/** Linha-resumo pro card colapsado. "Camiseta GG · Garrafa · Medalha Ouro"
 *  — sem variante, mostra só o nome (não "Garrafa ?", não "Garrafa —"). */
export function formatKitSummary(items: KitItem[]): string | null {
  if (items.length === 0) return null
  return items.map(k => (k.value ? `${k.label} ${k.value}` : k.label)).join(' · ')
}

/** Adapter pro ConfirmationModal: ele renderiza `instanceFields[]` como
 *  rows label/value. Pra item sem variante, mostramos "Único" no value
 *  pra que a coluna direita não fique em branco e o operador entenda
 *  que é entrega "padrão". */
export function kitItemsToFields(items: KitItem[]): InstanceField[] {
  return items.map(k => ({
    label: k.label,
    value: k.value || 'Único',
  }))
}
