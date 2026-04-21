import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius } from '@/theme'
import { useNavigationStore } from '@/stores/navigationStore'
import { useUserStore } from '@/stores/userStore'
import { Icon } from '@/components/Icon'

type BadgeTone = 'green' | 'orange' | 'blue'

const APP_VERSION = (Constants.expoConfig?.version as string | undefined) || '1.0.0'

// Defensivo: acessar Updates.channel/updateId pode lançar em builds onde o
// native module não está pronto (ex: release builds antes do primeiro fetch).
// Embrulha em try/catch pra não quebrar o import do módulo.
function safeString(getter: () => string | null | undefined, fallback: string): string {
  try { return getter() || fallback } catch { return fallback }
}
const CHANNEL = safeString(() => Updates.channel, 'dev')
const UPDATE_ID = safeString(() => (Updates.updateId || '').slice(0, 8), '—')

export function ProfilePage() {
  const user = useUserStore((s) => s.user)
  const logout = useNavigationStore((s) => s.logout)
  const [checking, setChecking] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)

  const initials = user?.name
    ? user.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')
    : '?'

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
          'Uma nova versão foi baixada. Toque em "Aplicar agora" para reiniciar o app na versão nova.',
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
        <Text style={styles.sectionTitle}>Conta</Text>

        <View style={styles.list}>
          <SettingRow icon="manage_accounts" badge="green" label="Configurações da Conta" />
          <SettingRow icon="notifications_active" badge="blue" label="Notificações" />
          <SettingRow icon="shield" badge="orange" label="Privacidade e Segurança" last />
        </View>

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

function SettingRow({
  icon,
  badge,
  label,
  last,
}: {
  icon: string
  badge: BadgeTone
  label: string
  last?: boolean
}) {
  const theme = BADGE_COLORS[badge]
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowBorder,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.rowIconBox, { backgroundColor: theme.bg, borderColor: theme.border }]}>
          <Icon name={icon} size={20} color={theme.color} />
        </View>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Icon name="chevron_right" size={16} color={colors.borderDefault} />
    </Pressable>
  )
}

const BADGE_COLORS: Record<BadgeTone, { bg: string; color: string; border: string }> = {
  green: { bg: colors.accentGreenBg, color: colors.accentGreen, border: colors.accentGreenDim },
  orange: { bg: colors.accentOrangeBg, color: colors.accentOrange, border: colors.accentOrangeBorder },
  blue: { bg: colors.accentBlueBg, color: colors.accentBlue, border: colors.borderDefault },
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
    borderBottomWidth: 1,
    borderBottomColor: colors.borderMuted,
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
    flex: 1,
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
