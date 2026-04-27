/**
 * Tests pra construção da lista de kit a entregar.
 *
 * Bug clássico (já resolvido em 2025/26): "Garrafa" sumia do app porque
 * só renderizávamos campos do form_responses; quando o item não tinha
 * variantes (Garrafa unitária), o cliente não preenchia nada → operador
 * esquecia de entregar. O fix iterativo enumera as categorias do estoque
 * primeiro, casando depois com instanceFields.
 */

import { buildKitItems, formatKitSummary, kitItemsToFields } from '@/utils/kitItems'
import type { StockInfo } from '@/utils/kitItems'
import type { MobileParticipant } from '@/hooks/useParticipants'

function p(opts: Partial<MobileParticipant> = {}): Pick<MobileParticipant, 'instanceFields' | 'ticketName'> {
  return {
    ticketName: opts.ticketName ?? 'Geral',
    instanceFields: opts.instanceFields,
  }
}

function stock(info: Partial<StockInfo> = {}): StockInfo {
  return {
    currentStock: 10,
    reservedStock: 0,
    status: 'ok',
    ...info,
  }
}

describe('buildKitItems', () => {
  it('caso base: estoque + form_responses casam por label', () => {
    const stockMap = new Map<string, StockInfo>([
      ['geral - camiseta', stock({ currentStock: 5 })],
    ])
    const items = buildKitItems(
      p({ ticketName: 'Geral', instanceFields: [{ label: 'Camiseta', value: 'GG' }] }),
      stockMap,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: 'Camiseta', value: 'GG' })
    expect(items[0].stock?.currentStock).toBe(5)
  })

  it('regressão "garrafa some": item de variante única do estoque aparece mesmo sem form', () => {
    const stockMap = new Map<string, StockInfo>([
      ['geral - garrafa', stock()],
      ['geral - camiseta', stock()],
    ])
    const items = buildKitItems(
      p({ ticketName: 'Geral', instanceFields: [{ label: 'Camiseta', value: 'M' }] }),
      stockMap,
    )
    const labels = items.map(i => i.label)
    expect(labels).toContain('Garrafa') // titlecase do estoque
    expect(labels).toContain('Camiseta')
    const garrafa = items.find(i => i.label === 'Garrafa')!
    expect(garrafa.value).toBe('') // sem variante
    expect(garrafa.stock).toBeTruthy()
  })

  it('items órfãos do form (categoria removida do estoque) entram via fallback', () => {
    const stockMap = new Map<string, StockInfo>() // estoque vazio
    const items = buildKitItems(
      p({ ticketName: 'Geral', instanceFields: [{ label: 'Brinde Especial', value: 'A' }] }),
      stockMap,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: 'Brinde Especial', value: 'A', stock: null })
  })

  it('filtra identidade (nome/CPF/email/etc) do fallback — não duplica em "kit"', () => {
    const stockMap = new Map<string, StockInfo>()
    const items = buildKitItems(
      p({
        ticketName: 'Geral',
        instanceFields: [
          { label: 'Nome Completo', value: 'João' },
          { label: 'CPF', value: '12345678901' },
          { label: 'Email', value: 'a@b.com' },
          { label: 'Telefone', value: '11999998888' },
          { label: 'Data Nascimento', value: '1990-01-01' },
          { label: 'Tipo Sanguíneo', value: 'O+' },
          { label: 'Alergias', value: 'Nenhuma' },
          { label: 'Camiseta', value: 'P' },
        ],
      }),
      stockMap,
    )
    const labels = items.map(i => i.label)
    expect(labels).not.toContain('Nome Completo')
    expect(labels).not.toContain('CPF')
    expect(labels).not.toContain('Email')
    expect(labels).not.toContain('Telefone')
    expect(labels).not.toContain('Data Nascimento')
    expect(labels).not.toContain('Tipo Sanguíneo')
    expect(labels).not.toContain('Alergias')
    expect(labels).toContain('Camiseta')
  })

  it('preserva o label EXATO do form quando casa com estoque (não titlecase do estoque)', () => {
    // Operador customizou label como "CAMISETA OFICIAL". Não vira "Camiseta Oficial".
    const stockMap = new Map<string, StockInfo>([
      ['geral - camiseta oficial', stock()],
    ])
    const items = buildKitItems(
      p({ ticketName: 'Geral', instanceFields: [{ label: 'CAMISETA OFICIAL', value: 'M' }] }),
      stockMap,
    )
    expect(items[0].label).toBe('CAMISETA OFICIAL')
  })

  it('ticketName vazio: pula fase 1 (estoque) e cai direto no fallback', () => {
    const stockMap = new Map<string, StockInfo>([
      ['geral - camiseta', stock()],
    ])
    const items = buildKitItems(
      p({ ticketName: '', instanceFields: [{ label: 'Brinde', value: 'X' }] }),
      stockMap,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: 'Brinde', value: 'X', stock: null })
  })

  it('sem instanceFields E sem estoque → array vazio', () => {
    expect(buildKitItems(p({ ticketName: 'Geral', instanceFields: [] }), new Map())).toEqual([])
    expect(buildKitItems(p({ ticketName: 'Geral', instanceFields: undefined }), new Map())).toEqual([])
  })

  it('case-insensitive no match ticket+label do estoque', () => {
    const stockMap = new Map<string, StockInfo>([
      ['geral - camiseta', stock({ currentStock: 7 })],
    ])
    const items = buildKitItems(
      p({ ticketName: 'GERAL', instanceFields: [{ label: 'CAMISETA', value: 'P' }] }),
      stockMap,
    )
    expect(items).toHaveLength(1)
    expect(items[0].stock?.currentStock).toBe(7)
  })

  it('não duplica item: estoque + form com mesmo label produz 1 entrada só', () => {
    const stockMap = new Map<string, StockInfo>([
      ['geral - camiseta', stock()],
    ])
    const items = buildKitItems(
      p({ ticketName: 'Geral', instanceFields: [{ label: 'Camiseta', value: 'GG' }] }),
      stockMap,
    )
    expect(items).toHaveLength(1)
  })

  it('múltiplos itens de outros tickets NÃO entram (filtra por prefixo)', () => {
    const stockMap = new Map<string, StockInfo>([
      ['geral - camiseta', stock()],
      ['vip - camiseta', stock({ currentStock: 999 })],
      ['vip - troféu', stock()],
    ])
    const items = buildKitItems(
      p({ ticketName: 'Geral', instanceFields: [{ label: 'Camiseta', value: 'M' }] }),
      stockMap,
    )
    expect(items).toHaveLength(1)
    expect(items[0].stock?.currentStock).toBe(stock().currentStock) // 10 — do "geral"
  })
})

describe('formatKitSummary', () => {
  it('concatena items com separador ·', () => {
    const items = [
      { label: 'Camiseta', value: 'GG', stock: null },
      { label: 'Medalha', value: 'Ouro', stock: null },
    ]
    expect(formatKitSummary(items)).toBe('Camiseta GG · Medalha Ouro')
  })

  it('item sem variante: só o nome (não "Garrafa —")', () => {
    const items = [
      { label: 'Camiseta', value: 'M', stock: null },
      { label: 'Garrafa', value: '', stock: null },
    ]
    expect(formatKitSummary(items)).toBe('Camiseta M · Garrafa')
  })

  it('lista vazia → null (UI esconde a linha)', () => {
    expect(formatKitSummary([])).toBeNull()
  })
})

describe('kitItemsToFields', () => {
  it('mapeia value vazio pra "Único"', () => {
    const fields = kitItemsToFields([
      { label: 'Camiseta', value: 'P', stock: null },
      { label: 'Garrafa', value: '', stock: null },
    ])
    expect(fields).toEqual([
      { label: 'Camiseta', value: 'P' },
      { label: 'Garrafa', value: 'Único' },
    ])
  })
})
