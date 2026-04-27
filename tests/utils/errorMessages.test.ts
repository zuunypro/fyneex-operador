/**
 * Tests pra tradução de erros do backend → mensagens PT-BR amigáveis.
 *
 * Errar a mensagem aqui = operador não sabe o que fazer e fila acumula.
 * Cobertura: códigos conhecidos (EVENT_INACTIVE etc.), códigos novos (passa
 * por status), 429 com Retry-After (mostra segundos), erros genéricos.
 */

import { friendlyError } from '@/utils/errorMessages'
import { ApiError } from '@/services/api'

describe('friendlyError', () => {
  it('mapeia códigos conhecidos pra texto PT-BR específico', () => {
    expect(friendlyError(new ApiError('x', 400, 'EVENT_INACTIVE'))).toMatch(/arquivado|cancelado/i)
    expect(friendlyError(new ApiError('x', 400, 'ORDER_NOT_PAID'))).toMatch(/pago/i)
    expect(friendlyError(new ApiError('x', 400, 'TICKET_TRANSFERRED'))).toMatch(/transferido/i)
    expect(friendlyError(new ApiError('x', 400, 'INSTANCE_OUT_OF_RANGE'))).toMatch(/inválido/i)
    expect(friendlyError(new ApiError('x', 400, 'CHECKIN_REQUIRED'))).toMatch(/check-in/i)
    expect(friendlyError(new ApiError('x', 400, 'KIT_NO_STOCK_CONFIGURED'))).toMatch(/estoque/i)
  })

  it('429 com retryAfter mostra os segundos exatos', () => {
    const err = new ApiError('Limite atingido', 429, undefined, 30)
    expect(friendlyError(err)).toMatch(/30/)
  })

  it('429 sem retryAfter mas com message contendo número usa a message', () => {
    // Servidor entrega "Limite atingido. Tente em 12s" — preferimos.
    const err = new ApiError('Limite atingido. Tente em 12s', 429)
    expect(friendlyError(err)).toContain('12s')
  })

  it('429 sem nada → fallback genérico', () => {
    const err = new ApiError('', 429)
    expect(friendlyError(err)).toMatch(/Muitas tentativas/i)
  })

  it('404 → "Ingresso não encontrado"', () => {
    expect(friendlyError(new ApiError('x', 404))).toMatch(/não encontrado|nao encontrado/i)
  })

  it('401 → "Sessão expirada"', () => {
    expect(friendlyError(new ApiError('x', 401))).toMatch(/expirada/i)
  })

  it('403 → "Sem permissão"', () => {
    expect(friendlyError(new ApiError('x', 403))).toMatch(/permissão|permissao/i)
  })

  it('5xx → "Servidor instável"', () => {
    expect(friendlyError(new ApiError('x', 500))).toMatch(/instável|instavel/i)
    expect(friendlyError(new ApiError('x', 502))).toMatch(/instável|instavel/i)
    expect(friendlyError(new ApiError('x', 503))).toMatch(/instável|instavel/i)
  })

  it('status 0 → "Sem conexão"', () => {
    expect(friendlyError(new ApiError('x', 0))).toMatch(/conexão|conexao/i)
  })

  it('código desconhecido com message → usa message do servidor', () => {
    const err = new ApiError('Erro custom do backend', 400, 'NOVO_CODIGO_QUALQUER')
    expect(friendlyError(err)).toBe('Erro custom do backend')
  })

  it('Error genérico → usa message', () => {
    expect(friendlyError(new Error('algo deu errado'))).toBe('algo deu errado')
  })

  it('non-Error (string, undefined, etc) → fallback', () => {
    expect(friendlyError('boom')).toBe('Erro inesperado')
    expect(friendlyError(undefined)).toBe('Erro inesperado')
    expect(friendlyError(null)).toBe('Erro inesperado')
    expect(friendlyError({ foo: 'bar' })).toBe('Erro inesperado')
  })

  it('fallback custom é respeitado', () => {
    expect(friendlyError(undefined, 'oops')).toBe('oops')
  })

  it('regressão: erro de timeout (TIMEOUT code) tem mensagem específica', () => {
    expect(friendlyError(new ApiError('x', 0, 'TIMEOUT'))).toMatch(/lenta|tente/i)
  })

  it('regressão: NETWORK_ERROR tem mensagem específica', () => {
    expect(friendlyError(new ApiError('x', 0, 'NETWORK_ERROR'))).toMatch(/conexão|conexao/i)
  })
})
