/**
 * Tests pra formatEventDateTime — converte ISO/BR + HH:mm pra display.
 *
 * Bug histórico (memória `events_date_is_timestamptz.md`): a coluna events.date
 * no Postgres é timestamptz, mas o app mobile recebe string ISO. Já vimos
 * formato "2026-04-25T03:00:00.000Z" virar "—" (não bateu nos regexes
 * antigos). Os testes garantem que ISO completo, ISO date-only, BR e formatos
 * vazios sejam todos manejados.
 */

import { formatEventDateTime } from '@/services/formatters'

describe('formatEventDateTime', () => {
  it('ISO date-only "YYYY-MM-DD"', () => {
    const out = formatEventDateTime('2026-04-25', '14:30')
    expect(out.date).toMatch(/25/)
    expect(out.date).toMatch(/abr/i)
    expect(out.date).toMatch(/2026/)
    expect(out.time).toBe('14:30')
  })

  it('ISO completo com T e Z', () => {
    const out = formatEventDateTime('2026-04-25T03:00:00.000Z', '14:30')
    expect(out.date).toMatch(/abr|mai/i) // depende do TZ do runner; mas tem que parsear
    expect(out.time).toBe('14:30')
  })

  it('formato BR "DD/MM/YYYY"', () => {
    const out = formatEventDateTime('25/04/2026', '09:00')
    expect(out.date).toMatch(/25/)
    expect(out.date).toMatch(/abr/i)
    expect(out.time).toBe('09:00')
  })

  it('time HH:mm:ss → trunca pra HH:mm', () => {
    const out = formatEventDateTime('2026-04-25', '14:30:45')
    expect(out.time).toBe('14:30')
  })

  it('time com 1 dígito na hora ("9:00") → padStart pra "09:00"', () => {
    const out = formatEventDateTime('2026-04-25', '9:00')
    expect(out.time).toBe('09:00')
  })

  it('date null → em-dash, time vazio', () => {
    expect(formatEventDateTime(null, '14:00')).toEqual({ date: '—', time: '' })
    expect(formatEventDateTime(undefined, undefined)).toEqual({ date: '—', time: '' })
    expect(formatEventDateTime('', null)).toEqual({ date: '—', time: '' })
  })

  it('date inválida (não bate nem ISO nem BR) → devolve cru', () => {
    const out = formatEventDateTime('amanhã', '10:00')
    expect(out.date).toBe('amanhã')
    expect(out.time).toBe('10:00')
  })

  it('time vazio mas date OK → time vazio sem crash', () => {
    const out = formatEventDateTime('2026-04-25', '')
    expect(out.time).toBe('')
  })

  it('time inválido → time vazio (não inventa)', () => {
    const out = formatEventDateTime('2026-04-25', 'abacaxi')
    expect(out.time).toBe('')
  })

  it('regressão: NÃO termina com ponto ("abr.")', () => {
    const out = formatEventDateTime('2026-04-25', '14:00')
    expect(out.date).not.toContain('.')
  })
})
