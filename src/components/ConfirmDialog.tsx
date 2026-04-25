import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { colors, font, radius } from '@/theme'
import { Icon } from './Icon'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'neutral'
  /**
   * Quando definido, exibe um input de texto opcional acima dos botões. O
   * texto é passado pra `onConfirm`. Usado pra capturar motivo de revert
   * (audit log) sem bloquear o operador (campo opcional).
   */
  inputLabel?: string
  inputPlaceholder?: string
  onConfirm: (input?: string) => void
  onCancel: () => void
}

/**
 * Themed replacement para o Alert nativo do RN. Mesma linguagem visual do
 * resto do scanner (dark, arredondado, botão danger em vermelho). O Modal do
 * RN já captura o botão voltar do Android -> aciona onRequestClose.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'neutral',
  inputLabel,
  inputPlaceholder,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const danger = tone === 'danger'
  const [input, setInput] = useState('')

  // Limpa o input ao reabrir — sem isso, motivo da revert anterior persiste
  // na próxima vez que operador abre o dialog (estado não desmonta).
  useEffect(() => {
    if (open) setInput('')
  }, [open])

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => { /* stop propagation */ }}>
          <View style={styles.header}>
            <View style={[styles.iconBox, danger ? styles.iconBoxDanger : styles.iconBoxNeutral]}>
              <Icon
                name={danger ? 'warning' : 'help'}
                size={20}
                color={danger ? colors.accentRed : '#79B8FF'}
              />
            </View>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
          </View>

          {description ? <Text style={styles.description}>{description}</Text> : null}

          {inputLabel ? (
            <View style={styles.inputBlock}>
              <Text style={styles.inputLabel}>{inputLabel}</Text>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={inputPlaceholder}
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                multiline
                maxLength={500}
                autoCapitalize="sentences"
                autoCorrect
              />
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={[styles.button, styles.cancelButton]}>
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(inputLabel ? input.trim() || undefined : undefined)}
              style={[styles.button, danger ? styles.confirmDanger : styles.confirmNeutral]}
            >
              <Text style={danger ? styles.confirmDangerLabel : styles.confirmNeutralLabel}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#161616',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    padding: 18,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxDanger: {
    backgroundColor: '#2A1414',
    borderColor: '#4A1A1A',
  },
  iconBoxNeutral: {
    backgroundColor: '#1E2A3E',
    borderColor: '#2A3E5A',
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  description: {
    fontSize: 13,
    fontWeight: font.weight.medium,
    color: '#B0B0B0',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  inputBlock: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  input: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    fontSize: 13,
    fontWeight: font.weight.medium,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cancelButton: {
    backgroundColor: colors.bgSurface,
    borderColor: colors.borderDefault,
  },
  cancelLabel: {
    fontSize: 13,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  confirmNeutral: {
    backgroundColor: colors.accentGreenDim,
    borderColor: colors.accentGreen,
  },
  confirmNeutralLabel: {
    fontSize: 13,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  confirmDanger: {
    backgroundColor: '#2A1414',
    borderColor: '#4A1A1A',
  },
  confirmDangerLabel: {
    fontSize: 13,
    fontWeight: font.weight.extrabold,
    color: colors.accentRed,
  },
})
