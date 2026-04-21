import { useEffect, useRef, useState, useCallback } from 'react'
import jsQR from 'jsqr'
import { feedbackBad, feedbackOk, primeAudio } from '../utils/feedback'

export interface ScannedToken {
  /** order_item id extracted from the QR (the "oi" field of a fyx token, or raw id). */
  participantId: string
  /** event id extracted from the QR ("eid"). Undefined when the QR is a legacy raw id. */
  eventId?: string
  /** The raw text read from the QR code. */
  raw: string
}

interface QRScannerProps {
  /** Event the operator is currently working with. Scans for other events are rejected. */
  expectedEventId: string
  title: string
  subtitle?: string
  onScan: (token: ScannedToken) => void
  onClose: () => void
  /** When true, keeps the camera running after each scan so the operator can
   *  blast through a queue without reopening the modal. Duplicates within a
   *  short window are suppressed automatically. Defaults to false. */
  continuous?: boolean
  /** Fires when the operator toggles the continuous chip. Parent owns the
   *  state so it can adjust onScan behaviour (e.g. skip modal when on). */
  onContinuousChange?: (next: boolean) => void
  /** Optional status hint shown at the top in continuous mode (e.g. "3 lidos"). */
  statusHint?: string
}

/* ── Token parsing ────────────────────────────────────────────────────────
 * The site encodes QRs as  "fyx.{base64url_payload}.{base64url_hmac}"
 * The payload is JSON  { oi: order_item_id, eid: event_id, ts?: number }
 * We decode client-side to extract oi/eid; the HMAC is re-verified implicitly
 * by the mobile check-in endpoint (which enforces organizer → event ownership).
 */
function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4
  const fixed = pad === 0 ? padded : padded + '='.repeat(4 - pad)
  return atob(fixed)
}

export function parseFyneexQrToken(raw: string): ScannedToken | null {
  if (!raw) return null
  const trimmed = raw.trim()

  // fyx.x.y  →  signed token
  if (trimmed.startsWith('fyx.')) {
    const parts = trimmed.split('.')
    if (parts.length !== 3) return null
    try {
      const json = base64UrlDecode(parts[1])
      const payload = JSON.parse(json) as { oi?: string; eid?: string }
      if (!payload.oi || !payload.eid) return null
      return { participantId: payload.oi, eventId: payload.eid, raw: trimmed }
    } catch {
      return null
    }
  }

  // Legacy raw order_item id (UUID or FYNI_...) — accepted as best-effort.
  if (/^[A-Za-z0-9_-]{8,}$/.test(trimmed)) {
    return { participantId: trimmed, raw: trimmed }
  }

  return null
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?(): Promise<string[]>
}

// How long (ms) to ignore the same raw payload after a successful scan in
// continuous mode. Prevents a QR held in front of the camera from firing
// onScan dozens of times per second.
const CONTINUOUS_DEDUPE_MS = 2500
// Cooldown between distinct scans so onScan handlers have room to queue
// without being overwhelmed. Also the visual flash window.
const CONTINUOUS_COOLDOWN_MS = 400

export function QRScanner({
  expectedEventId,
  title,
  subtitle,
  onScan,
  onClose,
  continuous = false,
  onContinuousChange,
  statusHint,
}: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const detectorRef = useRef<BarcodeDetectorLike | null>(null)
  const scannedRef = useRef(false)
  const lastRawRef = useRef<{ raw: string; at: number } | null>(null)
  const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onScanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [status, setStatus] = useState<'starting' | 'scanning' | 'denied' | 'unsupported' | 'error'>('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null)
  const [manualInput, setManualInput] = useState('')
  const [showManual, setShowManual] = useState(false)

  // Prime AudioContext on mount (the button tap that opened the scanner is
  // the user gesture that unlocks audio on iOS).
  useEffect(() => { primeAudio() }, [])

  const handleDetected = useCallback((raw: string) => {
    if (scannedRef.current) return

    // Dedupe identical payloads within the window in continuous mode. In
    // one-shot mode we never get here twice anyway.
    if (continuous && lastRawRef.current) {
      const { raw: lastRaw, at } = lastRawRef.current
      if (lastRaw === raw && performance.now() - at < CONTINUOUS_DEDUPE_MS) {
        return
      }
    }

    const parsed = parseFyneexQrToken(raw)
    if (!parsed) {
      setFlash('bad')
      feedbackBad()
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
      flashTimeoutRef.current = setTimeout(() => setFlash(null), 500)
      return
    }
    if (parsed.eventId && parsed.eventId !== expectedEventId) {
      setFlash('bad')
      feedbackBad()
      setErrorMsg('QR de outro evento')
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
      flashTimeoutRef.current = setTimeout(() => setFlash(null), 500)
      if (errorClearRef.current) clearTimeout(errorClearRef.current)
      errorClearRef.current = setTimeout(() => setErrorMsg(''), 1500)
      return
    }

    scannedRef.current = true
    lastRawRef.current = { raw, at: performance.now() }
    setFlash('ok')
    feedbackOk()

    if (onScanTimeoutRef.current) clearTimeout(onScanTimeoutRef.current)
    onScanTimeoutRef.current = setTimeout(() => onScan(parsed), 180)

    if (continuous) {
      // Release the lock after the cooldown so the loop keeps scanning.
      if (cooldownTimeoutRef.current) clearTimeout(cooldownTimeoutRef.current)
      cooldownTimeoutRef.current = setTimeout(() => {
        scannedRef.current = false
        setFlash(null)
      }, CONTINUOUS_COOLDOWN_MS)
    }
  }, [expectedEventId, onScan, continuous])

  // ── Camera lifecycle ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported')
        setErrorMsg('Câmera não suportada neste dispositivo')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
        // Ask the track for continuous autofocus if it exposes focusMode —
        // many Androids default to a fixed focus that never locks on a QR
        // inside the viewfinder. Silently ignore when unsupported.
        try {
          const [track] = stream.getVideoTracks()
          const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[] }
          if (caps.focusMode?.includes('continuous')) {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' }],
            } as unknown as MediaTrackConstraints)
          }
        } catch { /* focusMode not supported — camera auto behaviour still works */ }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          video.setAttribute('playsinline', 'true')
          await video.play().catch(() => { /* autoplay blocked — user tap still works */ })
        }

        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
        if (Detector) {
          try {
            const supported = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : []
            if (!supported.length || supported.includes('qr_code')) {
              detectorRef.current = new Detector({ formats: ['qr_code'] })
            }
          } catch {
            detectorRef.current = null
          }
        }

        setStatus('scanning')
        loop()
      } catch (err) {
        if (cancelled) return
        const e = err as DOMException
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
          setStatus('denied')
          setErrorMsg('Permissão de câmera negada')
        } else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
          setStatus('unsupported')
          setErrorMsg('Nenhuma câmera disponível')
        } else {
          setStatus('error')
          setErrorMsg(e?.message || 'Erro ao abrir a câmera')
        }
      }
    }

    let lastScanAt = 0
    // Alternate jsQR between a centre crop (boosts far/small QRs) and the
    // full frame (boosts close-up QRs whose finder patterns spill past the
    // crop bounds). Even frames → crop, odd frames → full frame.
    let frameTick = 0
    async function loop() {
      if (cancelled) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }
      // Throttle to ~10fps — QR detection is expensive and we don't need every frame.
      const now = performance.now()
      if (now - lastScanAt < 100) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }
      lastScanAt = now

      // During the cooldown window in continuous mode we intentionally skip
      // detection to let the operator move to the next ticket without the
      // previous QR firing again.
      if (scannedRef.current) {
        rafRef.current = requestAnimationFrame(loop)
        return
      }

      try {
        const w = video.videoWidth
        const h = video.videoHeight
        if (w && h) {
          const detector = detectorRef.current
          if (detector) {
            const results = await detector.detect(video).catch(() => [])
            if (results && results.length > 0 && results[0].rawValue) {
              handleDetected(results[0].rawValue)
            }
          } else {
            // jsQR path — alternate between two passes:
            //   • crop: centre 80% → digital zoom for far/small QRs
            //   • full: entire frame → keeps finder patterns visible when
            //     the user holds the phone right on top of the ticket
            const short = Math.min(w, h)
            const useCrop = (frameTick++ & 1) === 0
            const cropSize = useCrop ? Math.floor(short * 0.8) : short
            const sx = Math.floor((w - cropSize) / 2)
            const sy = Math.floor((h - cropSize) / 2)
            const target = Math.min(720, cropSize)
            if (canvas.width !== target) canvas.width = target
            if (canvas.height !== target) canvas.height = target
            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            if (ctx) {
              ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, target, target)
              const img = ctx.getImageData(0, 0, target, target)
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
              if (code?.data) handleDetected(code.data)
            }
          }
        }
      } catch {
        // Swallow — keep scanning.
      }

      if (!cancelled) {
        rafRef.current = requestAnimationFrame(loop)
      }
    }

    start()

    return () => {
      cancelled = true
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      if (flashTimeoutRef.current) { clearTimeout(flashTimeoutRef.current); flashTimeoutRef.current = null }
      if (onScanTimeoutRef.current) { clearTimeout(onScanTimeoutRef.current); onScanTimeoutRef.current = null }
      if (cooldownTimeoutRef.current) { clearTimeout(cooldownTimeoutRef.current); cooldownTimeoutRef.current = null }
      if (errorClearRef.current) { clearTimeout(errorClearRef.current); errorClearRef.current = null }
      const stream = streamRef.current
      if (stream) stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitManual(e: React.FormEvent) {
    e.preventDefault()
    if (!manualInput.trim()) return
    handleDetected(manualInput.trim())
    setManualInput('')
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: '#000',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Camera preview */}
      <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            width: '100%', height: '100%',
            objectFit: 'cover',
            transform: 'scaleX(1)',
          }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {/* Dark vignette + viewfinder */}
      <div
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse at center,
            transparent 0,
            transparent 38%,
            rgba(0,0,0,0.55) 62%,
            rgba(0,0,0,0.85) 100%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Viewfinder frame */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(76vw, 300px)',
          aspectRatio: '1 / 1',
          borderRadius: 20,
          boxShadow: flash === 'ok'
            ? '0 0 0 3px #3FB950, 0 0 60px #3FB95099'
            : flash === 'bad'
              ? '0 0 0 3px #F85149, 0 0 40px #F8514988'
              : '0 0 0 2px #FFFFFF40',
          transition: 'box-shadow 0.15s',
          pointerEvents: 'none',
        }}
      >
        {/* Corner accents */}
        {[
          { top: -2, left: -2, br: '20px 0 0 0', bb: 'none', bl: 'none' },
          { top: -2, right: -2, br: '0 20px 0 0' },
          { bottom: -2, left: -2, br: '0 0 0 20px' },
          { bottom: -2, right: -2, br: '0 0 20px 0' },
        ].map((s, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: 28, height: 28,
            border: '3px solid #E8E8E8',
            borderRadius: s.br,
            ...(s.top !== undefined ? { top: s.top } : {}),
            ...(s.bottom !== undefined ? { bottom: s.bottom } : {}),
            ...(s.left !== undefined ? { left: s.left } : {}),
            ...(s.right !== undefined ? { right: s.right } : {}),
            borderBottomWidth: s.top !== undefined ? 0 : 3,
            borderTopWidth: s.bottom !== undefined ? 0 : 3,
            borderRightWidth: s.left !== undefined ? 0 : 3,
            borderLeftWidth: s.right !== undefined ? 0 : 3,
          }} />
        ))}
        {/* Scanning line (only while actively scanning) */}
        {status === 'scanning' && !flash && (
          <div
            style={{
              position: 'absolute', left: 8, right: 8, top: 0,
              height: 2, borderRadius: 2,
              background: 'linear-gradient(90deg, transparent, #3FB950, transparent)',
              boxShadow: '0 0 12px #3FB950',
              animation: 'qrscan-line 2s ease-in-out infinite',
            }}
          />
        )}
      </div>

      {/* Top bar */}
      <header style={{
        position: 'relative', zIndex: 2,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: 'calc(12px + env(safe-area-inset-top, 0px)) 16px 12px',
      }}>
        <button
          onClick={onClose}
          className="pressable"
          aria-label="Fechar"
          style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'rgba(20,20,20,0.7)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid #333333',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <span className="material-symbols-outlined" style={{ color: '#E8E8E8', fontSize: 22 }}>close</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            fontSize: 15, fontWeight: 800, color: '#E8E8E8',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textShadow: '0 2px 6px rgba(0,0,0,0.8)',
          }}>{title}</h2>
          {subtitle && (
            <p style={{
              fontSize: 11, fontWeight: 600, color: '#B0B0B0',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textShadow: '0 2px 4px rgba(0,0,0,0.8)',
            }}>{subtitle}</p>
          )}
        </div>
        {onContinuousChange && (
          <button
            onClick={() => onContinuousChange(!continuous)}
            className="pressable"
            aria-pressed={continuous}
            aria-label="Alternar modo contínuo"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 999,
              background: continuous ? 'rgba(35,134,54,0.85)' : 'rgba(20,20,20,0.7)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: `1px solid ${continuous ? '#3FB950' : '#333333'}`,
              fontSize: 11, fontWeight: 800,
              color: continuous ? '#E8E8E8' : '#B0B0B0',
              cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            <span
              className={continuous ? 'material-symbols-outlined icon-filled' : 'material-symbols-outlined'}
              style={{ fontSize: 14 }}
            >
              repeat
            </span>
            {continuous && statusHint ? statusHint : 'Contínuo'}
          </button>
        )}
        {!onContinuousChange && continuous && statusHint && (
          <div style={{
            padding: '6px 10px', borderRadius: 999,
            background: 'rgba(35,134,54,0.9)',
            border: '1px solid #3FB950',
            fontSize: 11, fontWeight: 800, color: '#E8E8E8',
            textShadow: '0 2px 4px rgba(0,0,0,0.8)',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {statusHint}
          </div>
        )}
      </header>

      {/* Status / prompt */}
      <div style={{
        position: 'absolute',
        bottom: 'calc(120px + env(safe-area-inset-bottom, 0px))',
        left: 0, right: 0,
        display: 'flex', justifyContent: 'center',
        padding: '0 24px',
        pointerEvents: 'none',
      }}>
        <div style={{
          padding: '10px 16px', borderRadius: 999,
          background: 'rgba(20,20,20,0.78)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid #333333',
          textAlign: 'center', maxWidth: '92%',
        }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: '#E8E8E8',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {status === 'starting' && 'Abrindo câmera…'}
            {status === 'scanning' && (errorMsg || (continuous
              ? 'Modo contínuo — aponte para o próximo QR'
              : 'Aponte para o QR Code do ingresso'))}
            {status === 'denied' && 'Permissão negada — libere a câmera nas configurações'}
            {status === 'unsupported' && (errorMsg || 'Câmera indisponível')}
            {status === 'error' && (errorMsg || 'Erro ao abrir a câmera')}
          </span>
        </div>
      </div>

      {/* Manual entry trigger */}
      <div style={{
        position: 'absolute',
        bottom: 'calc(32px + env(safe-area-inset-bottom, 0px))',
        left: 0, right: 0,
        display: 'flex', justifyContent: 'center',
        padding: '0 24px',
      }}>
        {!showManual ? (
          <button
            onClick={() => setShowManual(true)}
            className="pressable"
            style={{
              padding: '10px 18px', borderRadius: 999,
              background: 'rgba(20,20,20,0.8)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid #333333',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ color: '#E8E8E8', fontSize: 16 }}>keyboard</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#E8E8E8' }}>Digitar código</span>
          </button>
        ) : (
          <form
            onSubmit={submitManual}
            style={{
              display: 'flex', gap: 8, width: '100%', maxWidth: 360,
            }}
          >
            <input
              autoFocus
              type="text"
              inputMode="text"
              autoCorrect="off"
              autoCapitalize="off"
              placeholder="Cole o token fyx.… ou ID"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              style={{
                flex: 1, minWidth: 0, height: 44, borderRadius: 10,
                padding: '0 14px',
                background: 'rgba(20,20,20,0.9)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid #333333', outline: 'none',
                fontSize: 14, fontWeight: 600, color: '#E8E8E8', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              className="pressable"
              style={{
                height: 44, padding: '0 16px', borderRadius: 10,
                background: '#238636', border: '1px solid #3FB950',
                cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#E8E8E8',
              }}
            >
              OK
            </button>
          </form>
        )}
      </div>

      <style>{`
        @keyframes qrscan-line {
          0%   { top: 0%;   opacity: 0.3; }
          50%  { top: 98%;  opacity: 1;   }
          100% { top: 0%;   opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
