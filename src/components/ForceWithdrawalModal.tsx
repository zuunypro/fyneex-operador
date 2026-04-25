import { useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { colors, font, radius } from '@/theme'
import { Icon } from './Icon'

interface ForceWithdrawalModalProps {
  participantName: string
  /**
   * Texto que o servidor devolveu (KIT_NO_STOCK_CONFIGURED ou FORCE_REASON_REQUIRED).
   * Usamos como contexto pro operador entender por que a retirada normal falhou.
   */
  serverMessage?: string
  submitting?: boolean
  onConfirm: (reason: string) => void
  onClose: () => void
}

const MIN_REASON_LEN = 3
const MAX_REASON_LEN = 500

/**
 * Modal que aparece quando o servidor recusa retirada por falta de estoque
 * vinculado (KIT_NO_STOCK_CONFIGURED). Pede um motivo obrigatório e re-tenta
 * a mutation com `allowNoStock: true`. Servidor exige motivo de 3+ chars
 * (FORCE_REASON_REQUIRED) e grava em audit como retirada_forcada.
 */
export function ForceWithdrawalModal({
  participantName,
  serverMessage,
  submitting = false,
  onConfirm,
  onClose,
}: ForceWithdrawalModalProps) {
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()
  const canConfirm = trimmed.length >= MIN_REASON_LEN && !submitting

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
          <View style={styles.iconWrap}>
            <Icon name="warning" size={28} color={colors.accentOrange} />
          </View>

          <Text style={styles.title}>Forçar retirada sem estoque?</Text>
          <Text style={styles.subtitle}>
            Nenhum item de estoque está vinculado a {participantName}. A retirada
            será registrada sem baixa no estoque, mas precisa de uma justificativa.
          </Text>

          {serverMessage ? (
            <View style={styles.serverHint}>
              <Text style={styles.serverHintLabel}>Detalhe do servidor</Text>
              <Text style={styles.serverHintText} numberOfLines={3}>{serverMessage}</Text>
            </View>
          ) : null}

          <Text style={styles.inputLabel}>Motivo (obrigatório)</Text>
          <TextInput
            placeholder="Ex: kit avulso, troca de tamanho, item perdido..."
            placeholderTextColor={colors.textTertiary}
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
            maxLength={MAX_REASON_LEN}
            editable={!submitting}
            style={styles.input}
            textAlignVertical="top"
            autoFocus
          />
          <Text style={styles.inputHint}>
            Mínimo {MIN_REASON_LEN} caracteres. Vai pra auditoria do evento.
          </Text>

          <Pressable
            onPress={() => canConfirm && onConfirm(trimmed)}
            disabled={!canConfirm}
            style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Icon name="redeem" size={18} color={colors.textPrimary} />
            )}
            <Text style={styles.confirmLabel}>
              {submitting ? 'Forçando...' : 'Forçar retirada'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onClose}
            disabled={submitting}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelLabel}>Cancelar</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
    maxWidth: 360,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: '#6B4A1A',
    padding: 20,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#3A2A0D',
    borderWidth: 1,
    borderColor: '#6B4A1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: font.weight.medium,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 17,
  },
  serverHint: {
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    marginBottom: 14,
  },
  serverHintLabel: {
    fontSize: 9,
    fontWeight: font.weight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  serverHintText: {
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: colors.textSecondary,
    lineHeight: 15,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    minHeight: 76,
    borderRadius: radius.md,
    padding: 12,
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    fontSize: 14,
    fontWeight: font.weight.medium,
    color: colors.textPrimary,
  },
  inputHint: {
    fontSize: 10,
    fontWeight: font.weight.medium,
    color: colors.textTertiary,
    marginTop: 6,
    marginBottom: 14,
  },
  confirmButton: {
    width: '100%',
    height: 46,
    borderRadius: radius.md,
    backgroundColor: '#3A2A0D',
    borderWidth: 1,
    borderColor: '#8a5a00',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  confirmButtonDisabled: {
    opacity: 0.45,
  },
  confirmLabel: {
    fontSize: 14,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  cancelButton: {
    width: '100%',
    height: 38,
    borderRadius: radius.md,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    fontSize: 12,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
  },
})
