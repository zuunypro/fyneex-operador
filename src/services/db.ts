/**
 * SQLite database singleton — substitui AsyncStorage como storage offline
 * principal. Motivação:
 *  - AsyncStorage Android tem cap de 6 MB total e 2 MB por chave.
 *  - JSON.parse de 30+ MB num único cold start trava o JS thread por segundos.
 *  - Busca offline atualmente faz filter linear no array todo a cada keystroke.
 *
 * SQLite resolve os 3 problemas: storage cresce até o disco do device,
 * paginated reads não carregam tudo em memória, queries indexadas são rápidas.
 *
 * IMPORTANTE: este módulo só expõe primitivas (getDb, runMigrations).
 * O resto da camada offline (savePacket, enqueue, etc.) vive em offline.ts
 * e mantém a mesma API pública pros hooks consumidores.
 */

import * as SQLite from 'expo-sqlite'

const DB_NAME = 'fyneex_offline_v1.db'

let _db: SQLite.SQLiteDatabase | null = null
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null

/**
 * Schema versionado via PRAGMA user_version. Cada bloco em SCHEMA_MIGRATIONS
 * roda uma vez por device, em ordem. Adicionar nova migration = nova entry
 * no array com version+1. NUNCA reordenar nem remover entries existentes.
 */
const SCHEMA_MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS event_packets (
        event_id TEXT PRIMARY KEY,
        downloaded_at TEXT NOT NULL,
        inventory_json TEXT NOT NULL DEFAULT '[]',
        stats_json TEXT,
        participant_count INTEGER NOT NULL DEFAULT 0,
        item_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS participants (
        pk INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        instance_index INTEGER,
        -- Denormalizados pra busca rápida sem parse:
        search_text TEXT NOT NULL,
        status TEXT NOT NULL,
        kit_withdrawn INTEGER NOT NULL DEFAULT 0,
        order_number TEXT NOT NULL DEFAULT '',
        -- JSON com todos os outros campos (instanceFields, etc.):
        data_json TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES event_packets(event_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);
      CREATE INDEX IF NOT EXISTS idx_participants_search ON participants(event_id, search_text);
      CREATE INDEX IF NOT EXISTS idx_participants_pid ON participants(event_id, participant_id, instance_index);

      CREATE TABLE IF NOT EXISTS pending_actions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        event_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        instance_index INTEGER,
        data_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        next_retry_at TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_actions_event ON pending_actions(event_id);
      CREATE INDEX IF NOT EXISTS idx_actions_status ON pending_actions(status);
    `,
  },
  {
    // v2: download_complete pra detectar packets parcialmente gravados (rede
    // caiu durante savePacket / app crash). DEFAULT 1 não invalida packets
    // antigos — só novos downloads passam pelo gate. Índice composto explícito
    // pra acelerar UPSERT no caminho delta (savePacketDelta).
    version: 2,
    sql: `
      ALTER TABLE event_packets ADD COLUMN download_complete INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_participants_pid_instance
        ON participants(event_id, participant_id, instance_index);
    `,
  },
]

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;')
  const current = row?.user_version ?? 0
  for (const m of SCHEMA_MIGRATIONS) {
    if (m.version <= current) continue
    await db.execAsync(m.sql)
    // PRAGMA não aceita placeholders — interpolação numérica é segura.
    await db.execAsync(`PRAGMA user_version = ${m.version};`)
  }
  // Foreign keys precisam ser habilitadas em cada conexão.
  await db.execAsync('PRAGMA foreign_keys = ON;')
  // WAL = leitores não bloqueiam escritor (insert de 30k participants
  // não trava queries de read concorrentes). NORMAL = não fsync por
  // commit (safe com WAL); ~2× mais rápido em writes que o FULL default.
  // Persistente por DB — só roda na 1ª abertura mas é idempotente.
  await db.execAsync('PRAGMA journal_mode = WAL;')
  await db.execAsync('PRAGMA synchronous = NORMAL;')
}

/** Singleton da DB. Inicializa schema na primeira chamada. */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME)
    await runMigrations(db)
    _db = db
    return db
  })()
  return _initPromise
}

/** Fecha a DB (uso em testes / reset). Chamadas seguintes reabrem on demand. */
export async function closeDb(): Promise<void> {
  if (_db) {
    try { await _db.closeAsync() } catch { /* ignore */ }
    _db = null
    _initPromise = null
  }
}

/**
 * Helper pra rodar uma transação. Se `fn` jogar, faz ROLLBACK automaticamente.
 * Usado por savePacket pra garantir atomicidade do bulk insert de participants.
 */
export async function withTransaction<T>(
  fn: (db: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const db = await getDb()
  let result: T
  await db.withTransactionAsync(async () => {
    result = await fn(db)
  })
  return result!
}
