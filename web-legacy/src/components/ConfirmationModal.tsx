import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { MobileParticipant } from '../hooks/useParticipants'

interface ConfirmationModalProps {
  participant: MobileParticipant
  /** Optional observation textarea — when omitted (Stock), no input is shown. */
  obsText?: string
  onObsChange?: (next: string) => void
  obsMaxLength?: number
  obsPlaceholder?: string
  obsLabel?: string
  /** Layout for instance fields: grid (Check-in) or stacked rows (Stock kit list). */
  fieldsLayout?: 'grid' | 'rows'
  /** Maximum number of instance fields to show; surplus is hinted as "+N more". */
  fieldsLimit?: number
  /** Caption above the fields block. */
  fieldsTitle?: string
  /** Strip rows whose label matches this regex (e.g. /nome/i for the participant name). */
  fieldsExcludeLabelRegex?: RegExp
  confirmLabel: string
  confirmIcon?: ReactNode
  submitting?: boolean
  onConfirm: () => void
  onClose: () => void
  /** Read-only mode: shows a banner saying the QR was already scanned and hides
   *  the observation textarea + Confirm button. Cancel turns into "Fechar". */
  alreadyScanned?: boolean
  alreadyScannedMessage?: string
  alreadyScannedDetail?: string
}

export function ConfirmationModal({
  participant: p,
  obsText,
  onObsChange,
  obsMaxLength = 500,
  obsPlaceholder = 'Ex: chegou atrasado, uniforme diferente...',
  obsLabel = 'Observação (opcional)',
  fieldsLayout = 'grid',
  fieldsLimit = 6,
  fieldsTitle,
  fieldsExcludeLabelRegex,
  confirmLabel,
  confirmIcon,
  submitting = false,
  onConfirm,
  onClose,
  alreadyScanned = false,
  alreadyScannedMessage = 'Este QR já foi escaneado',
  alreadyScannedDetail,
}: ConfirmationModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const showObs = !alreadyScanned && typeof obsText === 'string' && typeof onObsChange === 'function'

  useEffect(() => {
    lastFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      lastFocusRef.current?.focus?.()
    }
  }, [onClose])

  const allFields = (p.instanceFields || []).filter((f) =>
    fieldsExcludeLabelRegex ? !fieldsExcludeLabelRegex.test(f.label) : true,
  )
  const visibleFields = allFields.slice(0, fieldsLimit)
  const hiddenCount = Math.max(0, allFields.length - visibleFields.length)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
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
          width: '100%', maxWidth: 340, borderRadius: 16,
          background: '#1A1A1A', border: '1px solid #333333',
          padding: 20, outline: 'none',
        }}
      >
        {/* Already-scanned banner */}
        {alreadyScanned && (
          <div
            role="alert"
            style={{
              marginBottom: 14, padding: '10px 12px', borderRadius: 10,
              background: '#3A2A0D', border: '1px solid #6B4A1A',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}
          >
            <span className="material-symbols-outlined icon-filled" style={{
              fontSize: 20, color: '#D29922', flexShrink: 0, marginTop: 1,
            }}>
              error
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#F0C674', marginBottom: 2 }}>
                {alreadyScannedMessage}
              </p>
              {alreadyScannedDetail && (
                <p style={{ fontSize: 11, fontWeight: 500, color: '#B89660' }}>
                  {alreadyScannedDetail}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Participant info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: '#222222', border: '1px solid #333333',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 800, color: '#E8E8E8', flexShrink: 0,
          }}>
            {p.initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p id={titleId} style={{
              fontSize: 15, fontWeight: 700, color: '#E8E8E8', marginBottom: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {p.name}
            </p>
            <p style={{
              fontSize: 11, fontWeight: 500, color: '#555555',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {p.orderNumber} · {p.category}
              {p.instanceLabel ? ` · ${p.instanceLabel}` : ''}
            </p>
          </div>
        </div>

        {/* Fields block */}
        {visibleFields.length > 0 && (
          <div style={{
            marginBottom: 16, padding: 10, borderRadius: 10,
            background: '#111111', border: '1px solid #2A2A2A',
          }}>
            {fieldsTitle && (
              <p style={{
                fontSize: 10, fontWeight: 700, color: '#8A8A8A',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
              }}>
                {fieldsTitle}
              </p>
            )}
            {fieldsLayout === 'grid' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 10px' }}>
                {visibleFields.map((f) => (
                  <div key={f.label} style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 9, fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {f.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#B0B0B0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleFields.map((f) => (
                  <div key={f.label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#8A8A8A', flexShrink: 0 }}>
                      {f.label}
                    </span>
                    <span style={{
                      fontSize: 13, fontWeight: 700, color: '#E8E8E8', textAlign: 'right',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                    }}>
                      {f.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {hiddenCount > 0 && (
              <p style={{
                marginTop: 8, fontSize: 10, fontWeight: 600, color: '#555555',
                textAlign: 'center',
              }}>
                +{hiddenCount} {hiddenCount === 1 ? 'campo adicional' : 'campos adicionais'}
              </p>
            )}
          </div>
        )}

        {/* Observation textarea */}
        {showObs && (
          <>
            <label style={{
              fontSize: 11, fontWeight: 700, color: '#8A8A8A',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              marginBottom: 8, display: 'block',
            }}>
              {obsLabel}
            </label>
            <textarea
              placeholder={obsPlaceholder}
              value={obsText}
              onChange={(e) => onObsChange?.(e.target.value)}
              rows={3}
              maxLength={obsMaxLength}
              style={{
                width: '100%', borderRadius: 10, padding: 12,
                background: '#111111', border: '1px solid #333333',
                fontSize: 16, fontWeight: 500, color: '#E8E8E8',
                fontFamily: 'inherit', outline: 'none', resize: 'none',
                boxSizing: 'border-box',
              }}
            />
          </>
        )}

        {/* Confirm (hidden when already scanned) */}
        {!alreadyScanned && (
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="pressable"
            style={{
              width: '100%', height: 46, borderRadius: 10, marginTop: 16,
              background: '#238636', border: '1px solid #3FB950',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 700, color: '#E8E8E8',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? (
              <div style={{
                width: 14, height: 14, borderRadius: '50%',
                border: '2px solid #2A4A2A', borderTopColor: '#E8E8E8',
                animation: 'spin 0.7s linear infinite',
              }} />
            ) : confirmIcon}
            {confirmLabel}
          </button>
        )}

        <button
          onClick={onClose}
          className="pressable"
          style={alreadyScanned ? {
            width: '100%', height: 46, borderRadius: 10, marginTop: 16,
            background: '#1E1E1E', border: '1px solid #333333',
            cursor: 'pointer', fontSize: 14, fontWeight: 700, color: '#E8E8E8',
          } : {
            width: '100%', height: 38, borderRadius: 10, marginTop: 8,
            background: 'transparent', border: 'none',
            cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#555555',
          }}
        >
          {alreadyScanned ? 'Fechar' : 'Cancelar'}
        </button>
      </div>
    </div>
  )
}
