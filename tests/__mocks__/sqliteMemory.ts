/**
 * In-memory SQLite mock pra testar offline.ts de verdade.
 *
 * Não é um SQLite completo — é uma máquina de estado que entende as queries
 * que offline.ts emite. Implementa as tabelas (event_packets, participants,
 * pending_actions, pending_actions_backup), índices lógicos e os SQL
 * patterns específicos. Suficiente pra exercitar:
 *   - savePacket atomicidade (download_complete=0/1)
 *   - loadPacket com download_complete=0 → null
 *   - enqueue com QUEUE_HARD_CAP
 *   - paginated load + filters + status
 *   - redactForOffline + buildSearchText (search via LIKE)
 *
 * Cada teste cria sua própria instância (via reset()) — sem estado global
 * pra evitar pollution cross-test.
 */

interface PacketRow {
  event_id: string
  downloaded_at: string
  inventory_json: string
  stats_json: string | null
  participant_count: number
  item_count: number
  download_complete: number
}

interface ParticipantRow {
  pk: number
  event_id: string
  participant_id: string
  instance_index: number | null
  search_text: string
  status: string
  kit_withdrawn: number
  order_number: string
  data_json: string
}

interface ActionRow {
  id: string
  type: string
  event_id: string
  participant_id: string
  instance_index: number | null
  data_json: string
  status: string
  attempts: number
  created_at: string
  next_retry_at: string | null
  error: string | null
}

interface BackupRow {
  id: string
  backed_up_at: number
  action_count: number
  payload_json: string
}

export interface MemoryDb {
  packets: Map<string, PacketRow>
  participants: ParticipantRow[]
  actions: ActionRow[]
  backups: BackupRow[]
  pkSeq: number
  userVersion: number
}

export function createMemoryDb(): MemoryDb {
  return {
    packets: new Map(),
    participants: [],
    actions: [],
    backups: [],
    pkSeq: 1,
    userVersion: 99, // alta o suficiente pra evitar migrations rodarem em testes
  }
}

/** Cria um SQLiteDatabase fake que opera sobre o MemoryDb. */
export function fakeDatabase(mem: MemoryDb): {
  execAsync: jest.Mock
  runAsync: jest.Mock
  getAllAsync: jest.Mock
  getFirstAsync: jest.Mock
  withTransactionAsync: jest.Mock
  closeAsync: jest.Mock
} {
  function exec(sql: string): void {
    // PRAGMA / CREATE TABLE / INDEX / etc são no-op (assumimos schema pronto)
    // DELETE simples (sem WHERE) usados em wipePackets/clearQueue:
    if (/^\s*DELETE\s+FROM\s+event_packets\s*;?\s*$/i.test(sql)) {
      mem.packets.clear()
      return
    }
    if (/^\s*DELETE\s+FROM\s+participants\s*;?\s*$/i.test(sql)) {
      mem.participants = []
      return
    }
    if (/^\s*DELETE\s+FROM\s+pending_actions\s*;?\s*$/i.test(sql)) {
      mem.actions = []
      return
    }
    // Tudo mais (PRAGMA, CREATE, ALTER) = no-op
  }

  function run(sql: string, args: unknown[]): { changes: number; lastInsertRowId: number } {
    // INSERT INTO event_packets (...)
    if (/INSERT\s+INTO\s+event_packets/i.test(sql)) {
      const [event_id, downloaded_at, inventory_json, stats_json, participant_count, item_count] = args as [
        string, string, string, string | null, number, number,
      ]
      mem.packets.set(event_id, {
        event_id,
        downloaded_at,
        inventory_json: inventory_json ?? '[]',
        stats_json: stats_json ?? null,
        participant_count: Number(participant_count) || 0,
        item_count: Number(item_count) || 0,
        download_complete: 0,
      })
      return { changes: 1, lastInsertRowId: 0 }
    }
    // UPDATE event_packets SET download_complete = 1 WHERE event_id = ?
    if (/UPDATE\s+event_packets\s+SET\s+download_complete\s*=\s*1\s+WHERE\s+event_id\s*=\s*\?/i.test(sql)) {
      const [eventId] = args as [string]
      const r = mem.packets.get(eventId)
      if (r) r.download_complete = 1
      return { changes: r ? 1 : 0, lastInsertRowId: 0 }
    }
    // UPDATE event_packets SET ... (delta)
    if (/UPDATE\s+event_packets\s+SET/i.test(sql)) {
      // simplificação: encontra event_id no fim
      const eventId = args[args.length - 1] as string
      const r = mem.packets.get(eventId)
      if (r) {
        // Aplicação ingênua: assume contagem é o args[3] ou similar
        // Os 2 callers em offline.ts são savePacketDelta com inventory ou sem.
        // Como esse mock é pra teste, basta marcar download_complete=1.
        r.download_complete = 1
        // Tenta atualizar participant_count se vier
        for (const a of args) {
          if (typeof a === 'number' && a !== Number(eventId)) {
            r.participant_count = a
            break
          }
        }
      }
      return { changes: r ? 1 : 0, lastInsertRowId: 0 }
    }
    // DELETE FROM event_packets WHERE event_id = ?
    if (/DELETE\s+FROM\s+event_packets\s+WHERE\s+event_id\s*=\s*\?/i.test(sql)) {
      const [eventId] = args as [string]
      const had = mem.packets.delete(eventId)
      // Cascata manual em participants (FK ON DELETE CASCADE no schema real)
      mem.participants = mem.participants.filter((p) => p.event_id !== eventId)
      return { changes: had ? 1 : 0, lastInsertRowId: 0 }
    }
    // INSERT INTO participants
    if (/INSERT\s+INTO\s+participants/i.test(sql)) {
      const [event_id, participant_id, instance_index, search_text, status, kit_withdrawn, order_number, data_json] = args as [
        string, string, number | null, string, string, number, string, string,
      ]
      mem.participants.push({
        pk: mem.pkSeq++,
        event_id,
        participant_id,
        instance_index: instance_index ?? null,
        search_text,
        status,
        kit_withdrawn: Number(kit_withdrawn) || 0,
        order_number: order_number ?? '',
        data_json,
      })
      return { changes: 1, lastInsertRowId: mem.pkSeq - 1 }
    }
    // DELETE FROM participants WHERE event_id = ? AND participant_id = ? AND ...
    if (/DELETE\s+FROM\s+participants\s+WHERE\s+event_id\s*=\s*\?\s+AND\s+participant_id\s*=\s*\?/i.test(sql)) {
      const [eventId, pid, ix1, ix2] = args as [string, string, number | null, number | null]
      const before = mem.participants.length
      mem.participants = mem.participants.filter((p) => {
        if (p.event_id !== eventId || p.participant_id !== pid) return true
        // (instance_index IS NULL AND ? IS NULL) OR instance_index = ?
        const matchNullBoth = p.instance_index === null && (ix1 === null || ix1 === undefined)
        const matchEqual = ix2 !== null && ix2 !== undefined && p.instance_index === ix2
        if (matchNullBoth || matchEqual) return false
        return true
      })
      return { changes: before - mem.participants.length, lastInsertRowId: 0 }
    }
    // UPDATE participants SET ... WHERE pk = ?
    if (/UPDATE\s+participants\s+SET/i.test(sql)) {
      const [data_json, status, kit_withdrawn, search_text, pk] = args as [
        string, string, number, string, number,
      ]
      const r = mem.participants.find((p) => p.pk === pk)
      if (r) {
        r.data_json = data_json
        r.status = status
        r.kit_withdrawn = Number(kit_withdrawn) || 0
        r.search_text = search_text
      }
      return { changes: r ? 1 : 0, lastInsertRowId: 0 }
    }
    // INSERT INTO pending_actions
    if (/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+pending_actions\s/i.test(sql) && !/pending_actions_backup/i.test(sql)) {
      const [id, type, event_id, participant_id, instance_index, data_json, status, attempts, created_at, next_retry_at, error] = args as [
        string, string, string, string, number | null, string, string, number, string, string | null, string | null,
      ]
      // OR IGNORE: pula se já existe
      if (/INSERT OR IGNORE/i.test(sql) && mem.actions.find((a) => a.id === id)) {
        return { changes: 0, lastInsertRowId: 0 }
      }
      mem.actions.push({
        id,
        type,
        event_id,
        participant_id,
        instance_index: instance_index ?? null,
        data_json,
        status,
        attempts: Number(attempts) || 0,
        created_at,
        next_retry_at: next_retry_at ?? null,
        error: error ?? null,
      })
      return { changes: 1, lastInsertRowId: 0 }
    }
    // UPDATE pending_actions SET ... WHERE id = ?
    if (/UPDATE\s+pending_actions\s+SET/i.test(sql)) {
      const [type, event_id, participant_id, instance_index, data_json, status, attempts, created_at, next_retry_at, error, id] = args as [
        string, string, string, number | null, string, string, number, string, string | null, string | null, string,
      ]
      const r = mem.actions.find((a) => a.id === id)
      if (r) {
        r.type = type
        r.event_id = event_id
        r.participant_id = participant_id
        r.instance_index = instance_index ?? null
        r.data_json = data_json
        r.status = status
        r.attempts = Number(attempts) || 0
        r.created_at = created_at
        r.next_retry_at = next_retry_at ?? null
        r.error = error ?? null
      }
      return { changes: r ? 1 : 0, lastInsertRowId: 0 }
    }
    // DELETE FROM pending_actions WHERE id = ?
    if (/DELETE\s+FROM\s+pending_actions\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const [id] = args as [string]
      const before = mem.actions.length
      mem.actions = mem.actions.filter((a) => a.id !== id)
      return { changes: before - mem.actions.length, lastInsertRowId: 0 }
    }
    // DELETE FROM pending_actions WHERE event_id = ?
    if (/DELETE\s+FROM\s+pending_actions\s+WHERE\s+event_id\s*=\s*\?/i.test(sql)) {
      const [event_id] = args as [string]
      const before = mem.actions.length
      mem.actions = mem.actions.filter((a) => a.event_id !== event_id)
      return { changes: before - mem.actions.length, lastInsertRowId: 0 }
    }
    // INSERT INTO pending_actions_backup
    if (/INSERT\s+INTO\s+pending_actions_backup/i.test(sql)) {
      const [id, backed_up_at, action_count, payload_json] = args as [string, number, number, string]
      mem.backups.push({ id, backed_up_at, action_count, payload_json })
      return { changes: 1, lastInsertRowId: 0 }
    }
    // DELETE FROM pending_actions_backup WHERE backed_up_at < ?
    if (/DELETE\s+FROM\s+pending_actions_backup\s+WHERE\s+backed_up_at\s*<\s*\?/i.test(sql)) {
      const [cutoff] = args as [number]
      const before = mem.backups.length
      mem.backups = mem.backups.filter((b) => b.backed_up_at >= cutoff)
      return { changes: before - mem.backups.length, lastInsertRowId: 0 }
    }
    return { changes: 0, lastInsertRowId: 0 }
  }

  function getFirst<T>(sql: string, args: unknown[]): T | null {
    if (/SELECT user_version/i.test(sql) || /PRAGMA user_version/i.test(sql)) {
      return { user_version: mem.userVersion } as unknown as T
    }
    if (/SELECT\s+\*\s+FROM\s+event_packets\s+WHERE\s+event_id\s*=\s*\?/i.test(sql)) {
      const [eventId] = args as [string]
      return (mem.packets.get(eventId) as unknown as T) ?? null
    }
    if (/SELECT\s+inventory_json,\s*stats_json\s+FROM\s+event_packets\s+WHERE\s+event_id\s*=\s*\?/i.test(sql)) {
      const [eventId] = args as [string]
      const r = mem.packets.get(eventId)
      return r ? ({ inventory_json: r.inventory_json, stats_json: r.stats_json } as unknown as T) : null
    }
    if (/SELECT\s+event_id\s+FROM\s+event_packets\s+WHERE\s+event_id\s*=\s*\?/i.test(sql)) {
      const [eventId] = args as [string]
      const r = mem.packets.get(eventId)
      return r ? ({ event_id: r.event_id } as unknown as T) : null
    }
    if (/SELECT\s+COUNT\(\*\)\s+as\s+c\s+FROM\s+pending_actions/i.test(sql)) {
      // queue cap check (sem WHERE) ou eventId+status
      if (sql.includes('event_id = ?')) {
        const [eventId] = args as [string]
        const c = mem.actions.filter((a) => a.event_id === eventId && a.status !== 'synced').length
        return ({ c } as unknown as T)
      }
      return ({ c: mem.actions.length } as unknown as T)
    }
    if (/SELECT\s+COUNT\(\*\)\s+as\s+c\s+FROM\s+participants\s+WHERE\s+event_id\s*=\s*\?\s*$/i.test(sql)) {
      const [eventId] = args as [string]
      const c = mem.participants.filter((p) => p.event_id === eventId).length
      return ({ c } as unknown as T)
    }
    if (/SELECT\s+COUNT\(\*\)\s+as\s+c\s+FROM\s+participants/i.test(sql)) {
      // Filtro paginado — delega pra getAll-like
      const filtered = filterParticipants(mem, sql, args)
      return ({ c: filtered.length } as unknown as T)
    }
    if (/SELECT\s+\*\s+FROM\s+pending_actions\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
      const [id] = args as [string]
      return (mem.actions.find((a) => a.id === id) as unknown as T) ?? null
    }
    return null
  }

  function getAll<T>(sql: string, args: unknown[]): T[] {
    // Pagination check FIRST — caso contrário a query do loadPacket (sem
    // LIMIT) e a paginated (com LIMIT) batem na mesma regex prefix.
    if (/SELECT\s+data_json\s+FROM\s+participants/i.test(sql) && /LIMIT\s+\?\s+OFFSET\s+\?/i.test(sql)) {
      const filtered = filterParticipants(mem, sql, args.slice(0, args.length - 2))
      const limit = args[args.length - 2] as number
      const offset = args[args.length - 1] as number
      return filtered.slice(offset, offset + limit).map((p) => ({ data_json: p.data_json })) as unknown as T[]
    }
    // loadPacket (sem LIMIT): ORDER BY pk
    if (/SELECT\s+data_json\s+FROM\s+participants\s+WHERE\s+event_id\s*=\s*\?\s+ORDER\s+BY\s+pk/i.test(sql)) {
      const [eventId] = args as [string]
      return mem.participants
        .filter((p) => p.event_id === eventId)
        .sort((a, b) => a.pk - b.pk)
        .map((p) => ({ data_json: p.data_json })) as unknown as T[]
    }
    if (/SELECT\s+pk,\s*data_json\s+FROM\s+participants\s+WHERE/i.test(sql)) {
      const [eventId, pid, ix1, ix2] = args as [string, string, number | null, number | null]
      let rows = mem.participants.filter((p) => p.event_id === eventId && p.participant_id === pid)
      if (sql.includes('instance_index = ?')) {
        rows = rows.filter((p) => {
          const matchNullBoth = p.instance_index === null && (ix1 === null || ix1 === undefined)
          const matchEqual = ix2 !== null && ix2 !== undefined && p.instance_index === ix2
          return matchNullBoth || matchEqual
        })
      }
      return rows.map((p) => ({ pk: p.pk, data_json: p.data_json })) as unknown as T[]
    }
    if (/SELECT\s+\*\s+FROM\s+event_packets\s+ORDER\s+BY\s+downloaded_at\s+DESC/i.test(sql)) {
      return Array.from(mem.packets.values())
        .sort((a, b) => b.downloaded_at.localeCompare(a.downloaded_at)) as unknown as T[]
    }
    if (/SELECT\s+\*\s+FROM\s+pending_actions\s+ORDER\s+BY\s+created_at/i.test(sql)) {
      return [...mem.actions].sort((a, b) => a.created_at.localeCompare(b.created_at)) as unknown as T[]
    }
    if (/SELECT\s+id,\s*backed_up_at,\s*action_count\s+FROM\s+pending_actions_backup/i.test(sql)) {
      return mem.backups
        .map((b) => ({ id: b.id, backed_up_at: b.backed_up_at, action_count: b.action_count }))
        .sort((a, b) => b.backed_up_at - a.backed_up_at) as unknown as T[]
    }
    return [] as T[]
  }

  return {
    execAsync: jest.fn(async (sql: string) => exec(sql)),
    runAsync: jest.fn(async (sql: string, ...args: unknown[]) => run(sql, args)),
    getAllAsync: jest.fn(async <T,>(sql: string, ...args: unknown[]) => getAll<T>(sql, args)),
    getFirstAsync: jest.fn(async <T,>(sql: string, ...args: unknown[]) => getFirst<T>(sql, args)),
    withTransactionAsync: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    closeAsync: jest.fn(async () => undefined),
  }
}

function filterParticipants(mem: MemoryDb, sql: string, args: unknown[]): ParticipantRow[] {
  // args: [eventId, optional searchPattern]. Status filter é hardcoded no SQL.
  const [eventId, ...rest] = args as [string, ...unknown[]]
  let rows = mem.participants.filter((p) => p.event_id === eventId)
  if (/search_text\s+LIKE\s+\?/i.test(sql)) {
    const pattern = rest.shift() as string
    const inner = String(pattern ?? '').replace(/^%/, '').replace(/%$/, '')
    rows = rows.filter((p) => p.search_text.includes(inner))
  }
  if (sql.includes("status = 'pending'")) {
    rows = rows.filter((p) => p.status === 'pending')
  } else if (sql.includes("status = 'checked'")) {
    rows = rows.filter((p) => p.status === 'checked')
  }
  return rows.sort((a, b) => a.pk - b.pk)
}
