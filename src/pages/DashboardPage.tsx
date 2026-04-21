import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius } from '@/theme'
import { useEventStats } from '@/hooks/useEventStats'
import { formatEventDateTime } from '@/services/formatters'
import { useNavigationStore } from '@/stores/navigationStore'
import { useUserStore } from '@/stores/userStore'
import { Icon } from '@/components/Icon'

export function DashboardPage() {
  const event = useNavigationStore((s) => s.selectedEvent)
  const user = useUserStore((s) => s.user)
  const { data: statsData, isLoading: statsLoading } = useEventStats(event?.id || '')

  const stats = statsData?.stats
  const checkinRate = stats?.checkinRate ?? 0
  const stockReserved = stats?.stock?.totalReserved ?? 0
  const stockWithdrawn = stats?.stock?.totalWithdrawn ?? 0
  const stockPending = stats?.stock?.pendingWithdrawals ?? 0
  const stockTotalItems = stats?.stock?.totalItems ?? 0
  // Percentual correto: entregues sobre o total de entregas previstas
  // (reserved decrementa quando algo é retirado; reserved+withdrawn = total).
  // Antes usávamos `stats.stock.rate` do backend que fazia withdrawn/reserved,
  // o que subia artificialmente conforme reserved caía (ex: 10 de 10 "restantes"
  // = 100%, mesmo tendo só entregado 10 de 20 planejados).
  const stockTotalPlanned = stockReserved + stockWithdrawn
  const stockRate = stockTotalPlanned > 0
    ? Math.round((stockWithdrawn / stockTotalPlanned) * 100)
    : 0
  const hasStock = stockTotalItems > 0 && stockTotalPlanned > 0

  const initials = user?.name
    ? user.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')
    : '?'

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitials}>{initials}</Text>
        </View>
        <View style={styles.headerBody}>
          <Text style={styles.userName} numberOfLines={1}>{user?.name || 'Usuário'}</Text>
        </View>
        <View style={styles.staffBadge}>
          <Text style={styles.staffLabel}>Staff</Text>
        </View>
      </View>

      <EventBanner />

      <View style={styles.progressSection}>
        {statsLoading ? (
          <>
            <View style={styles.skeletonBar} />
            <View style={styles.skeletonBar} />
          </>
        ) : (
          <>
            <ProgressBar
              label="Check-in"
              value={checkinRate}
              icon="how_to_reg"
              detail={stats ? `${stats.validated} / ${stats.total}` : undefined}
              color={colors.accentGreen}
            />
            <ProgressBar
              label="Estoque entregue"
              value={stockRate}
              icon="inventory_2"
              detail={
                hasStock
                  ? `${stockWithdrawn} / ${stockTotalPlanned}${stockPending > 0 ? ` · ${stockPending} a entregar` : ''}`
                  : 'sem itens'
              }
              color={colors.accentOrange}
              muted={!hasStock}
            />
          </>
        )}
      </View>

      <View style={styles.chartSection}>
        {statsLoading ? (
          <View style={[styles.skeletonBar, { height: 200 }]} />
        ) : (
          <BarChart checkin={checkinRate} stock={stockRate} hasStock={hasStock} />
        )}
      </View>
    </ScrollView>
  )
}

function ProgressBar({
  label, value, icon, detail, color, muted,
}: {
  label: string
  value: number
  icon: string
  detail?: string
  color: string
  muted?: boolean
}) {
  return (
    <View style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <View style={styles.progressLeft}>
          <Icon name={icon} size={18} color={muted ? colors.textTertiary : colors.textSecondary} />
          <Text style={styles.progressLabel} numberOfLines={1}>{label}</Text>
        </View>
        <View style={styles.progressRight}>
          {detail ? <Text style={styles.progressDetail}>{detail}</Text> : null}
          <Text style={[styles.progressValue, muted && { color: colors.textTertiary }]}>
            {value}%
          </Text>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.min(100, Math.max(0, value))}%`,
              backgroundColor: muted ? '#3A3A3A' : color,
            },
          ]}
        />
      </View>
    </View>
  )
}

const GRID_LINES = [0, 25, 50, 75, 100]

function BarChart({
  checkin,
  stock,
  hasStock,
}: {
  checkin: number
  stock: number
  hasStock: boolean
}) {
  const bars = [
    { label: 'Check-in', value: checkin, icon: 'how_to_reg', color: colors.accentGreen, muted: false },
    { label: 'Estoque', value: stock, icon: 'inventory_2', color: colors.accentOrange, muted: !hasStock },
  ]

  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>Visão geral</Text>

      <View style={styles.chartBody}>
        <View style={styles.axis}>
          {[...GRID_LINES].reverse().map((v) => (
            <Text key={v} style={styles.axisLabel}>{v}</Text>
          ))}
        </View>

        <View style={styles.plot}>
          {GRID_LINES.map((v, i) => (
            <View
              key={v}
              style={[
                styles.gridLine,
                {
                  bottom: `${v}%`,
                  backgroundColor: i === 0 ? '#444444' : '#2A2A2A',
                },
              ]}
            />
          ))}

          <View style={styles.barsRow}>
            {bars.map((bar) => (
              <View key={bar.label} style={styles.barColumn}>
                <Text style={[styles.barValue, bar.muted && { color: colors.textTertiary }]}>
                  {bar.value}%
                </Text>
                <View
                  style={[
                    styles.bar,
                    {
                      height: `${Math.min(100, Math.max(0, bar.value))}%`,
                      backgroundColor: bar.muted ? '#3A3A3A' : bar.color,
                    },
                  ]}
                />
              </View>
            ))}
          </View>

          <View style={styles.labelsRow}>
            {bars.map((bar) => (
              <View key={bar.label} style={styles.labelColumn}>
                <Icon
                  name={bar.icon}
                  size={12}
                  color={bar.muted ? colors.textTertiary : colors.textSecondary}
                />
                <Text
                  style={[styles.barLabel, bar.muted && { color: colors.textTertiary }]}
                  numberOfLines={1}
                >
                  {bar.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  )
}

function EventBanner() {
  const event = useNavigationStore((s) => s.selectedEvent)
  const setSelectedEvent = useNavigationStore((s) => s.setSelectedEvent)
  if (!event) return null

  const isLoadable = !!event.image && /^(https?:\/\/|data:)/i.test(event.image)
  const { date, time } = formatEventDateTime(event.date, event.time)

  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
      <View style={styles.bannerCard}>
        <View style={styles.bannerImage}>
          {isLoadable ? (
            <Image source={{ uri: event.image }} style={StyleSheet.absoluteFillObject} />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, styles.bannerPlaceholder]}>
              <Icon name="event" size={48} color={colors.borderDefault} />
            </View>
          )}
          <Pressable
            onPress={() => setSelectedEvent(null)}
            accessibilityLabel="Trocar evento"
            style={styles.bannerSwap}
          >
            <Icon name="swap_horiz" size={16} color={colors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.bannerBody}>
          <Text style={styles.bannerName} numberOfLines={1}>{event.name}</Text>
          <View style={styles.bannerMeta}>
            <View style={styles.metaItem}>
              <Icon name="calendar_today" size={13} color={colors.accentGreen} />
              <Text style={styles.metaText}>{date}</Text>
            </View>
            {time ? (
              <>
                <View style={styles.metaDot} />
                <View style={styles.metaItem}>
                  <Icon name="schedule" size={13} color={colors.accentOrange} />
                  <Text style={styles.metaText}>{time}</Text>
                </View>
              </>
            ) : null}
            <View style={styles.metaDot} />
            <View style={[styles.metaItem, { flex: 1 }]}>
              <Icon name="location_on" size={13} color={colors.accentBlue} />
              <Text style={styles.metaText} numberOfLines={1}>{event.location}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.xl,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 2,
    borderColor: colors.accentGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 18,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  headerBody: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: 15,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  staffBadge: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  staffLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  progressSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 10,
  },
  skeletonBar: {
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
  },
  progressCard: {
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  progressLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  progressRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressDetail: {
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: colors.textTertiary,
  },
  progressValue: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  chartSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    height: 220,
  },
  chartCard: {
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    height: '100%',
    flex: 1,
  },
  chartTitle: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  chartBody: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  axis: {
    justifyContent: 'space-between',
    paddingBottom: 28,
  },
  axisLabel: {
    fontSize: 9,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
    width: 22,
    textAlign: 'right',
  },
  plot: {
    flex: 1,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    marginBottom: 28,
  },
  barsRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 28,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 12,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  barValue: {
    fontSize: 11,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  bar: {
    width: '70%',
    maxWidth: 80,
    minHeight: 3,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  labelsRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 28,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
  },
  labelColumn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 6,
  },
  barLabel: {
    fontSize: 10,
    fontWeight: font.weight.semibold,
    color: colors.textSecondary,
  },
  bannerCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    overflow: 'hidden',
  },
  bannerImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.bgElevated,
  },
  bannerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerSwap: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: 'rgba(13,17,23,0.85)',
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerBody: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderMuted,
  },
  bannerName: {
    fontSize: 14,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    marginBottom: 6,
  },
  bannerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: colors.textSecondary,
  },
  metaDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.borderDefault,
  },
})
