import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { colors, font, radius } from '@/theme'
import { Icon } from './Icon'
import { formatBytes, type StorageStatus } from '@/services/storage'

interface StorageWarningModalProps {
  status: StorageStatus | null
  /** true: pré-check rodando (mostra loader em vez do conteúdo). */
  loading?: boolean
  /** Disabled durante o download em si pra evitar dupla submissão. */
  submitting?: boolean
  onContinue: () => void
  onClose: () => void
}

/**
 * Aparece antes de um download grande quando o storage do device está apertado.
 * Modos:
 *  - loading: spinner enquanto medimos free disk e total estimado
 *  - critical: free < minBytes (CERTAMENTE não cabe) — sem botão "continuar"
 *  - insufficient: free < recommendedBytes (cabe mas perto do limite) — opera-
 *    dor pode forçar
 */
export function StorageWarningModal({
  status,
  loading = false,
  submitting = false,
  onContinue,
  onClose,
}: StorageWarningModalProps) {
  const isCritical = status?.critical === true
  const usagePercent =
    status && typeof status.totalBytes === 'number' && status.totalBytes > 0 && typeof status.freeBytes === 'number'
      ? Math.max(0, Math.min(100, Math.round(((status.totalBytes - status.freeBytes) / status.totalBytes) * 100)))
      : null

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={submitting ? undefined : onClose}
    >
      <Pressable style={styles.backdrop} onPress={submitting ? undefined : onClose}>
        <Pressable style={styles.card} onPress={() => { /* stop propagation */ }}>
          <View
            style={[
              styles.iconWrap,
              isCritical ? styles.iconWrapCritical : styles.iconWrapWarning,
            ]}
          >
            <Icon
              name={isCritical ? 'storage' : 'warning'}
              size={28}
              color={isCritical ? colors.accentRed : colors.accentOrange}
            />
          </View>

          <Text style={styles.title}>
            {loading
              ? 'Verificando armazenamento...'
              : isCritical
                ? 'Armazenamento insuficiente'
                : 'Espaço no limite'}
          </Text>

          {loading || !status ? (
            <ActivityIndicator size="small" color={colors.accentGreen} style={{ marginVertical: 14 }} />
          ) : (
            <>
              <Text style={styles.subtitle}>
                {isCritical
                  ? `Não há espaço suficiente neste celular pra baixar este evento offline. Libere espaço (apague apps, fotos ou eventos antigos) e tente novamente.`
                  : `Vai caber, mas o celular já tá com pouco espaço. Recomendamos liberar espaço antes pra evitar travamentos durante o evento.`}
              </Text>

              <View style={styles.metricsRow}>
                <Metric
                  label="Necessário (com folga)"
                  value={formatBytes(status.estimate.recommendedBytes)}
                  highlight
                />
                <View style={styles.metricsDivider} />
                <Metric
                  label="Livre no celular"
                  value={formatBytes(status.freeBytes)}
                  warn={isCritical}
                />
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Participantes</Text>
                <Text style={styles.detailValue}>{status.estimate.participants.toLocaleString('pt-BR')}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Itens de estoque</Text>
                <Text style={styles.detailValue}>{status.estimate.inventoryItems.toLocaleString('pt-BR')}</Text>
              </View>
              {usagePercent !== null ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Uso atual do celular</Text>
                  <Text style={styles.detailValue}>{usagePercent}%</Text>
                </View>
              ) : null}
            </>
          )}

          {!loading && !isCritical && status ? (
            <Pressable
              onPress={onContinue}
              disabled={submitting}
              style={[styles.continueButton, submitting && styles.continueButtonDisabled]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <Icon name="download" size={18} color={colors.textPrimary} />
              )}
              <Text style={styles.continueLabel}>
                {submitting ? 'Baixando...' : 'Baixar mesmo assim'}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={onClose}
            disabled={submitting}
            style={styles.closeButton}
          >
            <Text style={styles.closeLabel}>{loading || isCritical ? 'Fechar' : 'Cancelar'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function Metric({
  label,
  value,
  highlight,
  warn,
}: {
  label: string
  value: string
  highlight?: boolean
  warn?: boolean
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        style={[
          styles.metricValue,
          highlight && { color: colors.accentGreen },
          warn && { color: colors.accentRed },
        ]}
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    padding: 22,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1,
  },
  iconWrapWarning: {
    backgroundColor: '#3A2A0D',
    borderColor: '#6B4A1A',
  },
  iconWrapCritical: {
    backgroundColor: '#3A0F0F',
    borderColor: '#6B1A1A',
  },
  title: {
    fontSize: 16,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: font.weight.medium,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 17,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.bgBase,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    paddingVertical: 10,
    marginBottom: 12,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  metricLabel: {
    fontSize: 9,
    fontWeight: font.weight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
    textAlign: 'center',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  metricsDivider: {
    width: 1,
    backgroundColor: colors.borderMuted,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderMuted,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  continueButton: {
    width: '100%',
    height: 46,
    borderRadius: radius.md,
    marginTop: 16,
    backgroundColor: '#3A2A0D',
    borderWidth: 1,
    borderColor: '#8a5a00',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  continueButtonDisabled: {
    opacity: 0.5,
  },
  continueLabel: {
    fontSize: 14,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  closeButton: {
    width: '100%',
    height: 38,
    borderRadius: radius.md,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabel: {
    fontSize: 12,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
  },
})
