import { useEffect } from 'react'
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, font, radius } from '@/theme'
import { ApiError } from '@/services/api'
import { formatEventDateTime } from '@/services/formatters'
import { useEvents, type MobileEvent } from '@/hooks/useEvents'
import { useNavigationStore, type EventInfo } from '@/stores/navigationStore'
import { Icon } from '@/components/Icon'

function toEventInfo(ev: MobileEvent): EventInfo {
  return {
    id: ev.id,
    name: ev.name,
    date: ev.date,
    time: ev.time,
    location: ev.location,
    image: ev.image,
    participants: ev.participantsCount,
  }
}

// Defense-in-depth: server pode mandar caminho relativo — só aceita absoluto.
function isLoadableImage(src: string | null | undefined): src is string {
  return !!src && /^(https?:\/\/|data:)/i.test(src)
}

export function EventSelectorPage() {
  const setSelectedEvent = useNavigationStore((s) => s.setSelectedEvent)
  const logout = useNavigationStore((s) => s.logout)
  const { data, isLoading, isError, error, refetch, isFetching } = useEvents()

  useEffect(() => {
    if (isError && error instanceof ApiError && error.status === 401) {
      logout()
    }
  }, [isError, error, logout])

  const events = data?.events || []

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            tintColor={colors.accentGreen}
            colors={[colors.accentGreen]}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Icon name="bolt" size={24} color={colors.accentGreen} />
            <Text style={styles.brandLabel}>FYNEEX</Text>
          </View>
          <Text style={styles.title}>Escolha o Evento</Text>
          <Text style={styles.subtitle}>Selecione um evento para continuar</Text>
        </View>

        <View style={styles.list}>
          {isLoading &&
            [0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonCard}>
                <View style={styles.skeletonImage} />
                <View style={styles.skeletonBody}>
                  <View style={styles.skeletonLineL} />
                  <View style={styles.skeletonLineS} />
                </View>
              </View>
            ))}

          {isError && (error as ApiError)?.status !== 401 && (
            <View style={styles.errorCard}>
              <Icon name="wifi_off" size={36} color={colors.accentRed} />
              <Text style={styles.errorTitle}>Erro ao carregar eventos</Text>
              <Text style={styles.errorMessage}>
                {(error as ApiError)?.message || String(error)}
              </Text>
              <Text style={styles.errorStatus}>
                Status: {(error as ApiError)?.status ?? 'sem resposta'}
              </Text>
              <View style={styles.errorActions}>
                <Pressable onPress={() => refetch()} style={styles.retryButton}>
                  <Text style={styles.retryLabel}>Tentar novamente</Text>
                </Pressable>
                <Pressable onPress={() => logout()} style={styles.logoutButton}>
                  <Text style={styles.logoutLabel}>Sair</Text>
                </Pressable>
              </View>
            </View>
          )}

          {!isLoading && !isError && events.length === 0 && (
            <View style={styles.emptyCard}>
              <Icon name="event_busy" size={48} color={colors.borderDefault} />
              <Text style={styles.emptyLabel}>Nenhum evento encontrado</Text>
            </View>
          )}

          {!isLoading &&
            events.map((ev) => {
              const { date: fDate, time: fTime } = formatEventDateTime(ev.date, ev.time)
              return (
                <Pressable
                  key={ev.id}
                  onPress={() => setSelectedEvent(toEventInfo(ev))}
                  style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                >
                  <View style={styles.cardImageWrap}>
                    {isLoadableImage(ev.image) ? (
                      <Image source={{ uri: ev.image }} style={styles.cardImage} />
                    ) : (
                      <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
                        <Icon name="image" size={48} color={colors.borderDefault} />
                      </View>
                    )}
                    <View style={styles.participantsBadge}>
                      <Icon name="group" size={14} color={colors.accentGreen} />
                      <Text style={styles.participantsCount}>{ev.participantsCount}</Text>
                    </View>
                    {ev.status && ev.status !== 'published' ? (
                      <View style={styles.statusBadge}>
                        <Text
                          style={[
                            styles.statusLabel,
                            {
                              color:
                                ev.status === 'draft' ? colors.accentOrange : colors.textSecondary,
                            },
                          ]}
                        >
                          {ev.status === 'draft' ? 'Rascunho' : ev.status}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{ev.name}</Text>
                    <View style={styles.metaRow}>
                      <View style={styles.metaItem}>
                        <Icon name="calendar_today" size={15} color={colors.accentGreen} />
                        <Text style={styles.metaText}>{fDate}</Text>
                      </View>
                      {fTime ? (
                        <>
                          <View style={styles.metaDot} />
                          <View style={styles.metaItem}>
                            <Icon name="schedule" size={15} color={colors.accentOrange} />
                            <Text style={styles.metaText}>{fTime}</Text>
                          </View>
                        </>
                      ) : null}
                      <View style={styles.metaDot} />
                      <View style={[styles.metaItem, { flex: 1 }]}>
                        <Icon name="location_on" size={15} color={colors.accentBlue} />
                        <Text style={styles.metaText} numberOfLines={1}>{ev.location}</Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
              )
            })}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  scroll: {
    paddingBottom: 40,
  },
  header: {
    padding: 20,
    paddingTop: 20,
    paddingBottom: 8,
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  brandLabel: {
    fontSize: 18,
    fontWeight: font.weight.black,
    letterSpacing: -0.8,
    fontStyle: 'italic',
    color: colors.textPrimary,
  },
  title: {
    fontSize: 20,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: font.weight.medium,
    color: colors.textSecondary,
  },
  list: {
    padding: 20,
    gap: 16,
  },
  skeletonCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    overflow: 'hidden',
  },
  skeletonImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.bgElevated,
  },
  skeletonBody: {
    padding: 14,
    gap: 8,
  },
  skeletonLineL: {
    height: 16,
    width: '60%',
    borderRadius: radius.sm,
    backgroundColor: '#252525',
  },
  skeletonLineS: {
    height: 12,
    width: '40%',
    borderRadius: radius.sm,
    backgroundColor: '#202020',
  },
  errorCard: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    gap: 8,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: font.weight.semibold,
    color: colors.textPrimary,
  },
  errorMessage: {
    fontSize: 12,
    fontWeight: font.weight.medium,
    color: colors.accentRed,
    textAlign: 'center',
  },
  errorStatus: {
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 10,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 1,
    borderColor: colors.accentGreen,
  },
  retryLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  logoutButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.textTertiary,
  },
  logoutLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
  },
  emptyCard: {
    padding: 60,
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    gap: 12,
  },
  emptyLabel: {
    fontSize: 14,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
  },
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    overflow: 'hidden',
  },
  cardPressed: {
    transform: [{ scale: 0.985 }],
    borderColor: colors.textTertiary,
  },
  cardImageWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: 16 / 9,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardImagePlaceholder: {
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantsBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: 'rgba(13,17,23,0.85)',
    borderWidth: 1,
    borderColor: colors.accentGreenDim,
  },
  participantsCount: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.accentGreen,
  },
  statusBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(13,17,23,0.85)',
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    textTransform: 'uppercase',
  },
  cardBody: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderDefault,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: colors.textSecondary,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.borderDefault,
  },
})
