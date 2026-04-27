/**
 * Smoke import test: garante que cada módulo de src/ pode ser carregado
 * sem throw em import-time. Detecta regressões sutis tipo:
 *   - circular imports que crashavam só em produção
 *   - top-level code que joga em ambiente sem feature X
 *   - typo em re-exports
 *   - schema break em arquivos não testados diretamente
 *
 * Componentes/pages que dependem de react-native runtime (View, StyleSheet,
 * Camera, etc) não entram aqui — exigiriam jest-expo ou rn-renderer pesado.
 * Cobertura deles fica em e2e (manual em device/emulador).
 */

describe('smoke imports — utils', () => {
  it.each([
    'utils/format', 'utils/text', 'utils/feedback', 'utils/fieldClassification',
    'utils/kitItems', 'utils/participants', 'utils/errorMessages',
  ])('@/%s carrega sem throw', (path) => {
    expect(() => require(`@/${path}`)).not.toThrow()
  })
})

describe('smoke imports — services', () => {
  it.each([
    'services/api', 'services/db', 'services/formatters', 'services/offline',
    'services/secureToken', 'services/storage',
  ])('@/%s carrega sem throw', (path) => {
    expect(() => require(`@/${path}`)).not.toThrow()
  })
})

describe('smoke imports — stores', () => {
  it.each([
    'stores/userStore', 'stores/navigationStore', 'stores/offlineStore',
  ])('@/%s carrega sem throw', (path) => {
    expect(() => require(`@/${path}`)).not.toThrow()
  })
})

describe('smoke imports — hooks (react-query)', () => {
  it.each([
    'hooks/useEvents', 'hooks/useEventStats', 'hooks/useParticipants',
    'hooks/useInventory', 'hooks/useCheckin', 'hooks/useKitWithdrawal',
    'hooks/useRevertCheckin', 'hooks/useRevertKit',
    'hooks/useRecentObservations', 'hooks/useToast',
    'hooks/useDebouncedValue', 'hooks/useAppBackHandler',
  ])('@/%s carrega sem throw', (path) => {
    expect(() => require(`@/${path}`)).not.toThrow()
  })
})

describe('smoke imports — components (catch top-level boot errors)', () => {
  // Componentes UI dependem de RN runtime (stubado em tests/setup.ts).
  // Smoke detecta: typo em import, top-level code rodando, schema break.
  // NÃO testa rendering — pra isso seria preciso jest-expo + RN renderer.
  it.each([
    'components/AppShell', 'components/BottomNav', 'components/ConfirmDialog',
    'components/ConfirmationModal', 'components/DetailField', 'components/ErrorBoundary',
    'components/ForceWithdrawalModal', 'components/Icon', 'components/InstanceSelectorModal',
    'components/OfflineBanner', 'components/StalePacketWarning',
    'components/StorageWarningModal', 'components/Toast', 'components/QRScanner',
  ])('@/%s carrega sem throw', (path) => {
    expect(() => require(`@/${path}`)).not.toThrow()
  })
})

describe('smoke imports — pages', () => {
  it.each([
    'pages/DashboardPage', 'pages/LoginPage', 'pages/ProfilePage',
    'pages/CheckinPage', 'pages/StockPage', 'pages/EventSelectorPage',
  ])('@/%s carrega sem throw', (path) => {
    expect(() => require(`@/${path}`)).not.toThrow()
  })
})

describe('smoke imports — App.tsx (root)', () => {
  it('App.tsx carrega sem throw (catch erros de boot do app)', () => {
    expect(() => require('../../App')).not.toThrow()
  })
})

describe('smoke imports — schemas + theme', () => {
  it('@/schemas/user.schema (puro types — só carrega o file)', () => {
    expect(() => require('@/schemas/user.schema')).not.toThrow()
  })
  it('@/theme carrega', () => {
    // theme/index.ts pode ter cores e tokens; smoke só verifica que importa
    expect(() => require('@/theme')).not.toThrow()
  })
})

describe('smoke imports — exports principais existem', () => {
  it('services/api expõe ApiError + apiGet + apiPost + apiLogout', () => {
    const m = require('@/services/api')
    expect(m.ApiError).toBeDefined()
    expect(typeof m.apiGet).toBe('function')
    expect(typeof m.apiPost).toBe('function')
    expect(typeof m.apiLogout).toBe('function')
    expect(typeof m.getApiBaseUrl).toBe('function')
    expect(typeof m.getBaseUrlError).toBe('function')
  })

  it('services/secureToken expõe set/get/clear + device id helpers', () => {
    const m = require('@/services/secureToken')
    expect(typeof m.setAccessHash).toBe('function')
    expect(typeof m.getAccessHash).toBe('function')
    expect(typeof m.clearAccessHash).toBe('function')
    expect(typeof m.getDeviceId).toBe('function')
    expect(typeof m.getDeviceIdHash).toBe('function')
    expect(typeof m.initDeviceIdHash).toBe('function')
  })

  it('services/offline expõe API esperada pelos consumers', () => {
    const m = require('@/services/offline')
    for (const name of [
      'savePacket', 'savePacketDelta', 'loadPacket', 'loadIndex', 'removePacket',
      'wipePackets', 'enqueue', 'updateQueueItem', 'removeFromQueue',
      'removeFromQueueByEvent', 'clearQueue', 'loadQueue', 'getPendingActionsForEvent',
      'countParticipantsInPacket', 'loadParticipantsPaginated', 'loadInventory',
      'saveQueueBackup', 'listQueueBackups', 'purgeLegacyQueueBackup',
      'migrateLegacyAsyncStorage', 'redactForOffline',
    ]) {
      expect(typeof m[name]).toBe('function')
    }
    // Constantes
    expect(typeof m.QUEUE_BACKUP_TTL_MS).toBe('number')
    expect(typeof m.DEFAULT_STALE_PACKET_HOURS).toBe('number')
    expect(typeof m.SAME_DAY_STALE_PACKET_HOURS).toBe('number')
  })

  it('stores/offlineStore expõe useOfflineStore + isOnlineNow + getPacketMeta + setSyncQueryClient', () => {
    const m = require('@/stores/offlineStore')
    expect(typeof m.useOfflineStore).toBe('function')
    expect(typeof m.isOnlineNow).toBe('function')
    expect(typeof m.getPacketMeta).toBe('function')
    expect(typeof m.setSyncQueryClient).toBe('function')
  })

  it('stores/userStore expõe useUserStore + getAccessHashSync + loadUserFromStorage', () => {
    const m = require('@/stores/userStore')
    expect(typeof m.useUserStore).toBe('function')
    expect(typeof m.getAccessHashSync).toBe('function')
    expect(typeof m.loadUserFromStorage).toBe('function')
  })

  it('stores/navigationStore expõe useNavigationStore', () => {
    const m = require('@/stores/navigationStore')
    expect(typeof m.useNavigationStore).toBe('function')
  })

  it('utils/errorMessages expõe friendlyError', () => {
    const m = require('@/utils/errorMessages')
    expect(typeof m.friendlyError).toBe('function')
  })

  it('utils/format expõe formatCpfLast5 + formatPhoneBR', () => {
    const m = require('@/utils/format')
    expect(typeof m.formatCpfLast5).toBe('function')
    expect(typeof m.formatPhoneBR).toBe('function')
  })

  it('utils/kitItems expõe buildKitItems + formatKitSummary + kitItemsToFields', () => {
    const m = require('@/utils/kitItems')
    expect(typeof m.buildKitItems).toBe('function')
    expect(typeof m.formatKitSummary).toBe('function')
    expect(typeof m.kitItemsToFields).toBe('function')
  })

  it('utils/participants expõe matchParticipant + groupByOrder + buildSearchIndex', () => {
    const m = require('@/utils/participants')
    expect(typeof m.matchParticipant).toBe('function')
    expect(typeof m.matchParticipantNormalized).toBe('function')
    expect(typeof m.matchByIndex).toBe('function')
    expect(typeof m.groupByOrder).toBe('function')
    expect(typeof m.buildSearchIndex).toBe('function')
  })

  it('utils/text expõe stripAccents + normalizeForSearch', () => {
    const m = require('@/utils/text')
    expect(typeof m.stripAccents).toBe('function')
    expect(typeof m.normalizeForSearch).toBe('function')
  })

  it('utils/fieldClassification expõe isKitFieldLabel + isIdentityFieldLabel + classifyFields', () => {
    const m = require('@/utils/fieldClassification')
    expect(typeof m.isKitFieldLabel).toBe('function')
    expect(typeof m.isIdentityFieldLabel).toBe('function')
    expect(typeof m.classifyFields).toBe('function')
  })

  it('utils/feedback expõe beep + vibrate + feedbackOk + feedbackBad + primeAudio', () => {
    const m = require('@/utils/feedback')
    expect(typeof m.beep).toBe('function')
    expect(typeof m.vibrate).toBe('function')
    expect(typeof m.feedbackOk).toBe('function')
    expect(typeof m.feedbackBad).toBe('function')
    expect(typeof m.primeAudio).toBe('function')
  })

  it('services/storage expõe estimatePacketBytes + checkStorageForDownload + formatBytes', () => {
    const m = require('@/services/storage')
    expect(typeof m.estimatePacketBytes).toBe('function')
    expect(typeof m.checkStorageForDownload).toBe('function')
    expect(typeof m.formatBytes).toBe('function')
    expect(typeof m.getFreeBytes).toBe('function')
    expect(typeof m.getTotalBytes).toBe('function')
  })

  it('services/formatters expõe formatEventDateTime', () => {
    const m = require('@/services/formatters')
    expect(typeof m.formatEventDateTime).toBe('function')
  })

  it('services/db expõe getDb + closeDb + withTransaction', () => {
    const m = require('@/services/db')
    expect(typeof m.getDb).toBe('function')
    expect(typeof m.closeDb).toBe('function')
    expect(typeof m.withTransaction).toBe('function')
  })
})
