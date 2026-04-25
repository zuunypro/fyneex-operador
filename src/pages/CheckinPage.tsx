import { memo, useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { colors, font, radius } from '@/theme'
import { ApiError } from '@/services/api'
import { friendlyError } from '@/utils/errorMessages'
import { useNavigationStore } from '@/stores/navigationStore'
import { useParticipants, type MobileParticipant } from '@/hooks/useParticipants'
import { useCheckin } from '@/hooks/useCheckin'
import { useRevertCheckin } from '@/hooks/useRevertCheckin'
import { useRecentObservations } from '@/hooks/useRecentObservations'
import { useToast } from '@/hooks/useToast'
import { buildSearchIndex, groupByOrder, matchByIndex, type GroupInfo } from '@/utils/participants'
import { normalizeForSearch } from '@/utils/text'
import { formatCpfLast5, formatPhoneBR } from '@/utils/format'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { StalePacketWarning } from '@/components/StalePacketWarning'
import { feedbackBad, feedbackOk } from '@/utils/feedback'
import { QRScanner, type ScannedToken } from '@/components/QRScanner'
import { InstanceSelectorModal } from '@/components/InstanceSelectorModal'
import { ConfirmationModal } from '@/components/ConfirmationModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Toast } from '@/components/Toast'
import { Icon } from '@/components/Icon'

type FilterId = 'all' | 'pending' | 'checked'

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'checked', label: 'Confirmados' },
]

export function CheckinPage() {
  const event = useNavigationStore((s) => s.selectedEvent)!
  const setSelectedEvent = useNavigationStore((s) => s.setSelectedEvent)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterId>('all')
  const [modalParticipant, setModalParticipant] = useState<MobileParticipant | null>(null)
  const [obsText, setObsText] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [continuousScan, setContinuousScan] = useState(false)
  const [continuousCount, setContinuousCount] = useState(0)
  const [pendingScanGroup, setPendingScanGroup] = useState<MobileParticipant[] | null>(null)
  const [alreadyScanned, setAlreadyScanned] = useState<MobileParticipant | null>(null)
  const [revertTarget, setRevertTarget] = useState<MobileParticipant | null>(null)

  const { toast, show: showToast } = useToast()
  const recentObs = useRecentObservations(event.id)
  const { data, isLoading, isFetching, isError, refetch } = useParticipants(event.id, { pageSize: 500 })
  const checkinMutation = useCheckin()
  const revertMutation = useRevertCheckin()

  const participants = useMemo(() => {
    return (data?.participants || []).map((p) => ({
      ...p,
      observation: recentObs.map[p.id] || p.observation,
    }))
  }, [data?.participants, recentObs.map])

  // Debounce 250ms — sem isso, cada keystroke disparava filter() em 30k+
  // participantes. Em devices midrange isso somava a uns 80ms por toque, com
  // a sensação de teclado "preso". matchParticipant já normaliza acentos
  // internamente, então passamos o termo cru aqui.
  const debouncedSearch = useDebouncedValue(search, 250)

  // PERF: índice de busca pré-normalizado por participante. Construído
  // 1× por refetch (45s) — keystrokes só fazem `String.includes`,
  // sem `normalize('NFD')` repetido em 30k linhas.
  const searchIndex = useMemo(() => buildSearchIndex(participants), [participants])

  const filtered = useMemo(() => {
    const s = normalizeForSearch(debouncedSearch)
    const sDigits = debouncedSearch.replace(/\D/g, '')
    return participants.filter((p) => {
      if (s) {
        const idx = searchIndex.get(p.id) ?? ''
        if (!matchByIndex(p, idx, s, sDigits)) return false
      }
      if (filter === 'all') return true
      if (filter === 'pending') return p.status === 'pending'
      return p.status === 'checked'
    })
  }, [participants, debouncedSearch, filter, searchIndex])

  const counts = useMemo(() => {
    let pending = 0
    let checked = 0
    for (const p of participants) {
      if (p.status === 'pending') pending++
      else if (p.status === 'checked') checked++
    }
    return { all: participants.length, pending, checked }
  }, [participants])

  const grouped = useMemo(() => groupByOrder(filtered), [filtered])

  async function handleCheckin(p: MobileParticipant, observation: string) {
    if (checkinMutation.isPending) return
    const trimmed = observation.trim()
    if (trimmed) recentObs.set(p.id, trimmed)
    setModalParticipant(null)
    setObsText('')
    try {
      await checkinMutation.mutateAsync({
        participantId: p.participantId,
        eventId: event.id,
        instanceIndex: p.instanceIndex,
        observation: trimmed || undefined,
      })
      showToast('Check-in realizado!', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast('Participante já confirmado', 'success')
      } else {
        showToast(friendlyError(err, 'Erro ao realizar check-in'), 'error')
      }
    }
  }

  function openCheckinModal(p: MobileParticipant) {
    setModalParticipant(p)
    setObsText('')
  }

  async function executeRevertCheckin(p: MobileParticipant) {
    setRevertTarget(null)
    try {
      await revertMutation.mutateAsync({
        participantId: p.participantId,
        eventId: event.id,
        instanceIndex: p.instanceIndex,
      })
      recentObs.remove(p.id)
      showToast('Check-in revertido', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast('Este check-in já havia sido revertido', 'success')
      } else {
        showToast(friendlyError(err, 'Erro ao reverter check-in'), 'error')
      }
    }
  }

  async function handleScan(token: ScannedToken) {
    const matches = participants.filter((p) => p.participantId === token.participantId)
    if (matches.length > 0) {
      const stillPending = matches
        .filter((p) => p.status === 'pending')
        .sort((a, b) => (a.instanceIndex ?? 0) - (b.instanceIndex ?? 0))
      if (stillPending.length === 0) {
        const target = matches.find((p) => p.status === 'checked') || matches[0]
        setScannerOpen(false)
        setAlreadyScanned(target)
        return
      }
      if (stillPending.length > 1) {
        setScannerOpen(false)
        setPendingScanGroup(stillPending)
        return
      }
      setScannerOpen(false)
      openCheckinModal(stillPending[0])
      return
    }
    setScannerOpen(false)
    try {
      await checkinMutation.mutateAsync({
        participantId: token.participantId,
        eventId: event.id,
      })
      showToast('Check-in realizado!', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast('Participante já confirmado', 'success')
      } else {
        showToast(friendlyError(err, 'Erro ao realizar check-in'), 'error')
      }
    }
  }

  const handleContinuousScan = useCallback(async (token: ScannedToken) => {
    const matches = participants.filter((p) => p.participantId === token.participantId)
    if (matches.length === 0) {
      try {
        await checkinMutation.mutateAsync({
          participantId: token.participantId,
          eventId: event.id,
        })
        setContinuousCount((n) => n + 1)
        showToast('Check-in realizado', 'success')
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          showToast('Já confirmado', 'success')
        } else {
          feedbackBad()
          showToast(friendlyError(err, 'Erro ao realizar check-in'), 'error')
        }
      }
      return
    }
    const stillPending = matches
      .filter((p) => p.status === 'pending')
      .sort((a, b) => (a.instanceIndex ?? 0) - (b.instanceIndex ?? 0))
    if (stillPending.length === 0) {
      const target = matches.find((p) => p.status === 'checked') || matches[0]
      showToast(`${target.name} já confirmado`, 'success')
      return
    }
    if (stillPending.length > 1) {
      setScannerOpen(false)
      setPendingScanGroup(stillPending)
      return
    }
    const target = stillPending[0]
    try {
      await checkinMutation.mutateAsync({
        participantId: target.participantId,
        eventId: event.id,
        instanceIndex: target.instanceIndex,
      })
      setContinuousCount((n) => n + 1)
      showToast(`${target.name} ✓`, 'success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast(`${target.name} já confirmado`, 'success')
      } else {
        feedbackBad()
        showToast(friendlyError(err, 'Erro ao realizar check-in'), 'error')
      }
    }
  }, [participants, checkinMutation, event.id, showToast])

  if (scannerOpen) {
    return (
      <QRScanner
        expectedEventId={event.id}
        title={event.name}
        subtitle={continuousScan
          ? 'Modo contínuo · sem observação'
          : 'Check-in · aponte para o QR do ingresso'}
        onClose={() => setScannerOpen(false)}
        onScan={continuousScan ? handleContinuousScan : handleScan}
        continuous={continuousScan}
        onContinuousChange={(next) => {
          setContinuousScan(next)
          if (!next) setContinuousCount(0)
        }}
        statusHint={continuousCount > 0 ? `${continuousCount} lidos` : 'Contínuo'}
      />
    )
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => setSelectedEvent(null)} style={styles.swapButton}>
          <Icon name="swap_horiz" size={20} color={colors.textSecondary} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eventName} numberOfLines={1}>{event.name}</Text>
          <Text style={styles.eventCaption}>Check-in Manual</Text>
        </View>
        <View style={styles.liveBadge}>
          <View
            style={[
              styles.liveDot,
              { backgroundColor: isFetching ? colors.accentGreen : colors.textTertiary },
            ]}
          />
          <Text
            style={[
              styles.liveLabel,
              { color: isFetching ? colors.accentGreen : colors.textPrimary },
            ]}
          >
            Ao Vivo
          </Text>
        </View>
      </View>

      <View style={styles.stats}>
        <StatCell value={counts.checked} label="Feitos" />
        <View style={styles.statDivider} />
        <StatCell value={counts.pending} label="Pendentes" valueColor={colors.accentOrange} />
        <View style={styles.statDivider} />
        <StatCell
          value={counts.all > 0 ? `${Math.round((counts.checked / counts.all) * 100)}%` : '0%'}
          label="Taxa"
        />
      </View>

      <StalePacketWarning />

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Icon name="search" size={20} color={colors.textTertiary} />
          <TextInput
            placeholder="Buscar por nome, ID ou pedido..."
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Icon name="close" size={18} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.filtersRow}>
        {FILTERS.map((f) => {
          const active = filter === f.id
          const count = counts[f.id]
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>
                {f.label}
              </Text>
              <View style={[styles.filterCountBox, active && styles.filterCountBoxActive]}>
                <Text style={[styles.filterCountLabel, active && styles.filterCountLabelActive]}>
                  {count}
                </Text>
              </View>
            </Pressable>
          )
        })}
        <Pressable onPress={() => refetch()} style={styles.refreshButton}>
          <Icon name="refresh" size={14} color={colors.textTertiary} />
        </Pressable>
      </View>

      {isError && !isLoading ? (
        <View style={styles.errorCard}>
          <Icon name="wifi_off" size={36} color={colors.accentRed} />
          <Text style={styles.errorTitle}>Lista indisponível</Text>
          <Text style={styles.errorHint}>
            Use o scanner abaixo — o check-in vai ser salvo e sincronizado depois.
          </Text>
          <Pressable onPress={() => refetch()} style={styles.retryButton}>
            <Text style={styles.retryLabel}>Tentar recarregar</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
        <FlashList
          data={grouped.items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.listContent}
          estimatedItemSize={84}
          drawDistance={500}
          renderItem={({ item }) => (
            <ParticipantRow
              participant={item}
              group={grouped.groupOf.get(item.id)}
              isPending={
                checkinMutation.isPending &&
                checkinMutation.variables?.participantId === item.participantId &&
                checkinMutation.variables?.instanceIndex === item.instanceIndex
              }
              isReverting={
                revertMutation.isPending &&
                revertMutation.variables?.participantId === item.participantId &&
                revertMutation.variables?.instanceIndex === item.instanceIndex
              }
              onCheckin={() => openCheckinModal(item)}
              onRevert={() => setRevertTarget(item)}
            />
          )}
          ListEmptyComponent={
            isLoading ? null : (
              <View style={styles.emptyCard}>
                <Icon name="person_search" size={36} color={colors.borderDefault} />
                <Text style={styles.emptyLabel}>Nenhum participante encontrado</Text>
              </View>
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.accentGreen}
              colors={[colors.accentGreen]}
            />
          }
        />
        </View>
      )}

      <View style={styles.fabWrap} pointerEvents="box-none">
        <Pressable
          onPress={() => {
            feedbackOk()
            setContinuousCount(0)
            setScannerOpen(true)
          }}
          accessibilityLabel="Escanear QR Code"
          style={styles.fab}
        >
          <Icon name="qr_code_scanner" size={28} color={colors.bgBase} />
        </Pressable>
      </View>

      <Toast toast={toast} />

      {pendingScanGroup ? (
        <InstanceSelectorModal
          candidates={pendingScanGroup}
          subtitle={`Pedido ${pendingScanGroup[0]?.orderNumber || ''} · selecione qual ingresso confirmar`}
          onPick={(p) => { setPendingScanGroup(null); openCheckinModal(p) }}
          onClose={() => setPendingScanGroup(null)}
        />
      ) : null}

      {modalParticipant ? (
        <ConfirmationModal
          participant={modalParticipant}
          obsText={obsText}
          onObsChange={setObsText}
          fieldsTitle="Identificação deste ingresso"
          fieldsLayout="grid"
          fieldsLimit={6}
          confirmLabel="Confirmar"
          confirmIcon={<Icon name="how_to_reg" size={18} color={colors.textPrimary} />}
          onClose={() => { setModalParticipant(null); setObsText('') }}
          onConfirm={() => handleCheckin(modalParticipant, obsText)}
          submitting={checkinMutation.isPending}
        />
      ) : null}

      {alreadyScanned ? (
        <ConfirmationModal
          participant={alreadyScanned}
          fieldsTitle="Identificação deste ingresso"
          fieldsLayout="grid"
          fieldsLimit={6}
          confirmLabel=""
          alreadyScanned
          alreadyScannedMessage="Este QR já foi escaneado"
          alreadyScannedDetail={formatCheckedInAt(alreadyScanned.checkedInAt)}
          onClose={() => setAlreadyScanned(null)}
          onConfirm={() => setAlreadyScanned(null)}
        />
      ) : null}

      <ConfirmDialog
        open={!!revertTarget}
        title="Reverter check-in?"
        description={revertTarget
          ? `${revertTarget.instanceIndex !== undefined && revertTarget.instanceTotal !== undefined && revertTarget.instanceTotal > 1
              ? `${revertTarget.name} (ingresso #${revertTarget.instanceIndex})`
              : revertTarget.name}\nO participante voltará para a lista de pendentes.`
          : ''}
        confirmLabel="Reverter"
        tone="danger"
        onConfirm={() => revertTarget && executeRevertCheckin(revertTarget)}
        onCancel={() => setRevertTarget(null)}
      />
    </View>
  )
}

function StatCell({
  value,
  label,
  valueColor,
}: {
  value: number | string
  label: string
  valueColor?: string
}) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

const ParticipantRow = memo(function ParticipantRow({
  participant: p,
  isPending,
  isReverting,
  onCheckin,
  onRevert,
  group,
}: {
  participant: MobileParticipant
  isPending?: boolean
  isReverting?: boolean
  onCheckin: () => void
  onRevert: () => void
  group?: GroupInfo
}) {
  const isChecked = p.status === 'checked'
  const [expanded, setExpanded] = useState(false)
  const observation = p.observation

  return (
    <View style={[styles.row, isPending && { opacity: 0.7 }]}>
      {group ? (
        <View
          style={[
            styles.groupStripe,
            {
              backgroundColor: group.color,
              top: group.first ? 6 : 0,
              bottom: group.last ? 6 : 0,
            },
          ]}
        />
      ) : null}

      <View style={styles.rowTop}>
        <View style={{ position: 'relative' }}>
          <View style={styles.rowAvatar}>
            <Text style={styles.rowAvatarLabel}>{p.initials}</Text>
          </View>
          {isChecked ? (
            <View style={styles.checkedBadge}>
              <Icon name="check" size={11} color={colors.textPrimary} />
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={() => setExpanded(!expanded)}
          style={{ flex: 1, minWidth: 0 }}
        >
          <View style={styles.rowNameLine}>
            <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
            {p.instanceIndex !== undefined && p.instanceTotal !== undefined ? (
              <View style={styles.instanceBadge}>
                <Text style={styles.instanceBadgeLabel}>
                  #{p.instanceIndex}/{p.instanceTotal}
                </Text>
              </View>
            ) : null}
            {p.nameFromForm === false ? (
              <View style={styles.buyerFallbackBadge}>
                <Text style={styles.buyerFallbackLabel}>form pendente</Text>
              </View>
            ) : null}
          </View>
          {/* Quando form pendente (nome principal = "(Sem nome)"), mostra
              comprador em fonte menor cinza pra dar UMA referência visual
              pro operador — sem violar o pedido de não trocar o nome
              principal. Compromisso UX. */}
          {p.nameFromForm === false && p.buyerName && p.buyerName !== 'N/A' ? (
            <Text style={styles.buyerHint} numberOfLines={1}>
              Comprador: {p.buyerName}
            </Text>
          ) : null}
          <View style={styles.rowMeta}>
            <Text style={styles.rowMetaText} numberOfLines={1}>
              {group ? `${group.pos}/${group.total} · ` : ''}
              {p.orderNumber}
              {p.ticketName ? ` · ${p.ticketName}` : ''}
              {p.batch ? ` · ${p.batch}` : ''}
              {p.buyerCpfLast5 ? ` · CPF ${formatCpfLast5(p.buyerCpfLast5)}` : ' · sem CPF'}
            </Text>
            <Icon
              name="expand_more"
              size={13}
              color={colors.textTertiary}
              style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
            />
          </View>
        </Pressable>

        {isChecked ? (
          <Pressable onPress={() => setExpanded(!expanded)} style={styles.doneBlock}>
            <Icon name="check_circle" size={16} color={colors.accentGreen} />
            <Text style={styles.doneLabel}>Feito</Text>
          </Pressable>
        ) : isPending ? (
          <View style={styles.pendingBlock}>
            <ActivityIndicator size="small" color={colors.accentGreen} />
          </View>
        ) : (
          <Pressable onPress={onCheckin} style={styles.confirmBlock}>
            <Icon name="how_to_reg" size={16} color={colors.textPrimary} />
            <Text style={styles.confirmLabel}>Confirmar</Text>
          </Pressable>
        )}
      </View>

      {expanded ? (
        <View style={styles.details}>
          <View>
            <Text style={styles.detailSectionLabel}>Comprador</Text>
            {/* 4 dados sempre visíveis (Nome, Email, Telefone, CPF) — usar
                "—" quando ausente pra operador entender que é gap, não bug. */}
            <View style={styles.detailGrid}>
              <DetailField label="Nome" value={p.buyerName || '—'} />
              <DetailField label="Email" value={p.buyerEmail || p.email || '—'} />
              <DetailField label="Telefone" value={formatPhoneBR(p.buyerPhone)} />
              <DetailField
                label="CPF (final)"
                value={formatCpfLast5(p.buyerCpfLast5)}
              />
            </View>
          </View>

          <View>
            <Text style={styles.detailSectionLabel}>Compra</Text>
            <View style={styles.detailGrid}>
              <DetailField label="Pedido" value={p.orderNumber || '—'} />
              <DetailField label="Ingresso" value={p.ticketName || '—'} />
              {p.batch ? <DetailField label="Lote" value={p.batch} /> : null}
            </View>
          </View>

          {(() => {
            const extraFields = (p.instanceFields || []).filter(
              (f) => !f.label.toLowerCase().includes('nome'),
            )
            const formUnfilled = p.nameFromForm === false && extraFields.length === 0
            if (formUnfilled) {
              return (
                <View style={styles.noFormBlock}>
                  <Icon name="priority_high" size={14} color={colors.accentOrange} />
                  <Text style={styles.noFormText}>
                    Participante ainda não preencheu o formulário do evento. Confirme a identidade pelo CPF do comprador (no detalhe abaixo) ou pelo número do pedido.
                  </Text>
                </View>
              )
            }
            if (extraFields.length === 0) return null
            return (
              <View>
                <Text style={styles.detailSectionLabel}>Dados do participante</Text>
                <View style={styles.detailGrid}>
                  {extraFields.map((f) => (
                    <DetailField key={f.label} label={f.label} value={f.value} />
                  ))}
                </View>
              </View>
            )
          })()}

          {isChecked ? (
            <View style={styles.obsBlock}>
              <Text style={styles.detailSectionLabel}>Observação</Text>
              <Text
                style={[
                  styles.obsText,
                  { color: observation ? '#B0B0B0' : '#444444' },
                ]}
              >
                {observation || 'Nenhuma observação registrada.'}
              </Text>
            </View>
          ) : null}

          {isChecked ? (
            <Pressable
              onPress={onRevert}
              disabled={isReverting}
              style={[styles.revertButton, isReverting && { opacity: 0.7 }]}
            >
              {isReverting ? (
                <ActivityIndicator size="small" color={colors.accentRed} />
              ) : (
                <Icon name="refresh" size={16} color={colors.accentRed} />
              )}
              <Text style={styles.revertLabel}>
                {isReverting ? 'Revertendo...' : 'Reverter check-in'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
})

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailField}>
      <Text style={styles.detailFieldLabel}>{label}</Text>
      <Text style={styles.detailFieldValue} numberOfLines={1}>{value}</Text>
    </View>
  )
}

function formatCheckedInAt(iso: string | null | undefined): string | undefined {
  if (!iso) return 'Check-in já registrado para este ingresso.'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Check-in já registrado para este ingresso.'
  const date = d
    .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    .replace('.', '')
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `Check-in feito em ${date} às ${time}`
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  swapButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventName: {
    fontSize: 15,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  eventCaption: {
    fontSize: 10,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  stats: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    overflow: 'hidden',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: 1,
    marginVertical: 10,
    backgroundColor: colors.borderMuted,
  },
  searchRow: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 40,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: font.weight.medium,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  filterChipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: font.weight.semibold,
    color: colors.textSecondary,
  },
  filterLabelActive: {
    color: colors.bgBase,
  },
  filterCountBox: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.bgOverlay,
  },
  filterCountBoxActive: {
    backgroundColor: colors.borderDefault,
  },
  filterCountLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
  },
  filterCountLabelActive: {
    color: colors.textPrimary,
  },
  refreshButton: {
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  list: {
    flex: 1,
    marginTop: 8,
    marginHorizontal: 20,
  },
  listContent: {
    paddingBottom: 90,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderMuted,
    position: 'relative',
  },
  groupStripe: {
    position: 'absolute',
    left: 0,
    width: 3,
    borderRadius: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowAvatar: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarLabel: {
    fontSize: 13,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
  },
  checkedBadge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 2,
    borderColor: colors.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 1,
  },
  rowName: {
    flex: 1,
    fontSize: 13,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  instanceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: '#1E2A3E',
    borderWidth: 1,
    borderColor: '#2A3E5A',
  },
  instanceBadgeLabel: {
    fontSize: 9,
    fontWeight: font.weight.extrabold,
    color: '#79B8FF',
  },
  buyerFallbackBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: '#2A1F12',
    borderWidth: 1,
    borderColor: '#4B3012',
  },
  buyerFallbackLabel: {
    fontSize: 9,
    fontWeight: font.weight.extrabold,
    color: colors.accentOrange,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  buyerHint: {
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: colors.textTertiary,
    marginTop: 2,
    fontStyle: 'italic',
  },
  noFormBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: '#1F1A0F',
    borderWidth: 1,
    borderColor: '#4B3012',
  },
  noFormText: {
    flex: 1,
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: '#E8C77A',
    lineHeight: 15,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rowMetaText: {
    flex: 1,
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: colors.textTertiary,
  },
  doneBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  doneLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.accentGreen,
  },
  pendingBlock: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: '#1A2E1A',
    borderWidth: 1,
    borderColor: '#2A4A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBlock: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  confirmLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  details: {
    marginTop: 10,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    gap: 10,
  },
  detailSectionLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  detailBuyer: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  detailBuyerEmail: {
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: colors.textSecondary,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  detailField: {
    width: '50%',
    paddingRight: 10,
    paddingBottom: 6,
  },
  detailFieldLabel: {
    fontSize: 9,
    fontWeight: font.weight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  detailFieldValue: {
    fontSize: 11,
    fontWeight: font.weight.semibold,
    color: '#B0B0B0',
  },
  obsBlock: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#222222',
  },
  obsText: {
    fontSize: 12,
    fontWeight: font.weight.medium,
  },
  revertButton: {
    marginTop: 4,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: '#2A1414',
    borderWidth: 1,
    borderColor: '#4A1A1A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  revertLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.accentRed,
  },
  errorCard: {
    margin: 20,
    padding: 40,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    gap: 10,
  },
  errorTitle: {
    fontSize: 13,
    fontWeight: font.weight.semibold,
    color: colors.textPrimary,
  },
  errorHint: {
    fontSize: 11,
    fontWeight: font.weight.medium,
    color: '#B0B0B0',
    textAlign: 'center',
    lineHeight: 15,
    paddingHorizontal: 12,
  },
  retryButton: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.accentGreenDim,
    borderWidth: 1,
    borderColor: colors.accentGreen,
  },
  retryLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  emptyCard: {
    padding: 40,
    alignItems: 'center',
    gap: 10,
  },
  emptyLabel: {
    fontSize: 13,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
  },
  fabWrap: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 60,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.textPrimary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
})
