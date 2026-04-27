/**
 * Tests pra db.ts (SQLite singleton + migrations).
 *
 * O mock real de expo-sqlite vem de `tests/setup.ts`, mas pra testar
 * comportamento específico (chamadas, ordem das queries) precisamos
 * substituir o mock per-test via jest.doMock + jest.isolateModules.
 *
 * Cada teste cria seu próprio fake DB pra inspecionar execAsync calls
 * sem disputar estado com outros testes.
 */

interface FakeDb {
  execAsync: jest.Mock
  runAsync: jest.Mock
  getAllAsync: jest.Mock
  getFirstAsync: jest.Mock
  withTransactionAsync: jest.Mock
  closeAsync: jest.Mock
}

function makeFakeDb(opts: {
  initialUserVersion?: number
  onExec?: (sql: string) => void
  onTx?: () => void
} = {}): FakeDb {
  return {
    execAsync: jest.fn(async (sql: string) => { opts.onExec?.(sql) }),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async (q: string) => {
      if (q.includes('user_version')) {
        return { user_version: opts.initialUserVersion ?? 0 }
      }
      return null
    }),
    withTransactionAsync: jest.fn(async (fn: () => Promise<unknown>) => {
      opts.onTx?.()
      return fn()
    }),
    closeAsync: jest.fn(async () => undefined),
  }
}

describe('db.ts — getDb singleton', () => {
  it('retorna o MESMO db em chamadas consecutivas (cached promise)', async () => {
    const fake = makeFakeDb()
    const openMock = jest.fn(async () => fake)

    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-sqlite', () => ({
        __esModule: true,
        openDatabaseAsync: openMock,
      }))
      const { getDb } = require('@/services/db') as typeof import('@/services/db')
      const a = await getDb()
      const b = await getDb()
      expect(a).toBe(b)
      expect(openMock).toHaveBeenCalledTimes(1)
    })
  })

  it('chamadas paralelas compartilham 1 init promise (sem race)', async () => {
    const fake = makeFakeDb()
    const openMock = jest.fn(async () => fake)

    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-sqlite', () => ({
        __esModule: true,
        openDatabaseAsync: openMock,
      }))
      const { getDb } = require('@/services/db') as typeof import('@/services/db')
      await Promise.all([getDb(), getDb(), getDb()])
      expect(openMock).toHaveBeenCalledTimes(1)
    })
  })
})

describe('db.ts — runMigrations', () => {
  it('roda CREATE TABLE + PRAGMAs em DB nova (user_version=0)', async () => {
    const execCalls: string[] = []
    const fake = makeFakeDb({ initialUserVersion: 0, onExec: (s) => execCalls.push(s) })

    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-sqlite', () => ({
        __esModule: true,
        openDatabaseAsync: jest.fn(async () => fake),
      }))
      const { getDb } = require('@/services/db') as typeof import('@/services/db')
      await getDb()
    })

    expect(execCalls.some((s) => s.includes('CREATE TABLE'))).toBe(true)
    expect(execCalls.some((s) => s.includes('event_packets'))).toBe(true)
    expect(execCalls.some((s) => s.includes('participants'))).toBe(true)
    expect(execCalls.some((s) => s.includes('pending_actions'))).toBe(true)
    expect(execCalls.some((s) => s.includes('journal_mode = WAL'))).toBe(true)
    expect(execCalls.some((s) => s.includes('foreign_keys = ON'))).toBe(true)
  })

  it('skipa migrations já aplicadas (user_version=99 não roda nenhuma)', async () => {
    const versionPragmas: string[] = []
    const fake = makeFakeDb({
      initialUserVersion: 99,
      onExec: (s) => {
        if (/PRAGMA user_version =/.test(s)) versionPragmas.push(s)
      },
    })

    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-sqlite', () => ({
        __esModule: true,
        openDatabaseAsync: jest.fn(async () => fake),
      }))
      const { getDb } = require('@/services/db') as typeof import('@/services/db')
      await getDb()
    })

    // version 99 > qualquer migration atual → nenhuma roda
    expect(versionPragmas).toHaveLength(0)
  })

  it('roda só as migrations > user_version atual', async () => {
    const versionPragmas: string[] = []
    const fake = makeFakeDb({
      initialUserVersion: 2,
      onExec: (s) => {
        if (/PRAGMA user_version =/.test(s)) versionPragmas.push(s)
      },
    })

    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-sqlite', () => ({
        __esModule: true,
        openDatabaseAsync: jest.fn(async () => fake),
      }))
      const { getDb } = require('@/services/db') as typeof import('@/services/db')
      await getDb()
    })

    // user_version=2: só version 3 deve rodar
    expect(versionPragmas.some((s) => s.includes('= 3'))).toBe(true)
    expect(versionPragmas.some((s) => s.includes('= 1'))).toBe(false)
    expect(versionPragmas.some((s) => s.includes('= 2'))).toBe(false)
  })
})

describe('db.ts — withTransaction', () => {
  it('chama withTransactionAsync e retorna o resultado do callback', async () => {
    let txCalled = false
    const fake = makeFakeDb({ initialUserVersion: 99, onTx: () => { txCalled = true } })

    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-sqlite', () => ({
        __esModule: true,
        openDatabaseAsync: jest.fn(async () => fake),
      }))
      const { withTransaction } = require('@/services/db') as typeof import('@/services/db')
      const result = await withTransaction(async () => 42)
      expect(result).toBe(42)
    })

    expect(txCalled).toBe(true)
  })

  it('propaga throw do callback (caller decide o que fazer com rollback)', async () => {
    const fake = makeFakeDb({ initialUserVersion: 99 })

    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-sqlite', () => ({
        __esModule: true,
        openDatabaseAsync: jest.fn(async () => fake),
      }))
      const { withTransaction } = require('@/services/db') as typeof import('@/services/db')
      await expect(
        withTransaction(async () => { throw new Error('boom') }),
      ).rejects.toThrow('boom')
    })
  })
})

describe('db.ts — closeDb', () => {
  it('reabre via openDatabaseAsync após close (singleton resetado)', async () => {
    const fake = makeFakeDb({ initialUserVersion: 99 })
    const openMock = jest.fn(async () => fake)

    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-sqlite', () => ({
        __esModule: true,
        openDatabaseAsync: openMock,
      }))
      const { getDb, closeDb } = require('@/services/db') as typeof import('@/services/db')
      await getDb()
      await closeDb()
      await getDb()
    })

    expect(openMock).toHaveBeenCalledTimes(2)
  })

  it('closeDb sem db aberta é no-op (não throw)', async () => {
    const fake = makeFakeDb({ initialUserVersion: 99 })

    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-sqlite', () => ({
        __esModule: true,
        openDatabaseAsync: jest.fn(async () => fake),
      }))
      const { closeDb } = require('@/services/db') as typeof import('@/services/db')
      await expect(closeDb()).resolves.not.toThrow()
    })
  })
})
