import { StyleSheet, Text, View } from 'react-native'
import { colors, font, radius } from '@/theme'

export interface Stat {
  value: number | string
  label: string
  valueColor?: string
}

/**
 * Tripla de estatísticas que aparece no topo de CheckinPage + StockPage.
 * Aceita exatamente N celas com divisores entre elas.
 */
export function StatsBar({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.root}>
      {stats.map((stat, i) => (
        <View key={stat.label} style={styles.cellWrap}>
          <View style={styles.cell}>
            <Text style={[styles.value, stat.valueColor ? { color: stat.valueColor } : null]}>
              {stat.value}
            </Text>
            <Text style={styles.label}>{stat.label}</Text>
          </View>
          {i < stats.length - 1 ? <View style={styles.divider} /> : null}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    overflow: 'hidden',
  },
  cellWrap: {
    flex: 1,
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  value: {
    fontSize: 18,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  label: {
    fontSize: 9,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  divider: {
    width: 1,
    marginVertical: 10,
    backgroundColor: colors.borderMuted,
  },
})
