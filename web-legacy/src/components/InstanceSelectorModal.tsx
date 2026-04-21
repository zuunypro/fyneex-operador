import { useEffect, useId, useRef } from 'react'
import type { MobileParticipant } from '../hooks/useParticipants'

interface InstanceSelectorModalProps {
  /** Pending instances of the same orderItem returned by a single QR scan. */
  candidates: MobileParticipant[]
  title?: string
  subtitle?: string
  onPick: (participant: MobileParticipant) => void
  onClose: () => void
}

/**
 * Shown after a QR scan that lands on a multi-instance order_item where more
 * than one instance is still pending. The QR currently encodes only the
 * order_item id, so the operator has to disambiguate which person at the
 * counter the kit/check-in is for.
 */
export function InstanceSelectorModal({
  candidates,
  title = 'Selecione o ingresso',
  subtitle,
  onPick,
  onClose,
}: InstanceSelectorModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    lastFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus into the dialog so screen readers announce it.
    dialogRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      lastFocusRef.current?.focus?.()
    }
  }, [onClose])

  const orderNumber = candidates[0]?.orderNumber || ''
  const total = candidates[0]?.instanceTotal

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 110,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 360, maxHeight: '80dvh',
          borderRadius: 16, background: '#1A1A1A', border: '1px solid #333333',
          display: 'flex', flexDirection: 'column', outline: 'none',
        }}
      >
        <div style={{ padding: '18px 20px 8px' }}>
          <h2 id={titleId} style={{ fontSize: 15, fontWeight: 800, color: '#E8E8E8', marginBottom: 4 }}>
            {title}
          </h2>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#8A8A8A' }}>
            {subtitle || `Pedido ${orderNumber}${total ? ` · ${candidates.length} pendentes de ${total}` : ''}`}
          </p>
        </div>

        <div className="thin-scrollbar" style={{ overflowY: 'auto', padding: '4px 12px 12px' }}>
          {candidates.map((p) => {
            const nameField = p.instanceFields?.find((f) => /nome/i.test(f.label))
            const idField = p.instanceFields?.find((f) => /cpf|rg|documento/i.test(f.label))
            return (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="pressable"
                style={{
                  width: '100%', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 10, marginBottom: 6,
                  background: '#222222', border: '1px solid #2F2F2F', cursor: 'pointer',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: '#1A1A1A', border: '1px solid #333333',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, color: '#E8E8E8',
                }}>
                  #{p.instanceIndex ?? '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontSize: 13, fontWeight: 700, color: '#E8E8E8',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {nameField?.value || p.name}
                  </p>
                  <p style={{
                    fontSize: 10, fontWeight: 500, color: '#8A8A8A',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.instanceLabel || `Ingresso ${p.instanceIndex}`}{idField ? ` · ${idField.value}` : ''}
                  </p>
                </div>
                <span className="material-symbols-outlined" style={{ color: '#555555', fontSize: 18 }}>
                  chevron_right
                </span>
              </button>
            )
          })}
        </div>

        <button
          onClick={onClose}
          className="pressable"
          style={{
            margin: '0 12px 12px', height: 40, borderRadius: 10,
            background: 'transparent', border: '1px solid #2F2F2F',
            cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#8A8A8A',
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
