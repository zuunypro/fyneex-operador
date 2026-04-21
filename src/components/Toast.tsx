import { StyleSheet, Text, View } from 'react-native'
import { colors, font, radius } from '@/theme'
import { Icon } from './Icon'
import type { Toast as ToastData } from '@/hooks/useToast'

/**
 * Banner de toast fixado na parte inferior da tela. Substitui o div inline
 * que as páginas do web renderizavam. Passe `null` pra esconder.
 */
export function Toast({ toast }: { toast: ToastData | null }) {
  if (!toast) return null

  const success = toast.type === 'success'
  const bg = success ? '#0D2818' : '#2A0A0A'
  const border = success ? colors.accentGreenDim : '#4A1A1A'
  const textColor = success ? colors.accentGreen : colors.accentRed

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion={success ? 'polite' : 'assertive'}
      style={styles.root}
    >
      <View style={[styles.card, { backgroundColor: bg, borderColor: border }]}>
        <Icon
          name={success ? 'check_circle' : 'error'}
          size={20}
          color={textColor}
        />
        <Text style={[styles.message, { color: textColor }]} numberOfLines={3}>
          {toast.message}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 90,
    alignItems: 'center',
    zIndex: 200,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: radius.lg,
    maxWidth: 420,
    width: '100%',
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontWeight: font.weight.bold,
  },
})
