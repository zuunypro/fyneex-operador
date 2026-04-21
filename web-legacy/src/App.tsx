import { lazy, Suspense, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useNavigationStore } from './stores/navigationStore'
import { useUserStore, loadUserFromStorage } from './stores/userStore'

const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const EventSelectorPage = lazy(() => import('./pages/EventSelectorPage').then((m) => ({ default: m.EventSelectorPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const CheckinPage = lazy(() => import('./pages/CheckinPage').then((m) => ({ default: m.CheckinPage })))
const StockPage = lazy(() => import('./pages/StockPage').then((m) => ({ default: m.StockPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function PageFallback() {
  return (
    <div style={{ minHeight: '60dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: 22, height: 22, borderRadius: '50%',
          border: '2px solid #2A4A2A', borderTopColor: '#3FB950',
          animation: 'spin 0.7s linear infinite',
        }}
      />
    </div>
  )
}

function AppRouter() {
  const isLoggedIn = useNavigationStore((s) => s.isLoggedIn)
  const selectedEvent = useNavigationStore((s) => s.selectedEvent)
  const setIsLoggedIn = useNavigationStore((s) => s.setIsLoggedIn)
  const setUser = useUserStore((s) => s.setUser)

  useEffect(() => {
    if (!isLoggedIn) {
      const user = loadUserFromStorage()
      if (user) {
        setUser(user)
        setIsLoggedIn(true)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isLoggedIn) {
    return (
      <Suspense fallback={<PageFallback />}>
        <LoginPage />
      </Suspense>
    )
  }

  if (!selectedEvent) {
    return (
      <Suspense fallback={<PageFallback />}>
        <EventSelectorPage />
      </Suspense>
    )
  }

  return (
    <AppShell>
      <Suspense fallback={<PageFallback />}>
        <PageRouter />
      </Suspense>
    </AppShell>
  )
}

function PageRouter() {
  const activeTab = useNavigationStore((s) => s.activeTab)

  return (
    <div key={activeTab} className="page-enter">
      <ErrorBoundary>
        {activeTab === 'dashboard' && <DashboardPage />}
        {activeTab === 'checkin' && <CheckinPage />}
        {activeTab === 'stock' && <StockPage />}
        {activeTab === 'profile' && <ProfilePage />}
      </ErrorBoundary>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  )
}
