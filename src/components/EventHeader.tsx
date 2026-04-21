import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius } from '@/theme'
import { Icon } from './Icon'

interface EventHeaderProps {
  eventName: string
  caption: string
  isFetching: boolean
  onSwap: () => void
}

/**
 * Header compartilhado por CheckinPage + StockPage: botão voltar (trocar
 * evento), nome + caption, e badge "Ao Vivo" indicando polling ativo.
 */
export function EventHeader({ eventName, caption, isFetching, onSwap }: EventHeaderProps) {
  return (
    <View style={styles.root}>
      <Pressable onPress={onSwap} style={({ pressed }) => [styles.swap, pressed && styles.pressed]}>
        <Icon name="swap_horiz" size={20} color={colors.textSecondary} />
      </Pressable>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{eventName}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
      <View style={styles.live}>
        <View
          style={[
            styles.liveDot,
            { backgroundColor: isFetching ? colors.accentGreen : colors.textTertiary },
          ]}
        />
        <Text
          style={[
            styles.liveLabel,
            { color: isFetching ? colors.accentGreen : colors.textPrimary },
          ]}
        >
          Ao Vivo
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  swap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 15,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  caption: {
    fontSize: 10,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
})
