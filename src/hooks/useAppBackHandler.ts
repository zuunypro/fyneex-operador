import { useEffect } from 'react'
import { Alert, BackHandler } from 'react-native'
import { useNavigationStore } from '@/stores/navigationStore'

/**
 * Trata o botão "voltar" físico do Android. Hierarquia:
 *   1) Se está dentro de um evento (selectedEvent != null) → limpa o evento
 *      e volta pro EventSelectorPage.
 *   2) Se está numa tab que não é dashboard → vai pra dashboard.
 *   3) Se está em dashboard → confirmação "Sair do app?".
 *
 * Quando isLoggedIn=false (LoginPage), o handler NÃO monta — back fecha
 * o app, comportamento padrão esperado pra tela de login.
 */
export function useAppBackHandler() {
  const activeTab = useNavigationStore((s) => s.activeTab)
  const selectedEvent = useNavigationStore((s) => s.selectedEvent)
  const setActiveTab = useNavigationStore((s) => s.setActiveTab)
  const setSelectedEvent = useNavigationStore((s) => s.setSelectedEvent)
  const isLoggedIn = useNavigationStore((s) => s.isLoggedIn)

  useEffect(() => {
    if (!isLoggedIn) return
    const handler = () => {
      if (selectedEvent) {
        setSelectedEvent(null)
        return true
      }
      if (activeTab !== 'dashboard') {
        setActiveTab('dashboard')
        return true
      }
      Alert.alert('Sair', 'Deseja sair do app?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sair', style: 'destructive', onPress: () => BackHandler.exitApp() },
      ])
      return true
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', handler)
    return () => sub.remove()
  }, [isLoggedIn, activeTab, selectedEvent, setActiveTab, setSelectedEvent])
}
