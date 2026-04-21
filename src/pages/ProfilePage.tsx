import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { colors, font, radius } from '@/theme'
import { useNavigationStore } from '@/stores/navigationStore'
import { useOfflineStore } from '@/stores/offlineStore'
import { useUserStore } from '@/stores/userStore'
import { Icon } from '@/components/Icon'

const APP_VERSION = (Constants.expoConfig?.version as string | undefined) || '1.0.0'

const ACTION_LABEL: Record<string, string> = {
  checkin: 'Check-in pendente',
  'revert-checkin': 'Reversão de check-in',
  withdrawal: 'Retirada de kit',
  'revert-kit': 'Reversão de kit',
}

// Defensivo: acessar Updates.channel/updateId pode lançar em builds onde o
// native module não está pronto. Envolver em try/catch pra não quebrar o import.
function safeString(getter: () => string | null | undefined, fallback: string): string {
  try { return getter() || fallback } catch { return fallback }
}
const CHANNEL = safeString(() => Updates.channel, 'dev')
const UPDATE_ID = safeString(() => (Updates.updateId || '').slice(0, 8), '—')

export function ProfilePage() {
  const user = useUserStore((s) => s.user)
  const logout = useNavigationStore((s) => s.logout)
  const event = useNavigationStore((s) => s.selectedEvent)
  const packets = useOfflineStore((s) => s.packets)
  const queue = useOfflineStore((s) => s.queue)
  const online = useOfflineStore((s) => s.online)
  const downloading = useOfflineStore((s) => s.downloading)
  const downloadEvent = useOfflineStore((s) => s.downloadEvent)
  const deleteEvent = useOfflineStore((s) => s.deleteEvent)
  const syncNow = useOfflineStore((s) => s.syncNow)
  const retryAction = useOfflineStore((s) => s.retryAction)
  const dropAction = useOfflineStore((s) => s.dropAction)
  const syncing = useOfflineStore((s) => s.syncing)

  const [checking, setChecking] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)

  const initials = user?.name
    ? user.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')
    : '?'

  const eventPacket = event ? packets.find((p) => p.eventId === event.id) : undefined
  const pending = queue.filter((q) => q.status !== 'synced').length
  const failed = queue.filter((q) => q.status === 'failed')

  async function checkForUpdate() {
    if (checking) return
    setChecking(true)
    try {
      const res = await Updates.checkForUpdateAsync()
      if (res.isAvailable) {
        await Updates.fetchUpdateAsync()
        setUpdateReady(true)
        Alert.alert(
          'Atualização baixada',
          'Uma nova versão foi baixada. Toque em "Aplicar agora" para reiniciar.',
        )
      } else {
        Alert.alert('Sem atualização', 'Você já está na versão mais recente.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert('Erro ao checar atualização', msg)
    } finally {
      setChecking(false)
    }
  }

  async function applyUpdate() {
    try {
      await Updates.reloadAsync()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert('Erro ao reiniciar', msg)
    }
  }

  async function handleDownload() {
    if (!event) {
      Alert.alert('Selecione um evento', 'Volte ao seletor de eventos e escolha um antes de baixar.')
      return
    }
    if (online === false) {
      Alert.alert('Sem internet', 'Conecte à internet pra baixar o evento.')
      return
    }
    try {
      await downloadEvent(event.id)
      Alert.alert('Pronto', 'Evento disponível offline. Scan + check-in + retirada funcionam sem net.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert('Falha ao baixar', msg)
    }
  }

  async function handleDelete() {
    if (!event) return
    Alert.alert(
      'Apagar dados offline?',
      'Os scans pendentes sem sync serão perdidos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: async () => {
            await deleteEvent(event.id)
          },
        },
      ],
    )
  }

  async function handleSync() {
    if (syncing) return
    if (online === false) {
      Alert.alert('Sem internet', 'Espere voltar online.')
      return
    }
    const res = await syncNow()
    if (res.failed > 0) {
      Alert.alert('Sync parcial', `${res.synced} OK, ${res.failed} falharam. Tente de novo.`)
    } else if (res.synced > 0) {
      Alert.alert('Sincronizado', `${res.synced} escaneamento${res.synced === 1 ? '' : 's'} enviado${res.synced === 1 ? '' : 's'}.`)
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.avatarRing}>
          <View style={styles.avatarInner}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        </View>
        <Text style={styles.name} numberOfLines={1}>{user?.name || 'Usuário'}</Text>
        <Text style={styles.email} numberOfLines={1}>{user?.email || ''}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>Staff</Text>
        </View>
      </View>

      <View style={styles.section}>
        {/* ── Offline ─────────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Modo offline</Text>

        <View style={styles.list}>
          {downloading ? (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={[styles.rowIconBox, { backgroundColor: colors.accentGreenBg, borderColor: colors.accentGreenDim }]}>
                  <ActivityIndicator size="small" color={colors.accentGreen} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {downloading.progress.message}
                  </Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${downloading.progress.percent}%` }]} />
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={handleDownload}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              disabled={!event}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.rowIconBox, { backgroundColor: colors.accentGreenBg, borderColor: colors.accentGreenDim }]}>
                  <Icon name="arrow_downward" size={20} color={colors.accentGreen} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {eventPacket ? 'Baixar novamente' : 'Baixar este evento'}
                  </Text>
                  <Text style={styles.rowSubLabel} numberOfLines={1}>
                    {!event
                      ? 'Selecione um evento primeiro'
                      : eventPacket
                        ? `${eventPacket.participantCount} participantes · ${eventPacket.itemCount} itens`
                        : 'Baixa participantes + inventário pra scan offline'}
                  </Text>
                </View>
              </View>
              <Icon name="chevron_right" size={16} color={colors.borderDefault} />
            </Pressable>
          )}

          {pending > 0 ? (
            <Pressable
              onPress={handleSync}
              disabled={syncing || online === false}
              style={({ pressed }) => [styles.row, styles.rowBorder, pressed && styles.rowPressed]}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.rowIconBox, { backgroundColor: colors.accentOrangeBg, borderColor: colors.accentOrangeBorder }]}>
                  {syncing ? (
                    <ActivityIndicator size="small" color={colors.accentOrange} />
                  ) : (
                    <Icon name="schedule" size={20} color={colors.accentOrange} />
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
                  </Text>
                  <Text style={styles.rowSubLabel} numberOfLines={1}>
                    {pending} escaneamento{pending === 1 ? '' : 's'} pendente{pending === 1 ? '' : 's'}
                  </Text>
                </View>
              </View>
              <Icon name="chevron_right" size={16} color={colors.borderDefault} />
            </Pressable>
          ) : null}

          {eventPacket ? (
            <Pressable
              onPress={handleDelete}
              style={({ pressed }) => [styles.row, styles.rowBorder, pressed && styles.rowPressed]}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.rowIconBox, { backgroundColor: colors.accentRedBg, borderColor: colors.accentRedBorder }]}>
                  <Icon name="close" size={20} color={colors.accentRed} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowLabel} numberOfLines={1}>Apagar dados offline</Text>
                  <Text style={styles.rowSubLabel} numberOfLines={1}>
                    Libera espaço. Scans pendentes são perdidos.
                  </Text>
                </View>
              </View>
              <Icon name="chevron_right" size={16} color={colors.borderDefault} />
            </Pressable>
          ) : null}
        </View>

        {/* ── Erros de sync ─────────────────────────────────────────── */}
        {failed.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              Erros de sincronização ({failed.length})
            </Text>
            <View style={styles.list}>
              {failed.map((item, i) => (
                <View
                  key={item.id}
                  style={[styles.row, i > 0 && styles.rowBorder, { alignItems: 'flex-start' }]}
                >
                  <View style={styles.rowLeft}>
                    <View
                      style={[
                        styles.rowIconBox,
                        { backgroundColor: colors.accentRedBg, borderColor: colors.accentRedBorder },
                      ]}
                    >
                      <Icon name="priority_high" size={20} color={colors.accentRed} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {ACTION_LABEL[item.type]}
                      </Text>
                      <Text style={styles.rowSubLabel} numberOfLines={2}>
                        {item.error || 'Erro desconhecido'}
                      </Text>
                      <View style={styles.retryRow}>
                        <Pressable
                          onPress={() => retryAction(item.id)}
                          disabled={online === false}
                          style={({ pressed }) => [
                            styles.retryButton,
                            pressed && styles.rowPressed,
                            online === false && { opacity: 0.5 },
                          ]}
                        >
                          <Icon name="refresh" size={13} color={colors.accentGreen} />
                          <Text style={styles.retryButtonLabel}>Tentar</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => dropAction(item.id)}
                          style={({ pressed }) => [
                            styles.dropButton,
                            pressed && styles.rowPressed,
                          ]}
                        >
                          <Icon name="close" size={13} color={colors.textTertiary} />
                          <Text style={styles.dropButtonLabel}>Descartar</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* ── Atualizações ──────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Atualizações</Text>

        <View style={styles.list}>
          <Pressable
            onPress={updateReady ? applyUpdate : checkForUpdate}
            disabled={checking}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.rowIconBox, { backgroundColor: colors.accentGreenBg, borderColor: colors.accentGreenDim }]}>
                {checking ? (
                  <ActivityIndicator size="small" color={colors.accentGreen} />
                ) : (
                  <Icon
                    name={updateReady ? 'bolt' : 'refresh'}
                    size={20}
                    color={colors.accentGreen}
                  />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {checking
                    ? 'Verificando...'
                    : updateReady
                      ? 'Aplicar agora (reiniciar app)'
                      : 'Procurar atualização'}
                </Text>
                <Text style={styles.rowSubLabel} numberOfLines={1}>
                  Canal: {CHANNEL} · bundle {UPDATE_ID}
                </Text>
              </View>
            </View>
            <Icon name="chevron_right" size={16} color={colors.borderDefault} />
          </Pressable>
        </View>

        <Pressable onPress={logout} style={styles.logoutButton}>
          <View style={styles.logoutLeft}>
            <View style={styles.logoutIconBox}>
              <Icon name="logout" size={20} color={colors.accentRed} />
            </View>
            <Text style={styles.logoutLabel}>Sair da Conta</Text>
          </View>
          <Icon name="chevron_right" size={16} color="#5C1A1A" />
        </Pressable>

        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <Icon name="bolt" size={18} color={colors.borderMuted} />
            <Text style={styles.footerBrand}>FYNEEX</Text>
          </View>
          <Text style={styles.footerVersion}>v{APP_VERSION}</Text>
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 100,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },
  avatarRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: colors.accentGreenDim,
    padding: 3,
    backgroundColor: colors.bgSurface,
    marginBottom: 16,
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    borderRadius: 44,
    backgroundColor: colors.accentGreenDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  name: {
    fontSize: 20,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    marginBottom: 4,
    textAlign: 'center',
  },
  email: {
    fontSize: 12,
    fontWeight: font.weight.medium,
    color: colors.textSecondary,
    marginBottom: 8,
    textAlign: 'center',
  },
  badge: {
    backgroundColor: colors.accentGreenBg,
    borderWidth: 1,
    borderColor: colors.accentGreenDim,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.accentGreen,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginLeft: 4,
    marginBottom: 12,
    marginTop: 12,
  },
  list: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.borderMuted,
  },
  rowPressed: {
    backgroundColor: colors.bgElevated,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  rowIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontSize: 13,
    fontWeight: font.weight.semibold,
    color: colors.textPrimary,
  },
  rowSubLabel: {
    fontSize: 10,
    fontWeight: font.weight.medium,
    color: colors.textTertiary,
    marginTop: 2,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderMuted,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accentGreen,
  },
  retryRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.accentGreenBg,
    borderWidth: 1,
    borderColor: colors.accentGreenDim,
  },
  retryButtonLabel: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.accentGreen,
  },
  dropButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  dropButtonLabel: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.textTertiary,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: '#1F1111',
    borderWidth: 1,
    borderColor: '#5C1A1A',
  },
  logoutLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 0,
  },
  logoutIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: '#2D0F0F',
    borderWidth: 1,
    borderColor: '#5C1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutLabel: {
    fontSize: 13,
    fontWeight: font.weight.bold,
    color: colors.accentRed,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 40,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  footerBrand: {
    fontSize: 15,
    fontWeight: font.weight.black,
    fontStyle: 'italic',
    color: colors.borderMuted,
    letterSpacing: -0.6,
  },
  footerVersion: {
    fontSize: 9,
    fontWeight: font.weight.medium,
    color: colors.borderDefault,
  },
})
