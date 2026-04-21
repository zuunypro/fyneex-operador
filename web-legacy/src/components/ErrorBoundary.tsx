import { Component, type ErrorInfo, type ReactNode } from 'react'

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
 * entire check-in/stock screen while an event is live. Resetting simply
 * re-mounts the children; pairing with React Query means the retry is a
 * cheap cache hit in most cases.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== 'undefined') {
      // Keep the trace in the console so the operator can send it to support.
      console.error('[ErrorBoundary]', error, info?.componentStack)
    }
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div
        role="alert"
        style={{
          minHeight: '60dvh',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 24, textAlign: 'center', gap: 10,
        }}
      >
        <span
          className="material-symbols-outlined icon-filled"
          style={{ fontSize: 44, color: '#F85149' }}
        >
          error
        </span>
        <p style={{ fontSize: 15, fontWeight: 800, color: '#E8E8E8' }}>
          {this.props.label || 'Algo deu errado nesta tela'}
        </p>
        <p style={{ fontSize: 12, fontWeight: 500, color: '#8A8A8A', maxWidth: 320 }}>
          {this.state.error.message || 'Erro inesperado. Tente novamente.'}
        </p>
        <button
          onClick={this.handleReset}
          className="pressable"
          style={{
            marginTop: 6, padding: '10px 20px', borderRadius: 10,
            background: '#238636', border: '1px solid #3FB950',
            fontSize: 12, fontWeight: 700, color: '#E8E8E8', cursor: 'pointer',
          }}
        >
          Tentar novamente
        </button>
      </div>
    )
  }
}
