import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/theme'
import { BottomNav } from './BottomNav'

/**
 * Casco do app dentro das tabs. A StatusBar nativa já é desenhada pelo Expo
 * (expo-status-bar ajusta translucent no App.tsx); aqui só garantimos o
 * background dark e a safe-area dos dois lados + o BottomNav fixo.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.content}>{children}</View>
      <BottomNav />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  content: {
    flex: 1,
  },
})
