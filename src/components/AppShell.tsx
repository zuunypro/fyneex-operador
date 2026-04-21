import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '@/theme'
import { BottomNav } from './BottomNav'
import { OfflineBanner } from './OfflineBanner'

/**
 * Casco do app dentro das tabs. StatusBar nativa é desenhada pelo Expo;
 * aqui só garantimos background dark, safe-area, banner de offline/sync, e
 * BottomNav fixo.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <OfflineBanner />
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
