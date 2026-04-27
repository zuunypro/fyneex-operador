/**
 * Tests de regressão: cada bloco aqui blinda contra um bug REAL que já
 * aconteceu no celular em produção/staging. Se algum desses voltar, a suite
 * quebra antes do APK virar release.
 *
 * Convenção: cada `describe` documenta o bug original (o quê falhou + onde).
 * Mantidos juntos pra revisar de uma vez antes de subir build.
 */

import { matchParticipant, buildSearchIndex } from '@/utils/participants'
import { buildKitItems, type StockInfo } from '@/utils/kitItems'
import { formatCpfLast5, formatPhoneBR } from '@/utils/format'
import { friendlyError } from '@/utils/errorMessages'
import { ApiError } from '@/services/api'
import { formatBytes } from '@/services/storage'
import { formatEventDateTime } from '@/services/formatters'
import { normalizeForSearch } from '@/utils/text'
import type { MobileParticipant } from '@/hooks/useParticipants'

const mkP = (o: Partial<MobileParticipant>): MobileParticipant => ({
  id: o.id ?? 'x', participantId: 'pid', name: 'X', email: '', initials: 'X',
  ticketName: 'T', category: 'C', batch: null, status: 'pending',
  checkedInAt: null, orderNumber: '', ...o,
} as MobileParticipant)

describe('REG-001 — busca acentuada (joão != joao quebrava no portão)', () => {
  it('matchParticipant sem acento ainda casa', () => {
    expect(matchParticipant(mkP({ name: 'João Silva' }), 'joao')).toBe(true)
  })
  it('normalize é idempotente (joao + acento eliminado)', () => {
    expect(normalizeForSearch('João')).toBe(normalizeForSearch('joao'))
    expect(normalizeForSearch('JOÃO')).toBe(normalizeForSearch('JOAO'))
  })
})

describe('REG-002 — packet legacy: name/buyerName=null crashava .toLowerCase()', () => {
  it('match não throw com name null', () => {
    expect(() => matchParticipant(mkP({ name: null as unknown as string }), 'foo')).not.toThrow()
  })
  it('buildSearchIndex não throw com instanceFields=undefined', () => {
    expect(() => buildSearchIndex([mkP({ instanceFields: undefined })])).not.toThrow()
  })
  it('match não vaza "null"/"undefined" literais', () => {
    const idx = buildSearchIndex([mkP({ id: 'p1', buyerName: undefined, orderNumber: '' })])
    expect(idx.get('p1')!).not.toContain('null')
    expect(idx.get('p1')!).not.toContain('undefined')
  })
})

describe('REG-003 — Garrafa sumia: estoque cadastrado, form vazio', () => {
  it('item de variante única do estoque sempre aparece no kit', () => {
    const stockMap = new Map<string, StockInfo>([
      ['geral - garrafa', { currentStock: 10, reservedStock: 0, status: 'ok' }],
    ])
    const items = buildKitItems(
      { ticketName: 'Geral', instanceFields: [] },
      stockMap,
    )
    expect(items.find(i => i.label === 'Garrafa')).toBeTruthy()
  })
})

describe('REG-004 — CPF formatado expunha 6+ primeiros dígitos', () => {
  it('formatCpfLast5 nunca deve mascarar input com >5 dígitos como se fosse 5', () => {
    expect(formatCpfLast5('12345678901')).not.toMatch(/^\*\*\*\.\*\*\*/)
    expect(formatCpfLast5('12345678901')).toBe('12345678901')
  })
})

describe('REG-005 — Telefone com +55 vinha sem strip', () => {
  it('+5511... → (11) ...', () => {
    expect(formatPhoneBR('+5511999998888')).toBe('(11) 99999-8888')
    expect(formatPhoneBR('5511999998888')).toBe('(11) 99999-8888')
  })
})

describe('REG-006 — 429 sem Retry-After mostrava "Erro 429"', () => {
  it('mensagem PT-BR amigável mesmo sem header', () => {
    const err = new ApiError('', 429)
    expect(friendlyError(err)).toMatch(/Muitas tentativas/i)
  })
  it('com Retry-After mostra os segundos', () => {
    const err = new ApiError('', 429, undefined, 30)
    expect(friendlyError(err)).toMatch(/30/)
  })
})

describe('REG-007 — formatBytes(NaN) retornava "NaN B"', () => {
  it('NaN/Infinity/negativo → em-dash', () => {
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatBytes(-100)).toBe('—')
  })
})

describe('REG-008 — events.date timestamptz: formato ISO completo virava "—"', () => {
  it('ISO com T e Z é parseado', () => {
    const out = formatEventDateTime('2026-04-25T03:00:00.000Z', '14:30')
    expect(out.date).not.toBe('—')
    expect(out.time).toBe('14:30')
  })
})

describe('REG-009 — dropdown de erro com HTML do gateway vazava pro operador', () => {
  // Documentação: a defesa real está em api.ts handleResponse — quando JSON
  // parse falha, retorna mensagem genérica. Aqui só validamos o comportamento
  // do friendlyError quando recebe ApiError com status alto.
  it('5xx retorna mensagem amigável (não message do servidor)', () => {
    const err = new ApiError('<html>500 Internal Server Error</html>', 500)
    const msg = friendlyError(err)
    expect(msg).not.toContain('<html>')
    expect(msg).toMatch(/instável|instavel/i)
  })
})

describe('REG-010 — categorias custom (Boné, Mochila) não cabiam em hardcoded list', () => {
  it('buildKitItems aceita label arbitrário do estoque (sem keyword fixa)', () => {
    const stockMap = new Map<string, StockInfo>([
      ['vip - boné', { currentStock: 5, reservedStock: 0, status: 'ok' }],
      ['vip - mochila', { currentStock: 3, reservedStock: 0, status: 'ok' }],
    ])
    const items = buildKitItems(
      { ticketName: 'VIP', instanceFields: [] },
      stockMap,
    )
    expect(items.map(i => i.label.toLowerCase()).sort()).toEqual(
      expect.arrayContaining(['boné', 'mochila']),
    )
  })
})

describe('REG-011 — busca por CPF de 1 dígito retornava todos (false positive)', () => {
  it('search digits < 3 NÃO ativa match por buyerCpfLast5', () => {
    const p = mkP({ buyerCpfLast5: '12345', name: 'Outro Nome' })
    expect(matchParticipant(p, '1')).toBe(false)
    expect(matchParticipant(p, '12')).toBe(false)
  })
  it('search digits >= 3 ativa', () => {
    const p = mkP({ buyerCpfLast5: '12345', name: 'Outro' })
    expect(matchParticipant(p, '123')).toBe(true)
  })
})

describe('REG-012 — multi-ticket espalhado no portão (operador entregava 1/5)', () => {
  it('groupByOrder mantém tickets do mesmo pedido juntos', () => {
    const { groupByOrder } = require('@/utils/participants') as typeof import('@/utils/participants')
    const a = mkP({ id: 'a', orderNumber: 'ORD-1' })
    const b = mkP({ id: 'b', orderNumber: 'ORD-2' })
    const c = mkP({ id: 'c', orderNumber: 'ORD-1' })
    const out = groupByOrder([a, b, c])
    // A e C (ORD-1) devem ficar adjacentes
    const aIdx = out.items.findIndex(p => p.id === 'a')
    const cIdx = out.items.findIndex(p => p.id === 'c')
    expect(Math.abs(aIdx - cIdx)).toBe(1)
  })
})

describe('REG-013 — token órfão sobrevivia ao logout (vazava sessão)', () => {
  it('loadUserFromStorage limpa SecureStore quando AsyncStorage não tem user', async () => {
    const ss = require('expo-secure-store') as {
      __reset: () => void
      setItemAsync: (k: string, v: string) => Promise<void>
      getItemAsync: (k: string) => Promise<string | null>
    }
    const as = require('@react-native-async-storage/async-storage') as {
      default: { __reset: () => void }
    }
    ss.__reset()
    as.default.__reset()

    await ss.setItemAsync('fyneex_access_hash', 'leftover')
    jest.resetModules()
    const { loadUserFromStorage } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    await loadUserFromStorage()
    expect(await ss.getItemAsync('fyneex_access_hash')).toBeNull()
  })
})

describe('REG-014 — setUser persistia o token em AsyncStorage (PII leak)', () => {
  it('o JSON em AsyncStorage NÃO contém o accessHash', async () => {
    const as = require('@react-native-async-storage/async-storage') as {
      default: {
        __reset: () => void
        getItem: (k: string) => Promise<string | null>
      }
    }
    const ss = require('expo-secure-store') as { __reset: () => void }
    as.default.__reset()
    ss.__reset()
    jest.resetModules()
    const { useUserStore } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    await useUserStore.getState().setUser({
      id: 'u1', name: 'A', email: 'a@b.com', accessHash: 'super-secret-token',
    })
    const raw = await as.default.getItem('fyneex_mobile_user')
    expect(raw).toBeTruthy()
    expect(raw).not.toContain('super-secret-token')
  })
})

describe('REG-015 — friendlyError(undefined/null) crashava com TypeError', () => {
  it('aceita unknown sem throw', () => {
    expect(() => friendlyError(undefined)).not.toThrow()
    expect(() => friendlyError(null)).not.toThrow()
    expect(() => friendlyError(123)).not.toThrow()
    expect(() => friendlyError({ shape: 'wrong' })).not.toThrow()
    expect(() => friendlyError('string raw')).not.toThrow()
  })
})

describe('REG-016 — kitItems duplicava quando label do form casava com estoque', () => {
  it('estoque + form com mesmo label → 1 entrada só', () => {
    const stockMap = new Map<string, StockInfo>([
      ['geral - camiseta', { currentStock: 10, reservedStock: 0, status: 'ok' }],
    ])
    const items = buildKitItems(
      { ticketName: 'Geral', instanceFields: [{ label: 'Camiseta', value: 'GG' }] },
      stockMap,
    )
    expect(items.filter(i => i.label.toLowerCase() === 'camiseta').length).toBe(1)
  })
})
