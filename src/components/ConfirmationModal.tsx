import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { colors, font, radius } from '@/theme'
import type { InstanceField, MobileParticipant } from '@/hooks/useParticipants'
import { formatCpfLast5 } from '@/utils/format'
import { Icon } from './Icon'

interface ConfirmationModalProps {
  participant: MobileParticipant
  /** Optional observation textarea — quando omitido (Estoque), nada é mostrado. */
  obsText?: string
  onObsChange?: (next: string) => void
  obsMaxLength?: number
  obsPlaceholder?: string
  obsLabel?: string
  fieldsLayout?: 'grid' | 'rows'
  fieldsLimit?: number
  fieldsTitle?: string
  fieldsExcludeLabelRegex?: RegExp
  /** Substitui `participant.instanceFields` na renderização da seção de
   *  campos. Usado pelo Estoque pra mostrar o kit a entregar derivado de
   *  `inventory_items` (que inclui Garrafa/Brinde de variante única que
   *  não vão pro form_responses) em vez do que o cliente preencheu. */
  overrideFields?: InstanceField[]
  confirmLabel: string
  confirmIcon?: ReactNode
  submitting?: boolean
  onConfirm: () => void
  onClose: () => void
  /** Read-only: mostra banner "já escaneado" e esconde Confirmar. */
  alreadyScanned?: boolean
  alreadyScannedMessage?: string
  alreadyScannedDetail?: string
  /** Slot opcional renderizado entre os campos e o botão Confirmar.
   *  Usado pelo StockPage pra expor o toggle "Permitir retirada antecipada"
   *  apenas em eventos pré-data ou quando faz sentido pro fluxo. */
  extraFooter?: ReactNode
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
  overrideFields,
  extraFooter,
}: ConfirmationModalProps) {
  const showObs = !alreadyScanned && typeof obsText === 'string' && typeof onObsChange === 'function'

  const sourceFields = overrideFields ?? p.instanceFields ?? []
  const allFields = sourceFields.filter((f) =>
    fieldsExcludeLabelRegex ? !fieldsExcludeLabelRegex.test(f.label) : true,
  )
  const visibleFields = allFields.slice(0, fieldsLimit)
  const hiddenCount = Math.max(0, allFields.length - visibleFields.length)

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => { /* stop propagation */ }}>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            {alreadyScanned && (
              <View accessibilityRole="alert" style={styles.banner}>
                <Icon name="error" size={20} color={colors.accentOrange} style={{ marginTop: 1 }} />
                <View style={styles.bannerBody}>
                  <Text style={styles.bannerTitle}>{alreadyScannedMessage}</Text>
                  {alreadyScannedDetail ? (
                    <Text style={styles.bannerDetail}>{alreadyScannedDetail}</Text>
                  ) : null}
                </View>
              </View>
            )}

            <View style={styles.participantRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarLabel}>{p.initials}</Text>
              </View>
              <View style={styles.participantBody}>
                <Text style={styles.participantName} numberOfLines={1}>{p.name}</Text>
                {p.nameFromForm === false && p.buyerName && p.buyerName !== 'N/A' ? (
                  <Text style={styles.participantBuyerHint} numberOfLines={1}>
                    Comprador: {p.buyerName}
                  </Text>
                ) : null}
                <Text style={styles.participantMeta} numberOfLines={1}>
                  {p.orderNumber}
                  {p.ticketName ? ` · ${p.ticketName}` : ''}
                  {p.batch ? ` · ${p.batch}` : ''}
                  {p.instanceLabel ? ` · ${p.instanceLabel}` : ''}
                  {p.buyerCpfLast5 ? ` · ${formatCpfLast5(p.buyerCpfLast5)}` : ' · sem CPF'}
                </Text>
              </View>
            </View>

            {visibleFields.length === 0 && p.nameFromForm === false && !alreadyScanned ? (
              <View style={styles.formPendingBox}>
                <Icon name="priority_high" size={14} color={colors.accentOrange} />
                <Text style={styles.formPendingText}>
                  Este participante ainda não preencheu o formulário do evento. Confirme a identidade pelo CPF do comprador ou número do pedido.
                </Text>
              </View>
            ) : null}

            {visibleFields.length > 0 && (
              <View style={styles.fieldsBox}>
                {fieldsTitle ? (
                  <Text style={styles.fieldsTitle}>{fieldsTitle}</Text>
                ) : null}

                {fieldsLayout === 'grid' ? (
                  <View style={styles.grid}>
                    {visibleFields.map((f) => (
                      <View key={f.label} style={styles.gridItem}>
                        <Text style={styles.fieldLabel}>{f.label}</Text>
                        <Text style={styles.fieldValue} numberOfLines={1}>{f.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    {visibleFields.map((f) => (
                      <View key={f.label} style={styles.rowField}>
                        <Text style={styles.rowFieldLabel}>{f.label}</Text>
                        <Text style={styles.rowFieldValue} numberOfLines={1}>{f.value}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {hiddenCount > 0 ? (
                  <Text style={styles.hiddenCount}>
                    +{hiddenCount} {hiddenCount === 1 ? 'campo adicional' : 'campos adicionais'}
                  </Text>
                ) : null}
              </View>
            )}

            {showObs ? (
              <>
                <Text style={styles.obsLabel}>{obsLabel}</Text>
                <TextInput
                  placeholder={obsPlaceholder}
                  placeholderTextColor={colors.textTertiary}
                  value={obsText}
                  onChangeText={onObsChange}
                  multiline
                  numberOfLines={3}
                  maxLength={obsMaxLength}
                  style={styles.obsInput}
                  textAlignVertical="top"
                />
              </>
            ) : null}

            {!alreadyScanned && extraFooter ? extraFooter : null}

            {!alreadyScanned && (
              <Pressable
                onPress={onConfirm}
                disabled={submitting}
                style={[styles.confirmButton, submitting && styles.confirmButtonDisabled]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : confirmIcon}
                <Text style={styles.confirmLabel}>{confirmLabel}</Text>
              </Pressable>
            )}

            <Pressable
              onPress={onClose}
              style={alreadyScanned ? styles.closeButtonLarge : styles.closeButton}
            >
              <Text style={alreadyScanned ? styles.closeLabelLarge : styles.closeLabel}>
                {alreadyScanned ? 'Fechar' : 'Cancelar'}
              </Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '90%',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    padding: 20,
  },
  banner: {
    marginBottom: 14,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: '#3A2A0D',
    borderWidth: 1,
    borderColor: '#6B4A1A',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bannerBody: {
    flex: 1,
    minWidth: 0,
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: font.weight.bold,
    color: '#F0C674',
    marginBottom: 2,
  },
  bannerDetail: {
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: '#B89660',
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: {
    fontSize: 15,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  participantBody: {
    flex: 1,
    minWidth: 0,
  },
  participantName: {
    fontSize: 15,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  participantBuyerHint: {
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: colors.textTertiary,
    fontStyle: 'italic',
    marginBottom: 2,
  },
  participantMeta: {
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: colors.textTertiary,
  },
  fieldsBox: {
    marginBottom: 16,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  formPendingBox: {
    marginBottom: 14,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: '#1F1A0F',
    borderWidth: 1,
    borderColor: '#4B3012',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  formPendingText: {
    flex: 1,
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: '#E8C77A',
    lineHeight: 15,
  },
  fieldsTitle: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridItem: {
    width: '50%',
    paddingRight: 10,
    paddingBottom: 6,
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: font.weight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  fieldValue: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: '#B0B0B0',
  },
  rowField: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowFieldLabel: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: colors.textSecondary,
    flexShrink: 0,
  },
  rowFieldValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  hiddenCount: {
    marginTop: 8,
    fontSize: 10,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  obsLabel: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  obsInput: {
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
  confirmButton: {
    width: '100%',
    height: 46,
    borderRadius: radius.md,
    marginTop: 16,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  confirmButtonDisabled: {
    opacity: 0.6,
  },
  confirmLabel: {
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
  closeButtonLarge: {
    width: '100%',
    height: 46,
    borderRadius: radius.md,
    marginTop: 16,
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabelLarge: {
    fontSize: 14,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
})
