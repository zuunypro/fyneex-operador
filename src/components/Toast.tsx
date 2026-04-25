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

  // 'info' = neutro (ação já processada). Azul/amarelo discreto pra não
  // confundir com "✓ feito agora" (verde) nem com erro (vermelho).
  const variant = toast.type
  const bg =
    variant === 'success' ? '#0D2818'
    : variant === 'info' ? '#1B2433'
    : '#2A0A0A'
  const border =
    variant === 'success' ? colors.accentGreenDim
    : variant === 'info' ? '#2A3E5A'
    : '#4A1A1A'
  const textColor =
    variant === 'success' ? colors.accentGreen
    : variant === 'info' ? '#79B8FF'
    : colors.accentRed
  const iconName =
    variant === 'success' ? 'check_circle'
    : variant === 'info' ? 'info'
    : 'error'

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion={variant === 'error' ? 'assertive' : 'polite'}
      style={styles.root}
    >
      <View style={[styles.card, { backgroundColor: bg, borderColor: border }]}>
        <Icon
          name={iconName}
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
