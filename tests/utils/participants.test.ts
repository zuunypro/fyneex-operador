/**
 * Tests pra busca/agrupamento de participantes.
 *
 * Bugs históricos cobertos aqui:
 *  - "joao" não casava com "João" (acento) → fila no portão
 *  - p.name = null crashava .toLowerCase() em packets antigos
 *  - Busca por CPF (5 dígitos) só batia em buyerCpfLast5 com >=3 dígitos
 *  - Multi-ticket do mesmo pedido renderizava espalhado (operador entregava
 *    1 kit por vez sem perceber que o comprador tinha 5)
 */

import {
  buildSearchIndex,
  groupByOrder,
  matchByIndex,
  matchParticipant,
  matchParticipantNormalized,
} from '@/utils/participants'
import type { MobileParticipant } from '@/hooks/useParticipants'

function mkP(overrides: Partial<MobileParticipant> = {}): MobileParticipant {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    participantId: overrides.participantId ?? 'pid',
    name: overrides.name ?? 'Test',
    email: overrides.email ?? 'a@b.com',
    initials: overrides.initials ?? 'T',
    ticketName: overrides.ticketName ?? 'Geral',
    category: overrides.category ?? 'Cat',
    batch: overrides.batch ?? null,
    status: overrides.status ?? 'pending',
    checkedInAt: overrides.checkedInAt ?? null,
    orderNumber: overrides.orderNumber ?? 'ORD-001',
    ...overrides,
  } as MobileParticipant
}

describe('matchParticipant', () => {
  it('match por nome com/sem acento', () => {
    const p = mkP({ name: 'João Silva' })
    expect(matchParticipant(p, 'joao')).toBe(true)
    expect(matchParticipant(p, 'João')).toBe(true)
    expect(matchParticipant(p, 'silv')).toBe(true)
  })

  it('match por buyerName', () => {
    const p = mkP({ buyerName: 'Maria Santos' })
    expect(matchParticipant(p, 'maria')).toBe(true)
    expect(matchParticipant(p, 'santos')).toBe(true)
  })

  it('match por orderNumber', () => {
    const p = mkP({ orderNumber: 'FYN-12345' })
    expect(matchParticipant(p, 'fyn-12345')).toBe(true)
    expect(matchParticipant(p, '12345')).toBe(true)
  })

  it('match por instanceFields.value', () => {
    const p = mkP({ instanceFields: [{ label: 'Camiseta', value: 'GG' }] })
    expect(matchParticipant(p, 'gg')).toBe(true)
  })

  it('match por buyerCpfLast5 só com 3+ dígitos', () => {
    const p = mkP({ buyerCpfLast5: '12345' })
    expect(matchParticipant(p, '123')).toBe(true)
    expect(matchParticipant(p, '345')).toBe(true)
    // <3 dígitos não dispara busca por CPF (evita falso positivo)
    expect(matchParticipant(p, '12')).toBe(false)
  })

  it('search vazia → match true (mostra todos)', () => {
    expect(matchParticipant(mkP(), '')).toBe(true)
  })

  it('regressão: search só com whitespace é tratado como NÃO-vazio (caller deve trimar)', () => {
    // Documentação do contrato: matchParticipant não faz trim — caller (Page)
    // já normaliza o input. Se vier '   ', vira filtro literal por whitespace
    // e tudo casa via .includes(' '). Importante: nunca crasha.
    expect(() => matchParticipant(mkP(), '   ')).not.toThrow()
  })

  it('regressão: name=null não crasha (packet legacy)', () => {
    const p = mkP({ name: null as unknown as string })
    expect(() => matchParticipant(p, 'foo')).not.toThrow()
    expect(matchParticipant(p, 'foo')).toBe(false)
  })

  it('regressão: instanceFields[].value=null não crasha', () => {
    const p = mkP({ instanceFields: [{ label: 'X', value: null as unknown as string }] })
    expect(() => matchParticipant(p, 'foo')).not.toThrow()
  })

  it('case-insensitive em todos os campos', () => {
    const p = mkP({ name: 'JOÃO', buyerName: 'maria' })
    expect(matchParticipant(p, 'joao')).toBe(true)
    expect(matchParticipant(p, 'MARIA')).toBe(true)
  })
})

describe('matchParticipantNormalized', () => {
  it('aceita query pré-normalizada', () => {
    const p = mkP({ name: 'João' })
    expect(matchParticipantNormalized(p, 'joao', '')).toBe(true)
  })

  it('s vazio → true (não filtra)', () => {
    expect(matchParticipantNormalized(mkP(), '', '')).toBe(true)
  })
})

describe('buildSearchIndex + matchByIndex (hot-path)', () => {
  it('indexa todos os campos buscáveis em 1 string normalizada', () => {
    const p = mkP({
      id: 'p1',
      name: 'João',
      buyerName: 'Maria',
      orderNumber: 'FYN-1',
      participantId: 'PID-1',
      instanceFields: [{ label: 'Camiseta', value: 'GG' }],
    })
    const idx = buildSearchIndex([p])
    const text = idx.get('p1')!
    expect(text).toContain('joao')
    expect(text).toContain('maria')
    expect(text).toContain('fyn-1')
    expect(text).toContain('pid-1')
    expect(text).toContain('gg')
  })

  it('matchByIndex usa o searchText pré-computado', () => {
    const p = mkP({ id: 'p1', name: 'João', buyerCpfLast5: '12345' })
    const idx = buildSearchIndex([p])
    const text = idx.get('p1')!
    expect(matchByIndex(p, text, 'joao', '')).toBe(true)
    expect(matchByIndex(p, text, 'xyz', '')).toBe(false)
    // CPF cai no short-circuit (não tá no índice de propósito por LGPD)
    expect(matchByIndex(p, text, '', '123')).toBe(true)
  })

  it('s vazio → match true (não filtra) mesmo sem index', () => {
    expect(matchByIndex(mkP(), '', '', '')).toBe(true)
  })

  it('regressão: index lida com instanceFields=undefined', () => {
    const p = mkP({ instanceFields: undefined })
    expect(() => buildSearchIndex([p])).not.toThrow()
  })

  it('skip de campos null/undefined no index (não vira "null" literal)', () => {
    const p = mkP({
      id: 'p1',
      name: 'A',
      buyerName: undefined,
      orderNumber: '',
      participantId: '',
    })
    const idx = buildSearchIndex([p])
    expect(idx.get('p1')!).not.toContain('null')
    expect(idx.get('p1')!).not.toContain('undefined')
  })
})

describe('groupByOrder', () => {
  it('agrupa multi-ticket do mesmo pedido contíguos', () => {
    const a = mkP({ id: 'a', orderNumber: 'ORD-1' })
    const b = mkP({ id: 'b', orderNumber: 'ORD-2' })
    const c = mkP({ id: 'c', orderNumber: 'ORD-1' })
    const d = mkP({ id: 'd', orderNumber: 'ORD-1' })
    const out = groupByOrder([a, b, c, d])
    // a, c, d (do ORD-1) ficam juntos antes do b (ORD-2)
    expect(out.items.map(p => p.id)).toEqual(['a', 'c', 'd', 'b'])
  })

  it('grupos com 1 ticket NÃO recebem groupInfo (lista limpa)', () => {
    const a = mkP({ id: 'a', orderNumber: 'ORD-1' })
    const b = mkP({ id: 'b', orderNumber: 'ORD-2' })
    const out = groupByOrder([a, b])
    expect(out.groupOf.has('a')).toBe(false)
    expect(out.groupOf.has('b')).toBe(false)
  })

  it('grupo de 3 marca pos 1/3, 2/3, 3/3 com first/last', () => {
    const a = mkP({ id: 'a', orderNumber: 'ORD-1' })
    const b = mkP({ id: 'b', orderNumber: 'ORD-1' })
    const c = mkP({ id: 'c', orderNumber: 'ORD-1' })
    const out = groupByOrder([a, b, c])
    expect(out.groupOf.get('a')).toMatchObject({ pos: 1, total: 3, first: true, last: false })
    expect(out.groupOf.get('b')).toMatchObject({ pos: 2, total: 3, first: false, last: false })
    expect(out.groupOf.get('c')).toMatchObject({ pos: 3, total: 3, first: false, last: true })
  })

  it('mesmo orderNumber → mesma cor (determinismo via hash)', () => {
    const a = mkP({ id: 'a', orderNumber: 'ORD-X' })
    const b = mkP({ id: 'b', orderNumber: 'ORD-X' })
    const out = groupByOrder([a, b])
    expect(out.groupOf.get('a')!.color).toBe(out.groupOf.get('b')!.color)
  })

  it('orderNumber vazio/null vai pro bucket "loose" no fim', () => {
    const a = mkP({ id: 'a', orderNumber: '' })
    const b = mkP({ id: 'b', orderNumber: 'ORD-1' })
    const out = groupByOrder([a, b])
    expect(out.items[out.items.length - 1].id).toBe('a')
  })

  it('lista vazia → resultado vazio sem crash', () => {
    const out = groupByOrder([])
    expect(out.items).toEqual([])
    expect(out.groupOf.size).toBe(0)
  })

  it('preserva ordem de chegada do primeiro encontro de cada grupo', () => {
    // ORD-2 aparece primeiro → seu bucket vem antes do ORD-1.
    const x = mkP({ id: 'x', orderNumber: 'ORD-2' })
    const y = mkP({ id: 'y', orderNumber: 'ORD-1' })
    const z = mkP({ id: 'z', orderNumber: 'ORD-2' })
    const out = groupByOrder([x, y, z])
    expect(out.items.map(p => p.id)).toEqual(['x', 'z', 'y'])
  })
})
