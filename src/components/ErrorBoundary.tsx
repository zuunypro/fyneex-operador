import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius } from '@/theme'
import { Icon } from './Icon'

interface Props {
  children: ReactNode
  /** Optional custom label shown above the retry button. */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * Catches render-time exceptions so one bad row does not tear down the
 * entire check-in/stock screen while an event is live. Reset re-mounts
 * children; pairing with React Query makes the retry a cheap cache hit.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== 'undefined') {
      console.error('[ErrorBoundary]', error, info?.componentStack)
    }
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <View accessibilityRole="alert" style={styles.root}>
        <Icon name="error" size={44} color={colors.accentRed} />
        <Text style={styles.title}>
          {this.props.label || 'Algo deu errado nesta tela'}
        </Text>
        <Text style={styles.message}>
          {this.state.error.message || 'Erro inesperado. Tente novamente.'}
        </Text>
        <Pressable onPress={this.handleReset} style={styles.button}>
          <Text style={styles.buttonLabel}>Tentar novamente</Text>
        </Pressable>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 400,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  message: {
    fontSize: 12,
    fontWeight: font.weight.medium,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  button: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 1,
    borderColor: colors.accentGreen,
  },
  buttonLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
})
