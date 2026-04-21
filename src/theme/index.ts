/**
 * FYNEEX Design System — "Dark Command Center"
 * Port direto do web (celular/web-legacy/src/index.css).
 * Uso: `import { colors, spacing, radius, font, shadows } from '@/theme'`
 */

export const colors = {
  // Surfaces
  bgBase: '#111111',
  bgSurface: '#1A1A1A',
  bgElevated: '#222222',
  bgOverlay: '#2A2A2A',
  // Borders
  borderDefault: '#333333',
  borderMuted: '#2A2A2A',
  // Text
  textPrimary: '#E8E8E8',
  textSecondary: '#8A8A8A',
  textTertiary: '#555555',
  // Accents
  accentGreen: '#3FB950',
  accentGreenDim: '#238636',
  accentGreenBg: '#112211',
  accentOrange: '#D29922',
  accentOrangeBg: '#1F1A0F',
  accentOrangeBorder: '#4B3012',
  accentRed: '#F85149',
  accentRedBg: '#1F1111',
  accentRedBorder: '#5C1A1A',
  accentBlue: '#8B949E',
  accentBlueBg: '#1A1A1A',
  accentBlueBorder: '#30363D',
} as const

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const

export const font = {
  family: 'Inter',
  weight: {
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
    black: '900' as const,
  },
  size: {
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 18,
    xxl: 20,
    xxxl: 24,
    display: 32,
    hero: 40,
  },
} as const

/** Frame constants — mantidos em sincronia com StatusBar/BottomNav. */
export const frame = {
  statusBarHeight: 44,
  bottomNavHeight: 68, // safe-area adicional sai do useSafeAreaInsets
} as const

/** Cartões / listas — helpers de estilo reutilizáveis. */
export const surfaces = {
  card: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.lg,
  },
  cardInset: {
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    borderRadius: radius.lg,
  },
  listContainer: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderRadius: radius.lg,
    overflow: 'hidden' as const,
  },
  listRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderMuted,
  },
} as const

/** Badges coloridos — equivalente dos .badge-green/orange/red/blue do CSS. */
export const badges = {
  green: {
    backgroundColor: colors.accentGreenBg,
    color: colors.accentGreen,
    borderWidth: 1,
    borderColor: colors.accentGreenDim,
  },
  orange: {
    backgroundColor: colors.accentOrangeBg,
    color: colors.accentOrange,
    borderWidth: 1,
    borderColor: colors.accentOrangeBorder,
  },
  red: {
    backgroundColor: colors.accentRedBg,
    color: colors.accentRed,
    borderWidth: 1,
    borderColor: colors.accentRedBorder,
  },
  blue: {
    backgroundColor: colors.accentBlueBg,
    color: colors.accentBlue,
    borderWidth: 1,
    borderColor: colors.accentBlueBorder,
  },
} as const

export type BadgeVariant = keyof typeof badges

export const theme = { colors, radius, spacing, font, frame, surfaces, badges }
export default theme
