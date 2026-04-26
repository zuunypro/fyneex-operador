import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppState,
  type AppStateStatus,
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

/**
 * Mutex in-memory por TOKEN cru (raw QR string). Defesa em profundidade contra
 * double-scan: usuário toca "Digitar código" + câmera detecta o mesmo QR no
 * mesmo tick → o segundo callback vira no-op ANTES de virar request HTTP. O
 * servidor já tem CAS atômico no checkin, mas isso evita request desnecessária
 * + toast confuso de "já confirmado" milissegundos depois do primeiro sucesso.
 *
 * Top-level (escopo de módulo) pra persistir entre renders/montagens — o
 * scanner desmonta/remonta quando operador troca de aba e a janela de defesa
 * (~1.5s) precisa cobrir esse re-entry. Set é por processo, então fechar o
 * app limpa tudo (ok: novo processo = nova sessão de scan).
 */
const inflightTokens = new Set<string>()
const INFLIGHT_TTL_MS = 1500

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
  onScan: (token: ScannedToken) => void | Promise<void>
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

/** Tokens reais ficam em ~180-260 chars; cap em 1KB cobre folga e bloqueia
 *  payloads gigantes via input manual ou QR adversarial (atob de MB-size
 *  trava o JS thread no Hermes). */
const MAX_QR_TOKEN_LEN = 1024

export function parseFyneexQrToken(raw: string): ScannedToken | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length > MAX_QR_TOKEN_LEN) return null

  if (trimmed.startsWith('fyx.')) {
    const parts = trimmed.split('.')
    if (parts.length !== 3) return null
    try {
      const json = base64UrlDecode(parts[1])
      const payload = JSON.parse(json) as { oi?: string; eid?: string }
      if (!payload.oi || !payload.eid) return null
      return { participantId: payload.oi, eventId: payload.eid, raw: trimmed }
    } catch (err) {
      // Log truncado pra debug em prod via remote logger (Sentry/similar
      // captura console.warn). Truncamos a 50 chars pra não vazar payload
      // grande adversarial. Não muda UX — operador vê só o flash 'bad'.
      if (__DEV__) {
        const sample = trimmed.slice(0, 50)
        console.warn('[QRScanner] Falha ao decodificar QR fyx:', sample, err)
      }
      return null
    }
  }

  if (/^[A-Za-z0-9_-]{8,}$/.test(trimmed)) {
    return { participantId: trimmed, raw: trimmed }
  }

  // QR não bate com nenhum formato conhecido — ajuda debug remoto.
  if (__DEV__) {
    console.warn('[QRScanner] QR em formato desconhecido:', trimmed.slice(0, 50))
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
  // Conta toques no botão "Digitar código" sem leitura bem-sucedida em 30s
  // — ao chegar a 3, exibe banner forte sugerindo input manual (câmera
  // possivelmente quebrada / QR ruim / mau enquadramento).
  const [manualHintForced, setManualHintForced] = useState(false)

  // Facing default 'back'. Se mount falha (device só com frontal, ou câmera
  // traseira ocupada/quebrada), tenta automático pra 'front'. Se as duas
  // falharem, mostra UI fatal recuperável.
  const [facing, setFacing] = useState<'back' | 'front'>('back')
  const [bothCamerasFailed, setBothCamerasFailed] = useState(false)
  const triedFrontRef = useRef(false)

  // Detecção de "preview preto / câmera ocupada": se em 5s o onCameraReady
  // não disparar, mostra banner sugerindo reiniciar a câmera. O remount é
  // feito mudando a `key` do CameraView (bumping cameraKey).
  const [cameraReady, setCameraReady] = useState(false)
  const [showResetBanner, setShowResetBanner] = useState(false)
  const [cameraKey, setCameraKey] = useState(0)
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scannedRef = useRef(false)
  const lastRawRef = useRef<{ raw: string; at: number } | null>(null)
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracking de toques no manual trigger pra disparar banner forte quando
  // operador toca repetidamente sem conseguir scan (câmera com problema).
  const manualTouchesRef = useRef<number[]>([])
  const lastSuccessAtRef = useRef<number>(0)

  // No-op em RN mas mantém a assinatura da versão web.
  useEffect(() => { primeAudio() }, [])

  // Dispara o pedido de permissão automaticamente na primeira abertura.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted])

  // Re-checa permissão quando o app volta de background. Operador pode ter
  // ido em Settings revogar a câmera e voltado — sem isso o componente fica
  // inerte mostrando câmera vazia. AppState dispara 'active' nesse retorno.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && permission && !permission.granted && permission.canAskAgain) {
        requestPermission().catch(() => { /* fail-soft, UI já mostra denied */ })
      }
    })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission?.granted, permission?.canAskAgain])

  useEffect(() => () => {
    if (cooldownRef.current) clearTimeout(cooldownRef.current)
    if (flashRef.current) clearTimeout(flashRef.current)
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current)
    if (errorClearRef.current) clearTimeout(errorClearRef.current)
    if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current)
    // Reset semáforo: se o componente desmontar durante onScan (usuário troca
    // de aba em < 180ms), a próxima montagem começa sem o lock travado.
    scannedRef.current = false
  }, [])

  // Watchdog: se em 5s pós permission o cameraReady não disparou, mostra
  // banner "Reiniciar câmera". Usuário toca → bump cameraKey força remount.
  // Reseta a cada cameraKey/permission change.
  useEffect(() => {
    if (!permission?.granted || bothCamerasFailed) return
    if (cameraReady) {
      if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current)
      setShowResetBanner(false)
      return
    }
    if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current)
    readyTimeoutRef.current = setTimeout(() => {
      setShowResetBanner(true)
    }, 5000)
    return () => {
      if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current)
    }
  }, [permission?.granted, cameraReady, cameraKey, bothCamerasFailed])

  const handleMountError = useCallback((err: { message?: string }) => {
    const msg = (err?.message || '').toLowerCase()
    // Heurística: erro contém indicação de câmera não disponível? Tenta frontal.
    // Se já tentou frontal antes, marca fatal. Heurística generosa porque o
    // texto exato varia entre OEM/Android version.
    const looksUnavailable = !msg || msg.includes('not available') || msg.includes('unavailable')
      || msg.includes('no camera') || msg.includes('back') || msg.includes('failed')
    if (!triedFrontRef.current && looksUnavailable) {
      triedFrontRef.current = true
      setFacing('front')
      setCameraReady(false)
      setCameraKey((k) => k + 1)
      return
    }
    setBothCamerasFailed(true)
  }, [])

  const handleCameraReady = useCallback(() => {
    setCameraReady(true)
    setShowResetBanner(false)
  }, [])

  const handleResetCamera = useCallback(() => {
    setCameraReady(false)
    setShowResetBanner(false)
    setCameraKey((k) => k + 1)
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

    // Mutex por TOKEN cru (defesa em profundidade vs double-scan no mesmo
    // tick: input manual + câmera detectando o mesmo QR). Mesmo com CAS no
    // servidor, sem isso teríamos 2 requests + toast confuso. TTL 1.5s é
    // mais que suficiente pra qualquer round-trip de mutation.
    if (inflightTokens.has(raw)) return
    inflightTokens.add(raw)

    scannedRef.current = true
    lastRawRef.current = { raw, at: Date.now() }
    setFlash('ok')
    // Haptic LEVE pre-fetch: confirma "li o QR". O forte (success) sai depois
    // que onScan resolver, em runScan abaixo.
    Haptics.selectionAsync().catch(() => {})

    const runScan = async () => {
      try {
        await onScan(parsed)
        // Sucesso: marca timestamp pra não disparar banner manual fortemente.
        lastSuccessAtRef.current = Date.now()
        // Reset contador de toques no manual trigger — operador conseguiu scan,
        // não tem problema de câmera.
        manualTouchesRef.current = []
        if (manualHintForced) setManualHintForced(false)
        // Haptic FORTE pós-sucesso: confirma "validado".
        feedbackOk()
      } catch {
        // Caller cuida do toast humanizado; aqui só haptic forte de erro.
        feedbackBad()
      } finally {
        // Libera o token após o TTL (não imediato — protege contra rebote
        // da câmera que pode reler o mesmo QR enquanto operador ainda olha).
        setTimeout(() => inflightTokens.delete(raw), INFLIGHT_TTL_MS)
      }
    }

    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current)
    scanTimeoutRef.current = setTimeout(() => { void runScan() }, 180)

    if (continuous) {
      if (cooldownRef.current) clearTimeout(cooldownRef.current)
      cooldownRef.current = setTimeout(() => {
        scannedRef.current = false
        setFlash(null)
      }, CONTINUOUS_COOLDOWN_MS)
    }
  }, [expectedEventId, onScan, continuous, manualHintForced])

  const submitManual = useCallback(() => {
    if (!manualInput.trim()) return
    handleDetected(manualInput.trim())
    setManualInput('')
  }, [manualInput, handleDetected])

  // Track toques no botão "Digitar código". 3 toques em 30s sem scan bem
  // sucedido entre eles = banner forte (câmera com problema / QR ruim /
  // iluminação ruim). Operador pode achar que o app não vê o QR — banner
  // direto sugere alternativa óbvia. No 3o toque, abrimos manual + banner
  // continua visível ali em cima até o próximo sucesso resetar.
  const handleManualTriggerPress = useCallback(() => {
    const now = Date.now()
    const fresh = manualTouchesRef.current.filter(
      (t) => now - t < 30_000 && t > lastSuccessAtRef.current,
    )
    fresh.push(now)
    manualTouchesRef.current = fresh
    if (fresh.length >= 3 && !manualHintForced) setManualHintForced(true)
    setShowManual(true)
  }, [manualHintForced])

  // Permite fechar manualmente pra que o banner reapareça (caso operador
  // entenda que precisa tentar a câmera de novo). Pressed na X do header
  // já fecha o scanner inteiro — esta X é só pra colapsar o input.
  const closeManualForm = useCallback(() => setShowManual(false), [])

  const denied = permission?.granted === false
  const loading = !permission
  // Banner forte do fallback manual: permissão negada (input é a única opção)
  // OU operador tocou 3+ vezes no manual sem conseguir scan em 30s (câmera
  // possivelmente quebrada). Aparece sempre que essas condições são true,
  // mesmo com a form aberta — input já fica visível abaixo dela.
  const showManualBanner = denied || manualHintForced

  const flashColor = flash === 'ok' ? colors.accentGreen : flash === 'bad' ? colors.accentRed : '#FFFFFF40'

  const statusText =
    loading ? 'Abrindo câmera…' :
    denied ? 'Permissão negada — libere a câmera nas configurações' :
    errorMsg || (continuous
      ? 'Modo contínuo — aponte para o próximo QR'
      : 'Aponte para o QR Code do ingresso')

  return (
    <View style={styles.root}>
      {permission?.granted && !bothCamerasFailed ? (
        <CameraView
          key={cameraKey}
          style={StyleSheet.absoluteFillObject}
          facing={facing}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => handleDetected(data)}
          onCameraReady={handleCameraReady}
          onMountError={handleMountError}
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
        <SafeAreaView edges={['bottom']} style={{ alignItems: 'center', gap: 10 }}>
          {showManualBanner ? (
            // Banner forte: câmera fora ou operador tentou 3x sem sucesso.
            // Aparece centralizado e bem visível pra puxar atenção. O input
            // (showManual) pode coexistir abaixo.
            <View style={styles.manualBanner}>
              <Icon name="warning" size={18} color={colors.accentOrange} />
              <Text style={styles.manualBannerText} numberOfLines={2}>
                Câmera com problema? Digite o código manualmente.
              </Text>
              {!showManual ? (
                <Pressable
                  onPress={handleManualTriggerPress}
                  style={styles.manualBannerButton}
                >
                  <Icon name="keyboard" size={16} color={colors.textPrimary} />
                  <Text style={styles.manualTriggerLabel}>Digitar código</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {!showManual && !showManualBanner ? (
            <Pressable onPress={handleManualTriggerPress} style={styles.manualTrigger}>
              <Icon name="keyboard" size={16} color={colors.textPrimary} />
              <Text style={styles.manualTriggerLabel}>Digitar código</Text>
            </Pressable>
          ) : null}
          {showManual ? (
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
              <Pressable onPress={closeManualForm} style={styles.manualClose} hitSlop={8}>
                <Icon name="close" size={16} color={colors.textTertiary} />
              </Pressable>
            </View>
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>

      {denied ? (
        <View style={styles.deniedOverlay} pointerEvents="box-none">
          <Pressable onPress={requestPermission} style={styles.deniedButton}>
            <Text style={styles.deniedButtonLabel}>Permitir câmera</Text>
          </Pressable>
        </View>
      ) : null}

      {bothCamerasFailed ? (
        // Câmera traseira E frontal falharam — devices muito antigos / hardware
        // quebrado. Operador só consegue avançar via input manual; UI fatal
        // bloqueia o viewfinder pra deixar isso óbvio.
        <View style={styles.deniedOverlay} pointerEvents="box-none">
          <View style={styles.fatalCard}>
            <Text style={styles.fatalCardTitle}>Câmera não disponível neste dispositivo</Text>
            <Text style={styles.fatalCardHint}>Use o botão "Digitar código" abaixo.</Text>
            <Pressable onPress={onClose} style={styles.deniedButton}>
              <Text style={styles.deniedButtonLabel}>Voltar</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {showResetBanner && !bothCamerasFailed && !denied ? (
        // Câmera demorou >5s pra ficar ready (preview preto / câmera ocupada
        // por outro app / driver travado). Banner discreto no topo da área
        // central oferece reset (remount via key bump).
        <View style={styles.resetBannerWrap} pointerEvents="box-none">
          <View style={styles.resetBanner}>
            <Text style={styles.resetBannerText}>Câmera demorando — reinicie</Text>
            <Pressable onPress={handleResetCamera} style={styles.resetBannerButton}>
              <Text style={styles.resetBannerButtonLabel}>Reiniciar</Text>
            </Pressable>
          </View>
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
  // Banner proeminente quando câmera tá fora ou operador tentou 3x. Centralizado,
  // bg destacado com tom warning, botão grande pra alternativa óbvia.
  manualBanner: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(31,26,15,0.95)',
    borderWidth: 1,
    borderColor: '#6B4A1A',
    maxWidth: 380,
    width: '100%',
  },
  manualBannerText: {
    fontSize: 13,
    fontWeight: font.weight.bold,
    color: '#E8C77A',
    textAlign: 'center',
  },
  manualBannerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    minWidth: 200,
    justifyContent: 'center',
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
  manualClose: {
    width: 36,
    height: 44,
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
  fatalCard: {
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(20,20,20,0.95)',
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    gap: 12,
    maxWidth: 320,
  },
  fatalCardTitle: {
    fontSize: 14,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  fatalCardHint: {
    fontSize: 12,
    fontWeight: font.weight.semibold,
    color: '#B0B0B0',
    textAlign: 'center',
  },
  resetBannerWrap: {
    position: 'absolute',
    top: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  resetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(31,26,15,0.95)',
    borderWidth: 1,
    borderColor: '#6B4A1A',
  },
  resetBannerText: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: '#E8C77A',
  },
  resetBannerButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  resetBannerButtonLabel: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
})
