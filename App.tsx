import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, AppState, type AppStateStatus, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import * as Updates from 'expo-updates'
import { QueryClient, focusManager, useQueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ApiError } from '@/services/api'
import { closeDb } from '@/services/db'
import { colors } from '@/theme'
import { useNavigationStore } from '@/stores/navigationStore'
import { setSyncQueryClient, useOfflineStore } from '@/stores/offlineStore'
import { loadUserFromStorage, useUserStore } from '@/stores/userStore'
import { LoginPage } from '@/pages/LoginPage'
import { EventSelectorPage } from '@/pages/EventSelectorPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { CheckinPage } from '@/pages/CheckinPage'
import { StockPage } from '@/pages/StockPage'
import { ProfilePage } from '@/pages/ProfilePage'

// Pinta o background nativo ANTES do React montar (evita flash branco).
SystemUI.setBackgroundColorAsync(colors.bgBase).catch(() => { /* ignore */ })

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

// Persiste apenas queries leves (lista de eventos) no AsyncStorage. Boot
// fica instantâneo no `EventSelectorPage` mesmo sem internet, em vez de
// mostrar spinner enquanto refetch corre. Não persiste:
//   - `mobile.participants`: já está no SQLite (`offline.ts`), duplicaria
//     30k linhas no AsyncStorage e estouraria o cap de 6MB.
//   - `mobile.inventory`/`mobile.stats`: refetcham toda hora, cache vence
//     antes de ser útil.
const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'fyneex-query-cache',
  throttleTime: 1000,
})

AppState.addEventListener('change', (status: AppStateStatus) => {
  focusManager.setFocused(status === 'active')
})

function PageFallback() {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator size="small" color={colors.accentGreen} />
    </View>
  )
}

function PageRouter() {
  const activeTab = useNavigationStore((s) => s.activeTab)
  return (
    <ErrorBoundary>
      {activeTab === 'dashboard' && <DashboardPage />}
      {activeTab === 'checkin' && <CheckinPage />}
      {activeTab === 'stock' && <StockPage />}
      {activeTab === 'profile' && <ProfilePage />}
    </ErrorBoundary>
  )
}

function AppRouter() {
  const isLoggedIn = useNavigationStore((s) => s.isLoggedIn)
  const selectedEvent = useNavigationStore((s) => s.selectedEvent)
  const setIsLoggedIn = useNavigationStore((s) => s.setIsLoggedIn)
  const logout = useNavigationStore((s) => s.logout)
  const setUser = useUserStore((s) => s.setUser)
  const hydrateOffline = useOfflineStore((s) => s.hydrate)
  const online = useOfflineStore((s) => s.online)
  const queryClient = useQueryClient()
  const [hydrated, setHydrated] = useState(false)

  // Logout automático ao detectar 401 em qualquer query/mutation. Antes disso
  // apenas EventSelectorPage tratava — operador no portão tomava 401 numa
  // mutation de checkin/withdrawal e via toast "saia e entre de novo" sem ser
  // efetivamente deslogado, exigindo navegação manual até Profile pra clicar
  // sair. O listener global cobre todos os hooks (`useCheckin`, `useKitWithdrawal`,
  // `useParticipants`, etc.) e dispara o mesmo `logout()` do navigationStore.
  const offlineQueue = useOfflineStore((s) => s.queue)
  const wipeAll = useOfflineStore((s) => s.wipeAll)
  useEffect(() => {
    if (!isLoggedIn) return
    const handleAuthError = (err: unknown) => {
      if (!(err instanceof ApiError)) return

      if (err.status === 401) {
        // BUG 3 fix: antes de deslogar, avisa o operador se há ações offline
        // pendentes que serão perdidas. Perda silenciosa era um problema grave
        // em eventos com baixa conectividade (operador escaneava offline,
        // sessão expirava, logout apagava a fila sem nenhum aviso).
        // wipeAll faz backup das ações não-sincronizadas em AsyncStorage antes
        // de limpar (recoverBackup pode trazer de volta). closeDb fecha o
        // handle pra liberar lock do WAL — getDb reabre on demand no próximo
        // login, sem prender state stale entre sessões.
        const pendingCount = offlineQueue.filter(
          (q) => q.status === 'pending' || q.status === 'syncing' || q.status === 'failed',
        ).length
        if (pendingCount > 0) {
          Alert.alert(
            'Sessão expirada',
            `Sessão expirada — ${pendingCount} ação${pendingCount === 1 ? '' : 'ões'} offline perdida${pendingCount === 1 ? '' : 's'}. Reconecte para continuar.`,
            [{ text: 'OK' }],
          )
        }
        ;(async () => {
          try { await wipeAll() } catch { /* best-effort */ }
          try { await closeDb() } catch { /* best-effort */ }
          await logout().catch(() => { /* logout sempre best-effort */ })
        })()
        return
      }

      // BUG 4 fix: 403 não deve deslogar — o usuário pode estar válido mas
      // tentou uma operação sem permissão (ex: evento de outro organizador).
      // Apenas exibe alerta; o erro ainda é propagado pro caller pelo React Query.
      if (err.status === 403) {
        Alert.alert('Acesso negado', 'Acesso negado a esta operação', [{ text: 'OK' }])
      }
    }
    const queryUnsub = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.state.error) {
        handleAuthError(event.query.state.error)
      }
    })
    const mutUnsub = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.mutation.state.error) {
        handleAuthError(event.mutation.state.error)
      }
    })
    return () => { queryUnsub(); mutUnsub() }
  // offlineQueue is intentionally in deps: handler must read latest queue length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, queryClient, logout, offlineQueue, wipeAll])

  // Invalida queries quando o app volta pra online. Sem isso, a lista de
  // participants/inventory continua mostrando os dados cacheados do offline
  // por até 15s (refetchInterval) depois que a net volta — o operador escaneia
  // achando que tá online mas vê o estado antigo.
  const prevOnlineRef = useRef<boolean | null>(null)
  useEffect(() => {
    const prev = prevOnlineRef.current
    prevOnlineRef.current = online
    if (prev === false && online === true) {
      queryClient.invalidateQueries({ queryKey: ['mobile'] })
    }
  }, [online, queryClient])

  // Injeta o queryClient no offlineStore pra que `syncNow` consiga invalidar
  // queries de participants/inventory quando ações offline são drenadas. Sem
  // isso o operador precisava puxar pra baixo manualmente pra ver o sync.
  useEffect(() => {
    setSyncQueryClient(queryClient)
  }, [queryClient])

  useEffect(() => {
    let alive = true
    Promise.all([loadUserFromStorage(), hydrateOffline()]).then(([user]) => {
      if (!alive) return
      if (user) {
        setUser(user)
        setIsLoggedIn(true)
      } else {
        // Garante que isLoggedIn=false mesmo se algo externo tentou setar antes.
        setIsLoggedIn(false)
      }
      setHydrated(true)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Busca bundle OTA em background. Aplicado no próximo cold start.
  useEffect(() => {
    async function checkUpdates() {
      try {
        const res = await Updates.checkForUpdateAsync()
        if (res.isAvailable) {
          await Updates.fetchUpdateAsync()
        }
      } catch { /* sem internet ou em dev */ }
    }
    if (!__DEV__) checkUpdates()
  }, [])

  if (!hydrated) return <PageFallback />

  if (!isLoggedIn) return <LoginPage />

  if (!selectedEvent) return <EventSelectorPage />

  return (
    <AppShell>
      <PageRouter />
    </AppShell>
  )
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bgBase }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: 24 * 60 * 60 * 1000,
            dehydrateOptions: {
              shouldDehydrateQuery: (query) => {
                if (query.state.status !== 'success') return false
                const key = query.queryKey
                return Array.isArray(key) && key[0] === 'mobile' && key[1] === 'events'
              },
            },
          }}
        >
          <StatusBar style="light" backgroundColor={colors.bgBase} />
          <AppRouter />
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgBase,
  },
})
