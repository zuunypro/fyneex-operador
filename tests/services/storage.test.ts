/**
 * Tests pra storage analysis (estimativa de bytes + livre/total + status).
 *
 * Erro aqui = bloquear download que cabia (cliente perde packet) ou aprovar
 * download que NÃO cabia (SQLite trava com WAL cheio mid-INSERT). Cobertura
 * dos casos: API indisponível (null), zero, packet enorme, formatBytes em
 * todos os ranges.
 */

import {
  estimatePacketBytes,
  formatBytes,
  checkStorageForDownload,
  getFreeBytes,
  getTotalBytes,
} from '@/services/storage'

describe('estimatePacketBytes', () => {
  it('aplica taxa por participante (2KB) + por item (0.5KB) + margem 2x', () => {
    const est = estimatePacketBytes(10, 4)
    // 10*2048 + 4*512 = 20480 + 2048 = 22528
    expect(est.minBytes).toBe(22_528)
    expect(est.recommendedBytes).toBe(22_528 * 2)
    expect(est.participants).toBe(10)
    expect(est.inventoryItems).toBe(4)
  })

  it('zero participants/items → 0 bytes', () => {
    const est = estimatePacketBytes(0, 0)
    expect(est.minBytes).toBe(0)
    expect(est.recommendedBytes).toBe(0)
  })

  it('escala linearmente em volumes grandes (30k participants)', () => {
    const est = estimatePacketBytes(30_000, 100)
    expect(est.minBytes).toBeGreaterThan(60_000_000) // ~60MB
    expect(est.recommendedBytes).toBeGreaterThan(120_000_000)
  })
})

describe('formatBytes', () => {
  it('< 1KB → bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('< 1MB → KB com 1 decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 100)).toBe('100.0 KB')
  })

  it('< 10MB → MB com 1 decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('>= 10MB → MB sem decimal', () => {
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB')
  })

  it('GB com decimal abaixo de 10', () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
  })

  it('GB sem decimal acima de 10', () => {
    expect(formatBytes(50 * 1024 * 1024 * 1024)).toBe('50 GB')
  })

  it('null/undefined/negativo/NaN → em-dash', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('checkStorageForDownload', () => {
  it('insufficient=false quando free > recommended', async () => {
    const status = await checkStorageForDownload(10, 4)
    // Mock retorna 5GB livre — bem mais do que 22KB*2 recomendado.
    expect(status.insufficient).toBe(false)
    expect(status.critical).toBe(false)
    expect(status.freeBytes).toBe(5 * 1024 * 1024 * 1024)
  })

  it('regressão: API de free space indisponível (null) → NÃO bloqueia (otimismo)', async () => {
    const fs = require('expo-file-system') as { getFreeDiskStorageAsync: jest.Mock }
    fs.getFreeDiskStorageAsync.mockResolvedValueOnce(0) // será tratado como null
    const status = await checkStorageForDownload(10, 4)
    expect(status.insufficient).toBe(false)
    expect(status.critical).toBe(false)
    expect(status.freeBytes).toBeNull()
  })

  it('insufficient=true quando free < recommended mas >= min', async () => {
    const fs = require('expo-file-system') as { getFreeDiskStorageAsync: jest.Mock }
    // estimate.minBytes = 10*2048 + 4*512 = 22528
    // recommendedBytes = 45056. Coloca 30000 (entre min e recommended).
    fs.getFreeDiskStorageAsync.mockResolvedValueOnce(30_000)
    const status = await checkStorageForDownload(10, 4)
    expect(status.insufficient).toBe(true)
    expect(status.critical).toBe(false)
  })

  it('critical=true quando free < min (NÃO cabe nem o pacote sem margem)', async () => {
    const fs = require('expo-file-system') as { getFreeDiskStorageAsync: jest.Mock }
    fs.getFreeDiskStorageAsync.mockResolvedValueOnce(1000) // 1KB livre, packet pede 22KB
    const status = await checkStorageForDownload(10, 4)
    expect(status.critical).toBe(true)
    expect(status.insufficient).toBe(true)
  })
})

describe('getFreeBytes / getTotalBytes', () => {
  it('getFreeBytes retorna número quando API responde', async () => {
    const free = await getFreeBytes()
    expect(typeof free).toBe('number')
  })

  it('getFreeBytes retorna null se API throw', async () => {
    const fs = require('expo-file-system') as { getFreeDiskStorageAsync: jest.Mock }
    fs.getFreeDiskStorageAsync.mockRejectedValueOnce(new Error('boom'))
    const free = await getFreeBytes()
    expect(free).toBeNull()
  })

  it('getFreeBytes retorna null se API retornar 0/Infinity/NaN', async () => {
    const fs = require('expo-file-system') as { getFreeDiskStorageAsync: jest.Mock }
    fs.getFreeDiskStorageAsync.mockResolvedValueOnce(0)
    expect(await getFreeBytes()).toBeNull()
    fs.getFreeDiskStorageAsync.mockResolvedValueOnce(Number.POSITIVE_INFINITY)
    expect(await getFreeBytes()).toBeNull()
    fs.getFreeDiskStorageAsync.mockResolvedValueOnce(Number.NaN)
    expect(await getFreeBytes()).toBeNull()
  })

  it('getTotalBytes retorna número quando API responde', async () => {
    const total = await getTotalBytes()
    expect(typeof total).toBe('number')
  })
})
