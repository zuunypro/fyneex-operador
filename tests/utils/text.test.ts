/**
 * Tests pra normalização de texto. A regressão clássica aqui é busca por
 * "joao" deixar de casar com "João" — operador no portão raramente digita
 * acento, então isso vira "participante não encontrado" → fila.
 */

import { stripAccents, normalizeForSearch } from '@/utils/text'

describe('stripAccents', () => {
  it('remove acentos comuns do PT-BR', () => {
    expect(stripAccents('João')).toBe('Joao')
    expect(stripAccents('coração')).toBe('coracao')
    expect(stripAccents('São Paulo')).toBe('Sao Paulo')
    expect(stripAccents('açaí')).toBe('acai')
    expect(stripAccents('cafézinho')).toBe('cafezinho')
  })

  it('preserva caracteres não-acentuados', () => {
    expect(stripAccents('abc123')).toBe('abc123')
    expect(stripAccents('foo-bar_baz')).toBe('foo-bar_baz')
    expect(stripAccents('email@host.com')).toBe('email@host.com')
  })

  it('retorna string vazia pra entrada vazia', () => {
    expect(stripAccents('')).toBe('')
  })

  it('aceita null/undefined sem crashar (defensive)', () => {
    expect(stripAccents(null as unknown as string)).toBe('')
    expect(stripAccents(undefined as unknown as string)).toBe('')
  })

  it('lida com múltiplos acentos na mesma palavra', () => {
    expect(stripAccents('João José Pão')).toBe('Joao Jose Pao')
  })

  it('preserva ç → c (cedilha é tratado pela decomposição NFD)', () => {
    expect(stripAccents('ção')).toBe('cao')
    expect(stripAccents('ÇOMBO')).toBe('COMBO')
  })

  it('preserva emoji e chars não-latinos', () => {
    expect(stripAccents('🏃 corrida')).toBe('🏃 corrida')
  })
})

describe('normalizeForSearch', () => {
  it('lowercase + sem acentos', () => {
    expect(normalizeForSearch('João')).toBe('joao')
    expect(normalizeForSearch('SÃO PAULO')).toBe('sao paulo')
  })

  it('"joao" e "João" colidem (a chave do hardening)', () => {
    expect(normalizeForSearch('joao')).toBe(normalizeForSearch('João'))
    expect(normalizeForSearch('JOAO')).toBe(normalizeForSearch('joão'))
  })

  it('vazio in → vazio out', () => {
    expect(normalizeForSearch('')).toBe('')
  })

  it('null/undefined defensivo', () => {
    expect(normalizeForSearch(null as unknown as string)).toBe('')
    expect(normalizeForSearch(undefined as unknown as string)).toBe('')
  })
})
