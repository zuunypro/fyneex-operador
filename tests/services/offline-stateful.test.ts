/**
 * Tests stateful pra offline.ts usando o SQLite em memória de
 * `__mocks__/sqliteMemory.ts`. Exercita ciclos completos:
 *  - savePacket → loadPacket roundtrip (com participants + inventory)
 *  - download interrompido (download_complete=0) → loadPacket retorna null
 *  - enqueue + queue cap (5000)
 *  - paginated load com filters (search/status)
 *  - patchParticipantInPacket atualiza search_text + denormalizados
 *  - removePacket cascateia em participants
 *  - savePacket NÃO persiste PII em data_json (LGPD)
 */

import { createMemoryDb, fakeDatabase, type MemoryDb } from '../__mocks__/sqliteMemory'
import type { MobileParticipant } from '@/hooks/useParticipants'

const mkP = (o: Partial<MobileParticipant>): MobileParticipant => ({
  id: o.id ?? 'p',
  participantId: o.participantId ?? 'pid',
  name: 'Test',
  email: 'a@b.com',
  initials: 'T',
  ticketName: 'Geral',
  category: 'Cat',
  batch: null,
  status: 'pending',
  checkedInAt: null,
  orderNumber: 'ORD-1',
  ...o,
} as MobileParticipant)

async function withDb(fn: (mem: MemoryDb, mod: typeof import('@/services/offline')) => Promise<void>): Promise<void> {
  const mem = createMemoryDb()
  const fake = fakeDatabase(mem)
  await jest.isolateModulesAsync(async () => {
    jest.doMock('expo-sqlite', () => ({
      __esModule: true,
      openDatabaseAsync: jest.fn(async () => fake),
    }))
    const mod = require('@/services/offline') as typeof import('@/services/offline')
    await fn(mem, mod)
  })
}

describe('offline.ts — savePacket / loadPacket roundtrip', () => {
  it('persiste packet e recarrega com mesmos participants + inventory', async () => {
    await withDb(async (_mem, { savePacket, loadPacket }) => {
      await savePacket({
        eventId: 'e1',
        downloadedAt: '2026-04-26T00:00:00.000Z',
        participants: [
          mkP({ id: 'p1', participantId: 'PID-1', name: 'João Silva' }),
          mkP({ id: 'p2', participantId: 'PID-2', name: 'Maria Santos', status: 'checked' }),
        ],
        inventory: { items: [{ id: 'i1', label: 'Camiseta' } as never], stats: { totalDelivered: 1 } as never },
      })

      const loaded = await loadPacket('e1')
      expect(loaded).toBeTruthy()
      expect(loaded!.participants).toHaveLength(2)
      expect(loaded!.participants[0].name).toBe('João Silva')
      expect(loaded!.participants[1].status).toBe('checked')
      expect(loaded!.inventory.items).toHaveLength(1)
      expect(loaded!.inventory.stats).toMatchObject({ totalDelivered: 1 })
    })
  })

  it('packet não-encontrado → null', async () => {
    await withDb(async (_mem, { loadPacket }) => {
      expect(await loadPacket('noexist')).toBeNull()
    })
  })

  it('regressão: packet com download_complete=0 (crash mid-save) → null', async () => {
    await withDb(async (mem, { loadPacket }) => {
      // Insere packet diretamente no estado com download_complete=0
      mem.packets.set('e1', {
        event_id: 'e1',
        downloaded_at: '2026-04-26T00:00:00.000Z',
        inventory_json: '[]',
        stats_json: null,
        participant_count: 0,
        item_count: 0,
        download_complete: 0,
      })
      expect(await loadPacket('e1')).toBeNull()
    })
  })

  it('LGPD: data_json em SQLite NÃO contém buyerEmail/buyerPhone/buyerCpfLast5', async () => {
    await withDb(async (mem, { savePacket }) => {
      await savePacket({
        eventId: 'e1',
        downloadedAt: '2026-04-26T00:00:00.000Z',
        participants: [
          mkP({
            id: 'p1',
            buyerEmail: 'comprador@email.com',
            buyerPhone: '11999998888',
            buyerCpfLast5: '12345',
            instanceFields: [
              { label: 'Camiseta', value: 'GG' },
              { label: 'CPF', value: '12345678901' },
            ],
          }),
        ],
        inventory: { items: [] },
      })
      // Inspect raw JSON
      const json = mem.participants[0].data_json
      expect(json).not.toContain('comprador@email.com')
      expect(json).not.toContain('11999998888')
      expect(json).not.toContain('12345678901') // CPF completo do form
      // Mas search_text DEVE conter buyerCpfLast5 pra busca ainda funcionar
      expect(mem.participants[0].search_text).toContain('12345')
      // E o campo Camiseta SOBREVIVE no JSON
      expect(json).toContain('Camiseta')
      expect(json).toContain('GG')
    })
  })

  it('search_text é normalizado (lowercase + sem acento)', async () => {
    await withDb(async (mem, { savePacket }) => {
      await savePacket({
        eventId: 'e1',
        downloadedAt: '2026-04-26T00:00:00.000Z',
        participants: [mkP({ id: 'p1', name: 'João Pão', orderNumber: 'ORD-Acentüatô' })],
        inventory: { items: [] },
      })
      const text = mem.participants[0].search_text
      expect(text).toContain('joao')
      expect(text).toContain('pao')
      expect(text).not.toContain('João') // não pode ter acento
      expect(text).toBe(text.toLowerCase())
    })
  })

  it('re-savePacket substitui completamente o anterior (não acumula)', async () => {
    await withDb(async (_mem, { savePacket, loadPacket }) => {
      await savePacket({
        eventId: 'e1', downloadedAt: 't1',
        participants: [mkP({ id: 'p1' }), mkP({ id: 'p2' })],
        inventory: { items: [] },
      })
      await savePacket({
        eventId: 'e1', downloadedAt: 't2',
        participants: [mkP({ id: 'p3' })],
        inventory: { items: [] },
      })
      const loaded = await loadPacket('e1')
      expect(loaded!.participants).toHaveLength(1)
      expect(loaded!.participants[0].id).toBe('p3')
    })
  })
})

describe('offline.ts — loadParticipantsPaginated', () => {
  it('paginação básica: page 0 + pageSize 1', async () => {
    await withDb(async (_mem, { savePacket, loadParticipantsPaginated }) => {
      await savePacket({
        eventId: 'e1', downloadedAt: 't',
        participants: [
          mkP({ id: 'a', name: 'Ana' }),
          mkP({ id: 'b', name: 'Bia' }),
          mkP({ id: 'c', name: 'Cíntia' }),
        ],
        inventory: { items: [] },
      })
      const r1 = await loadParticipantsPaginated('e1', { page: 0, pageSize: 1 })
      expect(r1.total).toBe(3)
      expect(r1.participants).toHaveLength(1)
      expect(r1.participants[0].name).toBe('Ana')

      const r2 = await loadParticipantsPaginated('e1', { page: 2, pageSize: 1 })
      expect(r2.participants[0].name).toBe('Cíntia')
    })
  })

  it('search filtra com normalização (joao → João)', async () => {
    await withDb(async (_mem, { savePacket, loadParticipantsPaginated }) => {
      await savePacket({
        eventId: 'e1', downloadedAt: 't',
        participants: [
          mkP({ id: 'a', name: 'João Silva' }),
          mkP({ id: 'b', name: 'Maria' }),
        ],
        inventory: { items: [] },
      })
      const r = await loadParticipantsPaginated('e1', { search: 'joao' })
      expect(r.total).toBe(1)
      expect(r.participants[0].name).toBe('João Silva')
    })
  })

  it('status filter pending/checked', async () => {
    await withDb(async (_mem, { savePacket, loadParticipantsPaginated }) => {
      await savePacket({
        eventId: 'e1', downloadedAt: 't',
        participants: [
          mkP({ id: 'a', name: 'A', status: 'pending' }),
          mkP({ id: 'b', name: 'B', status: 'checked' }),
          mkP({ id: 'c', name: 'C', status: 'pending' }),
        ],
        inventory: { items: [] },
      })
      const pending = await loadParticipantsPaginated('e1', { status: 'pending' })
      expect(pending.total).toBe(2)
      const checked = await loadParticipantsPaginated('e1', { status: 'checked' })
      expect(checked.total).toBe(1)
      const all = await loadParticipantsPaginated('e1', { status: 'all' })
      expect(all.total).toBe(3)
    })
  })

  it('pageSize tem cap 500 e mínimo 1', async () => {
    await withDb(async (_mem, { savePacket, loadParticipantsPaginated }) => {
      await savePacket({
        eventId: 'e1', downloadedAt: 't',
        participants: Array.from({ length: 600 }, (_, i) => mkP({ id: `p${i}`, name: `n${i}` })),
        inventory: { items: [] },
      })
      const r1 = await loadParticipantsPaginated('e1', { pageSize: 9999 })
      expect(r1.pageSize).toBe(500)
      const r2 = await loadParticipantsPaginated('e1', { pageSize: 0 })
      expect(r2.pageSize).toBe(1)
    })
  })
})

describe('offline.ts — enqueue + queue cap', () => {
  it('enqueue adiciona com status=pending, attempts=0, id único', async () => {
    await withDb(async (_mem, { enqueue, loadQueue }) => {
      const a = await enqueue({ type: 'checkin', eventId: 'e1', participantId: 'p1' })
      expect(a.status).toBe('pending')
      expect(a.attempts).toBe(0)
      expect(a.id).toBeTruthy()
      const queue = await loadQueue()
      expect(queue).toHaveLength(1)
      expect(queue[0].id).toBe(a.id)
    })
  })

  it('enqueue persiste extras (observation, allowNoStock, allowNoStockReason)', async () => {
    await withDb(async (_mem, { enqueue, loadQueue }) => {
      await enqueue({
        type: 'withdrawal', eventId: 'e1', participantId: 'p1',
        observation: 'troca de tamanho',
        allowNoStock: true,
        allowNoStockReason: 'liberado pelo organizador',
      })
      const [a] = await loadQueue()
      expect(a.observation).toBe('troca de tamanho')
      expect(a.allowNoStock).toBe(true)
      expect(a.allowNoStockReason).toBe('liberado pelo organizador')
    })
  })

  it('IDs são únicos em enqueues sequenciais', async () => {
    await withDb(async (_mem, { enqueue }) => {
      const ids = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const a = await enqueue({ type: 'checkin', eventId: 'e1', participantId: `p${i}` })
        ids.add(a.id)
      }
      expect(ids.size).toBe(50)
    })
  })

  it('enqueue throw em QUEUE_HARD_CAP (5000)', async () => {
    await withDb(async (mem, { enqueue }) => {
      // Pre-popula direto no state pra evitar 5000 inserções via API
      for (let i = 0; i < 5000; i++) {
        mem.actions.push({
          id: `a${i}`,
          type: 'checkin',
          event_id: 'e1',
          participant_id: `p${i}`,
          instance_index: null,
          data_json: '{}',
          status: 'pending',
          attempts: 0,
          created_at: new Date().toISOString(),
          next_retry_at: null,
          error: null,
        })
      }
      await expect(enqueue({ type: 'checkin', eventId: 'e1', participantId: 'p9999' }))
        .rejects.toThrow(/cheia/i)
    })
  })
})

describe('offline.ts — updateQueueItem / removeFromQueue', () => {
  it('updateQueueItem mescla campos do patch', async () => {
    await withDb(async (_mem, { enqueue, updateQueueItem, loadQueue }) => {
      const a = await enqueue({ type: 'checkin', eventId: 'e1', participantId: 'p1' })
      await updateQueueItem(a.id, { status: 'failed', attempts: 3, error: 'boom' })
      const [updated] = await loadQueue()
      expect(updated.status).toBe('failed')
      expect(updated.attempts).toBe(3)
      expect(updated.error).toBe('boom')
    })
  })

  it('removeFromQueue tira o item', async () => {
    await withDb(async (_mem, { enqueue, removeFromQueue, loadQueue }) => {
      const a = await enqueue({ type: 'checkin', eventId: 'e1', participantId: 'p1' })
      await removeFromQueue(a.id)
      expect(await loadQueue()).toHaveLength(0)
    })
  })

  it('removeFromQueueByEvent tira só do evento', async () => {
    await withDb(async (_mem, { enqueue, removeFromQueueByEvent, loadQueue }) => {
      await enqueue({ type: 'checkin', eventId: 'e1', participantId: 'p1' })
      await enqueue({ type: 'checkin', eventId: 'e2', participantId: 'p2' })
      await removeFromQueueByEvent('e1')
      const queue = await loadQueue()
      expect(queue).toHaveLength(1)
      expect(queue[0].eventId).toBe('e2')
    })
  })

  it('clearQueue zera tudo', async () => {
    await withDb(async (_mem, { enqueue, clearQueue, loadQueue }) => {
      await enqueue({ type: 'checkin', eventId: 'e1', participantId: 'p1' })
      await enqueue({ type: 'checkin', eventId: 'e2', participantId: 'p2' })
      await clearQueue()
      expect(await loadQueue()).toHaveLength(0)
    })
  })
})

describe('offline.ts — getPendingActionsForEvent', () => {
  it('conta apenas status != synced do evento', async () => {
    await withDb(async (mem, { getPendingActionsForEvent }) => {
      mem.actions.push(
        { id: 'a', type: 'checkin', event_id: 'e1', participant_id: 'p', instance_index: null, data_json: '{}', status: 'pending', attempts: 0, created_at: 't', next_retry_at: null, error: null },
        { id: 'b', type: 'checkin', event_id: 'e1', participant_id: 'p', instance_index: null, data_json: '{}', status: 'failed', attempts: 1, created_at: 't', next_retry_at: null, error: null },
        { id: 'c', type: 'checkin', event_id: 'e1', participant_id: 'p', instance_index: null, data_json: '{}', status: 'synced', attempts: 1, created_at: 't', next_retry_at: null, error: null },
        { id: 'd', type: 'checkin', event_id: 'e2', participant_id: 'p', instance_index: null, data_json: '{}', status: 'pending', attempts: 0, created_at: 't', next_retry_at: null, error: null },
      )
      expect(await getPendingActionsForEvent('e1')).toBe(2)
      expect(await getPendingActionsForEvent('e2')).toBe(1)
      expect(await getPendingActionsForEvent('e3')).toBe(0)
    })
  })
})

describe('offline.ts — patchParticipantInPacket', () => {
  it('atualiza data_json e re-aplica redação (PII out)', async () => {
    await withDb(async (mem, { savePacket, patchParticipantInPacket }) => {
      await savePacket({
        eventId: 'e1', downloadedAt: 't',
        participants: [mkP({ id: 'p1', participantId: 'PID-1' })],
        inventory: { items: [] },
      })
      // Patch tenta reintroduzir PII — defesa em depth re-redige
      await patchParticipantInPacket('e1', 'PID-1', undefined, {
        kitWithdrawnAt: '2026-04-26T10:00:00Z',
        buyerEmail: 'leak@x.com', // não pode persistir
      })
      const json = mem.participants[0].data_json
      expect(json).toContain('2026-04-26T10:00:00Z')
      expect(json).not.toContain('leak@x.com')
      expect(mem.participants[0].kit_withdrawn).toBe(1)
    })
  })

  it('com instanceIndex undefined pega TODAS as rows do participant', async () => {
    await withDb(async (mem, { savePacket, patchParticipantInPacket }) => {
      await savePacket({
        eventId: 'e1', downloadedAt: 't',
        participants: [
          mkP({ id: 'p1a', participantId: 'PID-1', instanceIndex: 0 }),
          mkP({ id: 'p1b', participantId: 'PID-1', instanceIndex: 1 }),
        ],
        inventory: { items: [] },
      })
      await patchParticipantInPacket('e1', 'PID-1', undefined, { status: 'checked' })
      // ambas instances devem virar checked
      expect(mem.participants.filter((p) => p.status === 'checked')).toHaveLength(2)
    })
  })
})

describe('offline.ts — removePacket cascata em participants', () => {
  it('remove packet também remove participants do evento', async () => {
    await withDb(async (mem, { savePacket, removePacket, loadIndex }) => {
      await savePacket({
        eventId: 'e1', downloadedAt: 't',
        participants: [mkP({ id: 'p1' }), mkP({ id: 'p2' })],
        inventory: { items: [] },
      })
      await savePacket({
        eventId: 'e2', downloadedAt: 't',
        participants: [mkP({ id: 'p3' })],
        inventory: { items: [] },
      })
      await removePacket('e1')
      expect(mem.participants.find((p) => p.event_id === 'e1')).toBeUndefined()
      expect(mem.participants.find((p) => p.event_id === 'e2')).toBeTruthy()
      const idx = await loadIndex()
      expect(idx.map((m) => m.eventId)).toEqual(['e2'])
    })
  })

  it('wipePackets zera tudo', async () => {
    await withDb(async (mem, { savePacket, wipePackets, loadIndex }) => {
      await savePacket({ eventId: 'e1', downloadedAt: 't', participants: [], inventory: { items: [] } })
      await savePacket({ eventId: 'e2', downloadedAt: 't', participants: [], inventory: { items: [] } })
      await wipePackets()
      expect(await loadIndex()).toHaveLength(0)
      expect(mem.participants).toHaveLength(0)
    })
  })
})

describe('offline.ts — countParticipantsInPacket', () => {
  it('conta participants do evento', async () => {
    await withDb(async (_mem, { savePacket, countParticipantsInPacket }) => {
      await savePacket({
        eventId: 'e1', downloadedAt: 't',
        participants: [mkP({ id: 'a' }), mkP({ id: 'b' }), mkP({ id: 'c' })],
        inventory: { items: [] },
      })
      expect(await countParticipantsInPacket('e1')).toBe(3)
      expect(await countParticipantsInPacket('e2')).toBe(0)
    })
  })
})

describe('offline.ts — saveQueueBackup + listQueueBackups TTL', () => {
  it('saveQueueBackup persiste, listQueueBackups retorna ordenado', async () => {
    await withDb(async (_mem, { saveQueueBackup, listQueueBackups }) => {
      await saveQueueBackup([
        { id: 'a', type: 'checkin', eventId: 'e1', participantId: 'p1', status: 'pending', attempts: 0, createdAt: 't' },
      ])
      const list = await listQueueBackups()
      expect(list).toHaveLength(1)
      expect(list[0].count).toBe(1)
    })
  })

  it('saveQueueBackup com array vazio = no-op', async () => {
    await withDb(async (mem, { saveQueueBackup }) => {
      await saveQueueBackup([])
      expect(mem.backups).toHaveLength(0)
    })
  })

  it('listQueueBackups purga backups expirados (> 7d)', async () => {
    await withDb(async (mem, { listQueueBackups, QUEUE_BACKUP_TTL_MS }) => {
      const now = Date.now()
      mem.backups.push(
        { id: 'fresh', backed_up_at: now - 1000, action_count: 1, payload_json: '[]' },
        { id: 'expired', backed_up_at: now - QUEUE_BACKUP_TTL_MS - 1000, action_count: 1, payload_json: '[]' },
      )
      const list = await listQueueBackups()
      expect(list.map((b) => b.key)).toEqual(['fresh'])
      expect(mem.backups.map((b) => b.id)).toEqual(['fresh'])
    })
  })
})
