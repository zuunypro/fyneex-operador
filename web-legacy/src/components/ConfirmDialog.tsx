import { useEffect } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'neutral'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Themed replacement for window.confirm. Lives in the same dark visual
 * language as the rest of the scanner UI and plays well with the APK
 * WebView (native confirm on some Android WebViews shows a jarring white
 * sheet). Handles Escape to cancel and backdrop click to cancel.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'neutral',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const danger = tone === 'danger'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: 16,
        paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420,
          background: '#161616',
          borderRadius: 18,
          border: '1px solid #2A2A2A',
          padding: 18,
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
          animation: 'confirm-dialog-in 0.18s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: danger ? '#2A1414' : '#1E2A3E',
            border: `1px solid ${danger ? '#4A1A1A' : '#2A3E5A'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20, color: danger ? '#F85149' : '#79B8FF' }}
            >
              {danger ? 'warning' : 'help'}
            </span>
          </div>
          <h2
            id="confirm-dialog-title"
            style={{ fontSize: 15, fontWeight: 800, color: '#E8E8E8', flex: 1, minWidth: 0 }}
          >
            {title}
          </h2>
        </div>

        {description && (
          <p style={{
            fontSize: 13, fontWeight: 500, color: '#B0B0B0',
            lineHeight: 1.4, margin: '4px 0 14px',
            whiteSpace: 'pre-line',
          }}>
            {description}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            className="pressable"
            style={{
              flex: 1, height: 42, borderRadius: 10,
              background: '#1A1A1A', border: '1px solid #333333',
              fontSize: 13, fontWeight: 700, color: '#E8E8E8',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="pressable"
            style={{
              flex: 1, height: 42, borderRadius: 10,
              background: danger ? '#2A1414' : '#238636',
              border: `1px solid ${danger ? '#4A1A1A' : '#3FB950'}`,
              fontSize: 13, fontWeight: 800,
              color: danger ? '#F85149' : '#E8E8E8',
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes confirm-dialog-in {
          from { transform: translateY(14px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
