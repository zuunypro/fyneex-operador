/**
 * Tests pra formatadores de CPF + telefone BR.
 *
 * CPF formatado errado já levou a operador NEGAR entrada de pessoa certa
 * (achando que os 5 dígitos não batiam). Telefone errado quebra link
 * "ligar pro comprador" no card. Pequenas regressões aqui são caras.
 */

import { formatCpfLast5, formatPhoneBR } from '@/utils/format'

describe('formatCpfLast5', () => {
  it('mascara 5 dígitos no formato ***.***.XXX-XX', () => {
    expect(formatCpfLast5('12345')).toBe('***.***.123-45')
    expect(formatCpfLast5('00000')).toBe('***.***.000-00')
    expect(formatCpfLast5('99999')).toBe('***.***.999-99')
  })

  it('aceita string com não-dígitos e extrai os dígitos', () => {
    expect(formatCpfLast5('12-345')).toBe('***.***.123-45')
    expect(formatCpfLast5('1 2 3 4 5')).toBe('***.***.123-45')
  })

  it('retorna em-dash pra null/undefined/vazio', () => {
    expect(formatCpfLast5(null)).toBe('—')
    expect(formatCpfLast5(undefined)).toBe('—')
    expect(formatCpfLast5('')).toBe('—')
  })

  it('retorna o input cru se não tiver exatamente 5 dígitos', () => {
    expect(formatCpfLast5('123')).toBe('123')
    expect(formatCpfLast5('123456')).toBe('123456')
    expect(formatCpfLast5('1234')).toBe('1234')
  })

  it('preserva intent: nunca expõe os 6+ primeiros dígitos do CPF', () => {
    // Garantia: input com mais de 5 dígitos NÃO é truncado pra mostrar
    // — devolve o cru pro caller decidir, não inventa formatação errada.
    const result = formatCpfLast5('12345678901')
    expect(result).not.toContain('***')
    expect(result).toBe('12345678901')
  })
})

describe('formatPhoneBR', () => {
  it('formata móvel 11 dígitos como (XX) 9XXXX-XXXX', () => {
    expect(formatPhoneBR('11999998888')).toBe('(11) 99999-8888')
    expect(formatPhoneBR('21987654321')).toBe('(21) 98765-4321')
  })

  it('formata fixo 10 dígitos como (XX) XXXX-XXXX', () => {
    expect(formatPhoneBR('1133334444')).toBe('(11) 3333-4444')
    expect(formatPhoneBR('4133221100')).toBe('(41) 3322-1100')
  })

  it('strip do código de país 55 quando presente', () => {
    expect(formatPhoneBR('5511999998888')).toBe('(11) 99999-8888')
    expect(formatPhoneBR('+5511999998888')).toBe('(11) 99999-8888')
    expect(formatPhoneBR('551133334444')).toBe('(11) 3333-4444')
  })

  it('formata local 9 dígitos sem DDD', () => {
    expect(formatPhoneBR('999998888')).toBe('99999-8888')
  })

  it('formata local 8 dígitos sem DDD', () => {
    expect(formatPhoneBR('33334444')).toBe('3333-4444')
  })

  it('aceita formato já-formatado (idempotente em prática)', () => {
    expect(formatPhoneBR('(11) 99999-8888')).toBe('(11) 99999-8888')
    expect(formatPhoneBR('(11) 9999-8888')).toBe('(11) 9999-8888')
  })

  it('aceita pontuação variada', () => {
    expect(formatPhoneBR('11.99999-8888')).toBe('(11) 99999-8888')
    expect(formatPhoneBR('11 9 9999 8888')).toBe('(11) 99999-8888')
  })

  it('retorna em-dash pra null/undefined/vazio/whitespace', () => {
    expect(formatPhoneBR(null)).toBe('—')
    expect(formatPhoneBR(undefined)).toBe('—')
    expect(formatPhoneBR('')).toBe('—')
    expect(formatPhoneBR('   ')).toBe('—')
  })

  it('devolve cru pra formato inesperado (não inventa formatação)', () => {
    // 7 dígitos não é nem fixo nem móvel — não tentamos adivinhar.
    expect(formatPhoneBR('1234567')).toBe('1234567')
    // 13 dígitos sem prefixo "55": não passa no strip, cai pra cru.
    expect(formatPhoneBR('1234567890123')).toBe('1234567890123')
  })

  it('strip 55 só quando length total é 12 ou 13 (não falsos positivos)', () => {
    // "55" no meio de um DDD não conta — só prefix com length compatível.
    expect(formatPhoneBR('5511')).toBe('5511') // 4 dígitos: cru
  })
})
