import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius } from '@/theme'
import type { MobileParticipant } from '@/hooks/useParticipants'
import { Icon } from './Icon'

interface InstanceSelectorModalProps {
  /** Pending instances of the same orderItem returned by a single QR scan. */
  candidates: MobileParticipant[]
  title?: string
  subtitle?: string
  onPick: (participant: MobileParticipant) => void
  onClose: () => void
}

/**
 * Aparece depois de um scan que cai num order_item com múltiplas instâncias
 * ainda pendentes. O QR codifica só o id do order_item, então o operador tem
 * que escolher pra quem é o kit / check-in naquele momento.
 */
export function InstanceSelectorModal({
  candidates,
  title = 'Selecione o ingresso',
  subtitle,
  onPick,
  onClose,
}: InstanceSelectorModalProps) {
  const orderNumber = candidates[0]?.orderNumber || ''
  const total = candidates[0]?.instanceTotal

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
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>
              {subtitle ||
                `Pedido ${orderNumber}${total ? ` · ${candidates.length} pendentes de ${total}` : ''}`}
            </Text>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {candidates.map((p) => {
              const nameField = p.instanceFields?.find((f) => /nome/i.test(f.label))
              const idField = p.instanceFields?.find((f) => /cpf|rg|documento/i.test(f.label))
              return (
                <Pressable
                  key={p.id}
                  onPress={() => onPick(p)}
                  style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarLabel}>#{p.instanceIndex ?? '?'}</Text>
                  </View>
                  <View style={styles.itemBody}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {nameField?.value || p.name}
                    </Text>
                    <Text style={styles.itemCaption} numberOfLines={1}>
                      {p.instanceLabel || `Ingresso ${p.instanceIndex}`}
                      {idField ? ` · ${idField.value}` : ''}
                    </Text>
                  </View>
                  <Icon name="chevron_right" size={18} color={colors.textTertiary} />
                </Pressable>
              )
            })}
          </ScrollView>

          <Pressable onPress={onClose} style={styles.cancel}>
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '80%',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: colors.textSecondary,
  },
  list: {
    maxHeight: 360,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 6,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: '#2F2F2F',
  },
  itemPressed: {
    backgroundColor: colors.bgOverlay,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: {
    fontSize: 12,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  itemBody: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  itemCaption: {
    fontSize: 10,
    fontWeight: font.weight.medium,
    color: colors.textSecondary,
  },
  cancel: {
    marginHorizontal: 12,
    marginBottom: 12,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2F2F2F',
  },
  cancelLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
  },
})
