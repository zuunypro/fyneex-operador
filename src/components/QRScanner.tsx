import { CameraView, useCameraPermissions } from 'expo-camera'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, font, radius } from '@/theme'
import { feedbackBad, feedbackOk, primeAudio } from '@/utils/feedback'
import { Icon } from './Icon'

export interface ScannedToken {
  /** order_item id extracted from the QR (the "oi" field of a fyx token, or raw id). */
  participantId: string
  /** event id extracted from the QR ("eid"). Undefined when the QR is a legacy raw id. */
  eventId?: string
  /** The raw text read from the QR code. */
  raw: string
}

interface QRScannerProps {
  expectedEventId: string
  title: string
  subtitle?: string
  onScan: (token: ScannedToken) => void
  onClose: () => void
  continuous?: boolean
  onContinuousChange?: (next: boolean) => void
  statusHint?: string
}

/* ── Token parsing ──────────────────────────────────────────────────────── */

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4
  const fixed = pad === 0 ? padded : padded + '='.repeat(4 - pad)
  // atob é exposto pelo Hermes/RN.
  return globalThis.atob(fixed)
}

export function parseFyneexQrToken(raw: string): ScannedToken | null {
  if (!raw) return null
  const trimmed = raw.trim()

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

  if (/^[A-Za-z0-9_-]{8,}$/.test(trimmed)) {
    return { participantId: trimmed, raw: trimmed }
  }

  return null
}

/* Tempo de dedupe de um mesmo payload em modo contínuo. */
const CONTINUOUS_DEDUPE_MS = 2500
/* Cooldown entre leituras distintas em modo contínuo. */
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
  const [permission, requestPermission] = useCameraPermissions()
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [manualInput, setManualInput] = useState('')
  const [showManual, setShowManual] = useState(false)

  const scannedRef = useRef(false)
  const lastRawRef = useRef<{ raw: string; at: number } | null>(null)
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // No-op em RN mas mantém a assinatura da versão web.
  useEffect(() => { primeAudio() }, [])

  // Dispara o pedido de permissão automaticamente na primeira abertura.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted])

  useEffect(() => () => {
    if (cooldownRef.current) clearTimeout(cooldownRef.current)
    if (flashRef.current) clearTimeout(flashRef.current)
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current)
    if (errorClearRef.current) clearTimeout(errorClearRef.current)
  }, [])

  const handleDetected = useCallback((raw: string) => {
    if (scannedRef.current) return

    if (continuous && lastRawRef.current) {
      const { raw: lastRaw, at } = lastRawRef.current
      if (lastRaw === raw && Date.now() - at < CONTINUOUS_DEDUPE_MS) return
    }

    const parsed = parseFyneexQrToken(raw)
    if (!parsed) {
      setFlash('bad')
      feedbackBad()
      if (flashRef.current) clearTimeout(flashRef.current)
      flashRef.current = setTimeout(() => setFlash(null), 500)
      return
    }
    if (parsed.eventId && parsed.eventId !== expectedEventId) {
      setFlash('bad')
      feedbackBad()
      setErrorMsg('QR de outro evento')
      if (flashRef.current) clearTimeout(flashRef.current)
      flashRef.current = setTimeout(() => setFlash(null), 500)
      if (errorClearRef.current) clearTimeout(errorClearRef.current)
      errorClearRef.current = setTimeout(() => setErrorMsg(''), 1500)
      return
    }

    scannedRef.current = true
    lastRawRef.current = { raw, at: Date.now() }
    setFlash('ok')
    feedbackOk()

    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current)
    scanTimeoutRef.current = setTimeout(() => onScan(parsed), 180)

    if (continuous) {
      if (cooldownRef.current) clearTimeout(cooldownRef.current)
      cooldownRef.current = setTimeout(() => {
        scannedRef.current = false
        setFlash(null)
      }, CONTINUOUS_COOLDOWN_MS)
    }
  }, [expectedEventId, onScan, continuous])

  const submitManual = useCallback(() => {
    if (!manualInput.trim()) return
    handleDetected(manualInput.trim())
    setManualInput('')
  }, [manualInput, handleDetected])

  const denied = permission?.granted === false
  const loading = !permission

  const flashColor = flash === 'ok' ? colors.accentGreen : flash === 'bad' ? colors.accentRed : '#FFFFFF40'

  const statusText =
    loading ? 'Abrindo câmera…' :
    denied ? 'Permissão negada — libere a câmera nas configurações' :
    errorMsg || (continuous
      ? 'Modo contínuo — aponte para o próximo QR'
      : 'Aponte para o QR Code do ingresso')

  return (
    <View style={styles.root}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => handleDetected(data)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.blank]} />
      )}

      {/* Vinheta escura + viewfinder */}
      <View pointerEvents="none" style={styles.vignette} />

      <View pointerEvents="none" style={styles.finderWrapper}>
        <View
          style={[
            styles.finder,
            {
              borderColor: flash ? flashColor : '#FFFFFF40',
              shadowColor: flashColor,
              shadowOpacity: flash ? 0.6 : 0,
            },
          ]}
        >
          {/* 4 cantos */}
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
      </View>

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <Pressable onPress={onClose} style={styles.closeButton} accessibilityLabel="Fechar">
          <Icon name="close" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {onContinuousChange ? (
          <Pressable
            onPress={() => onContinuousChange(!continuous)}
            accessibilityState={{ selected: continuous }}
            accessibilityLabel="Alternar modo contínuo"
            style={[styles.continuousPill, continuous && styles.continuousPillActive]}
          >
            <Icon
              name="refresh"
              size={14}
              color={continuous ? colors.textPrimary : '#B0B0B0'}
            />
            <Text style={[styles.continuousLabel, continuous && styles.continuousLabelActive]}>
              {continuous && statusHint ? statusHint : 'Contínuo'}
            </Text>
          </Pressable>
        ) : continuous && statusHint ? (
          <View style={[styles.continuousPill, styles.continuousPillActive]}>
            <Text style={[styles.continuousLabel, styles.continuousLabelActive]}>{statusHint}</Text>
          </View>
        ) : null}
      </SafeAreaView>

      {/* Status / prompt */}
      <View style={styles.statusWrap} pointerEvents="none">
        <View style={styles.statusPill}>
          <Text style={styles.statusText} numberOfLines={1}>{statusText}</Text>
        </View>
      </View>

      {/* Manual entry */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.manualWrap}
      >
        <SafeAreaView edges={['bottom']}>
          {!showManual ? (
            <Pressable onPress={() => setShowManual(true)} style={styles.manualTrigger}>
              <Icon name="keyboard" size={16} color={colors.textPrimary} />
              <Text style={styles.manualTriggerLabel}>Digitar código</Text>
            </Pressable>
          ) : (
            <View style={styles.manualForm}>
              <TextInput
                autoFocus
                placeholder="Cole o token fyx.… ou ID"
                placeholderTextColor={colors.textTertiary}
                value={manualInput}
                onChangeText={setManualInput}
                onSubmitEditing={submitManual}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
                style={styles.manualInput}
              />
              <Pressable onPress={submitManual} style={styles.manualSubmit}>
                <Text style={styles.manualSubmitLabel}>OK</Text>
              </Pressable>
            </View>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>

      {denied ? (
        <View style={styles.deniedOverlay} pointerEvents="box-none">
          <Pressable onPress={requestPermission} style={styles.deniedButton}>
            <Text style={styles.deniedButtonLabel}>Permitir câmera</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  blank: {
    backgroundColor: '#000',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  finderWrapper: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finder: {
    width: 280,
    height: 280,
    borderRadius: 20,
    borderWidth: 2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: colors.textPrimary,
  },
  cornerTL: {
    top: -2,
    left: -2,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 20,
  },
  cornerTR: {
    top: -2,
    right: -2,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 20,
  },
  cornerBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 20,
  },
  cornerBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    paddingTop: 12,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(20,20,20,0.7)',
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: '#B0B0B0',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  continuousPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(20,20,20,0.7)',
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  continuousPillActive: {
    backgroundColor: 'rgba(35,134,54,0.85)',
    borderColor: colors.accentGreen,
  },
  continuousLabel: {
    fontSize: 11,
    fontWeight: font.weight.extrabold,
    color: '#B0B0B0',
  },
  continuousLabelActive: {
    color: colors.textPrimary,
  },
  statusWrap: {
    position: 'absolute',
    bottom: 160,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  statusPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(20,20,20,0.78)',
    borderWidth: 1,
    borderColor: colors.borderDefault,
    maxWidth: '92%',
  },
  statusText: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  manualWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
  manualTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(20,20,20,0.8)',
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  manualTriggerLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  manualForm: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    maxWidth: 360,
  },
  manualInput: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(20,20,20,0.9)',
    borderWidth: 1,
    borderColor: colors.borderDefault,
    fontSize: 14,
    fontWeight: font.weight.semibold,
    color: colors.textPrimary,
  },
  manualSubmit: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualSubmitLabel: {
    fontSize: 13,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  deniedOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deniedButton: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 1,
    borderColor: colors.accentGreen,
  },
  deniedButtonLabel: {
    fontSize: 14,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
})
