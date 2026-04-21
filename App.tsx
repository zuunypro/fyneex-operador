import { useEffect, useState } from 'react'
import { ActivityIndicator, AppState, type AppStateStatus, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import * as Updates from 'expo-updates'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { colors } from '@/theme'
import { useNavigationStore } from '@/stores/navigationStore'
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
  const setUser = useUserStore((s) => s.setUser)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let alive = true
    loadUserFromStorage().then((user) => {
      if (!alive) return
      if (user) {
        setUser(user)
        setIsLoggedIn(true)
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
