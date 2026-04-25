import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, type AppStateStatus, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import * as Updates from 'expo-updates'
import { QueryClient, QueryClientProvider, focusManager, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ApiError } from '@/services/api'
import { colors } from '@/theme'
import { useNavigationStore } from '@/stores/navigationStore'
import { useOfflineStore } from '@/stores/offlineStore'
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
  useEffect(() => {
    if (!isLoggedIn) return
    const handleAuthError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        logout().catch(() => { /* logout sempre best-effort */ })
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
  }, [isLoggedIn, queryClient, logout])

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
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" backgroundColor={colors.bgBase} />
          <AppRouter />
        </QueryClientProvider>
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
