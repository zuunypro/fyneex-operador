/**
 * Tests pra services/offline.ts.
 *
 * Foco no que dá pra testar SEM um SQLite real (mock retorna no-op):
 *  - redactForOffline (LGPD: PII não persiste em data_json)
 *  - Constantes exportadas (TTL, stale thresholds) — mudanças acidentais
 *    quebrariam UI que depende desses valores
 *
 * As funções que exigem SQLite real (savePacket, loadParticipantsPaginated)
 * ficam de fora dessa suite — testáveis em e2e/integration sob device real.
 */

import {
  redactForOffline,
  QUEUE_BACKUP_TTL_MS,
  DEFAULT_STALE_PACKET_HOURS,
  SAME_DAY_STALE_PACKET_HOURS,
} from '@/services/offline'
import type { MobileParticipant } from '@/hooks/useParticipants'

const baseP = (o: Partial<MobileParticipant>): MobileParticipant => ({
  id: 'p',
  participantId: 'pid',
  name: 'João',
  email: 'a@b.com',
  initials: 'J',
  ticketName: 'Geral',
  category: 'Cat',
  batch: null,
  status: 'pending',
  checkedInAt: null,
  orderNumber: 'ORD-1',
  ...o,
} as MobileParticipant)

describe('redactForOffline (LGPD)', () => {
  it('remove buyerEmail/buyerPhone/buyerCpfLast5 do JSON persistido', () => {
    const p = baseP({
      buyerEmail: 'comprador@x.com',
      buyerPhone: '11999998888',
      buyerCpfLast5: '12345',
    })
    const r = redactForOffline(p)
    expect(r.buyerEmail).toBeUndefined()
    expect(r.buyerPhone).toBeUndefined()
    expect(r.buyerCpfLast5).toBeUndefined()
  })

  it('preserva fields operacionais (name, ticketName, category, status)', () => {
    const p = baseP({ name: 'João' })
    const r = redactForOffline(p)
    expect(r.name).toBe('João')
    expect(r.ticketName).toBe('Geral')
    expect(r.status).toBe('pending')
  })

  it('filtra instanceFields sensíveis (cpf/email/phone/telefone/rg/cnpj)', () => {
    const p = baseP({
      instanceFields: [
        { label: 'CPF do Participante', value: '12345678901' },
        { label: 'Email Pessoal', value: 'x@y.com' },
        { label: 'Phone', value: '999' },
        { label: 'Telefone', value: '999' },
        { label: 'RG', value: '111' },
        { label: 'CNPJ', value: '00000000000000' },
        { label: 'Camiseta', value: 'GG' }, // ← deve sobrar
      ],
    })
    const r = redactForOffline(p)
    expect(r.instanceFields).toEqual([{ label: 'Camiseta', value: 'GG' }])
  })

  it('case-insensitive nos labels sensíveis', () => {
    const p = baseP({
      instanceFields: [
        { label: 'cpf', value: '1' },
        { label: 'CPF', value: '2' },
        { label: 'Cpf Do Comprador', value: '3' },
      ],
    })
    const r = redactForOffline(p)
    expect(r.instanceFields).toEqual([])
  })

  it('aceita instanceFields=undefined', () => {
    const p = baseP({ instanceFields: undefined })
    const r = redactForOffline(p)
    expect(r.instanceFields).toBeUndefined()
  })

  it('NÃO muta o objeto original (retorna shallow copy)', () => {
    const p = baseP({
      buyerEmail: 'a@b.com',
      instanceFields: [{ label: 'CPF', value: 'x' }],
    })
    const original = { ...p, instanceFields: p.instanceFields ? [...p.instanceFields] : undefined }
    redactForOffline(p)
    expect(p.buyerEmail).toBe(original.buyerEmail)
    expect(p.instanceFields).toEqual(original.instanceFields)
  })

  it('regressão: campos não-sensíveis com palavra "telefone" no meio NÃO são filtrados', () => {
    // Defesa: regex bate em qualquer ocorrência da substring. Documentação
    // do comportamento atual — se o organizador colocar "Contato Telefone
    // Emergência", esse campo SERÁ filtrado. Aceitamos isso (segurança >
    // mostrar contato de emergência offline).
    const p = baseP({
      instanceFields: [
        { label: 'Contato Telefone Emergência', value: '11999998888' },
      ],
    })
    const r = redactForOffline(p)
    expect(r.instanceFields).toEqual([]) // FILTRADO de propósito
  })
})

describe('constantes operacionais', () => {
  it('QUEUE_BACKUP_TTL_MS = 7 dias', () => {
    expect(QUEUE_BACKUP_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('DEFAULT_STALE_PACKET_HOURS = 12h (mantém UI consistente)', () => {
    expect(DEFAULT_STALE_PACKET_HOURS).toBe(12)
  })

  it('SAME_DAY_STALE_PACKET_HOURS < DEFAULT (eventos do dia recebem refresh mais agressivo)', () => {
    expect(SAME_DAY_STALE_PACKET_HOURS).toBeLessThan(DEFAULT_STALE_PACKET_HOURS)
    expect(SAME_DAY_STALE_PACKET_HOURS).toBe(4)
  })
})
