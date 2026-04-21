import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius } from '@/theme'
import { useOfflineStore } from '@/stores/offlineStore'
import { Icon } from './Icon'

/**
 * Banner fino no topo (abaixo da status bar) com o estado de conectividade
 * e sincronização. Esconde quando tudo está em dia + online.
 *
 * Visível em 3 situações:
 *  1. Offline (com ou sem fila pendente)
 *  2. Online, fila pendente, aguardando sync
 *  3. Online, sincronizando agora
 */
export function OfflineBanner() {
  const online = useOfflineStore((s) => s.online)
  const queue = useOfflineStore((s) => s.queue)
  const syncing = useOfflineStore((s) => s.syncing)
  const lastSync = useOfflineStore((s) => s.lastSync)
  const syncNow = useOfflineStore((s) => s.syncNow)

  const pending = queue.filter((q) => q.status !== 'synced').length

  // Online, sem pending, sem sync ativo, sem ultimo sync recente -> escondido
  const recentSyncAt = lastSync ? new Date(lastSync.at).getTime() : 0
  const hasRecentSync = Date.now() - recentSyncAt < 4000 // 4s janela
  const shouldShow = online === false || pending > 0 || syncing || hasRecentSync
  if (!shouldShow) return null

  let tone: 'red' | 'orange' | 'green' = 'orange'
  let icon = 'wifi_off'
  let label = ''
  let right: React.ReactNode = null

  if (syncing) {
    tone = 'green'
    icon = 'refresh'
    label = `Sincronizando ${pending} escaneamento${pending === 1 ? '' : 's'}...`
    right = <ActivityIndicator size="small" color={BANNER[tone].text} />
  } else if (online === false) {
    tone = 'red'
    icon = 'wifi_off'
    label = pending > 0
      ? `Modo offline · ${pending} escaneamento${pending === 1 ? '' : 's'} pendente${pending === 1 ? '' : 's'}`
      : 'Modo offline · scan funciona, sync ao voltar'
  } else if (pending > 0) {
    tone = 'orange'
    icon = 'schedule'
    label = `${pending} escaneamento${pending === 1 ? '' : 's'} para sincronizar`
    right = (
      <Pressable onPress={() => syncNow()} style={styles.syncButton} hitSlop={6}>
        <Text style={styles.syncButtonLabel}>Sincronizar</Text>
      </Pressable>
    )
  } else if (hasRecentSync && lastSync) {
    tone = 'green'
    icon = 'check_circle'
    if (lastSync.failed > 0) {
      tone = 'orange'
      icon = 'priority_high'
      label = `Sync parcial: ${lastSync.synced} ok, ${lastSync.failed} falhou${lastSync.failed === 1 ? '' : 'ram'}`
    } else if (lastSync.synced > 0) {
      label = `✓ ${lastSync.synced} scan${lastSync.synced === 1 ? '' : 's'} sincronizado${lastSync.synced === 1 ? '' : 's'}`
    } else {
      return null
    }
  }

  const palette = BANNER[tone]
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: palette.bg, borderBottomColor: palette.border },
      ]}
    >
      <Icon name={icon} size={14} color={palette.text} />
      <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
        {label}
      </Text>
      {right}
    </View>
  )
}

const BANNER = {
  red: { bg: '#2A0A0A', border: '#4A1A1A', text: colors.accentRed },
  orange: { bg: '#1F1A0F', border: '#4B3012', text: colors.accentOrange },
  green: { bg: '#0D2818', border: colors.accentGreenDim, text: colors.accentGreen },
} as const

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  label: {
    flex: 1,
    fontSize: 11,
    fontWeight: font.weight.bold,
    letterSpacing: 0.2,
  },
  syncButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  syncButtonLabel: {
    fontSize: 11,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
})
