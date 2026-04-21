import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigationStore, type TabId } from '@/stores/navigationStore'
import { colors, font, radius } from '@/theme'
import { Icon } from './Icon'

const tabs: { id: TabId; icon: string; label: string }[] = [
  { id: 'dashboard', icon: 'grid_view', label: 'Início' },
  { id: 'checkin', icon: 'how_to_reg', label: 'Check-in' },
  { id: 'stock', icon: 'inventory_2', label: 'Estoque' },
  { id: 'profile', icon: 'person', label: 'Perfil' },
]

export function BottomNav() {
  const activeTab = useNavigationStore((s) => s.activeTab)
  const setActiveTab = useNavigationStore((s) => s.setActiveTab)
  const insets = useSafeAreaInsets()

  return (
    <View
      accessibilityLabel="Navegação principal"
      style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 4) }]}
    >
      <View style={styles.inner}>
        {tabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={styles.tab}
              hitSlop={4}
            >
              {active && <View style={styles.indicator} />}
              <Icon
                name={tab.icon}
                size={22}
                color={active ? colors.accentGreen : colors.textTertiary}
              />
              <Text style={[styles.label, active && styles.labelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  nav: {
    backgroundColor: colors.bgSurface,
    borderTopWidth: 1,
    borderTopColor: colors.borderDefault,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxWidth: 430,
    alignSelf: 'center',
    width: '100%',
  },
  tab: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 8,
    minHeight: 48,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: -6,
    width: 20,
    height: 3,
    borderRadius: radius.xs / 2,
    backgroundColor: colors.accentGreen,
  },
  label: {
    fontSize: 9,
    fontWeight: font.weight.bold,
    letterSpacing: 0.5,
    color: colors.textTertiary,
    textTransform: 'uppercase',
  },
  labelActive: {
    color: colors.accentGreen,
  },
})
