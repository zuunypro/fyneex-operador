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
import { useKitWithdrawal } from '@/hooks/useKitWithdrawal'
import { useRevertKit } from '@/hooks/useRevertKit'
import { useInventory } from '@/hooks/useInventory'
import { useToast } from '@/hooks/useToast'
import { buildSearchIndex, groupByOrder, matchByIndex, type GroupInfo } from '@/utils/participants'
import { normalizeForSearch } from '@/utils/text'
import { isKitFieldLabel } from '@/utils/fieldClassification'
import { formatCpfLast5, formatPhoneBR } from '@/utils/format'
import { DetailField } from '@/components/DetailField'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { StalePacketWarning } from '@/components/StalePacketWarning'
import { feedbackBad, feedbackOk } from '@/utils/feedback'
import { QRScanner, type ScannedToken } from '@/components/QRScanner'
import { InstanceSelectorModal } from '@/components/InstanceSelectorModal'
import { ConfirmationModal } from '@/components/ConfirmationModal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ForceWithdrawalModal } from '@/components/ForceWithdrawalModal'
import { Toast } from '@/components/Toast'
import { Icon } from '@/components/Icon'

type FilterId = 'all' | 'pending' | 'delivered'

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'delivered', label: 'Entregues' },
]

export function StockPage() {
  const event = useNavigationStore((s) => s.selectedEvent)!
  const setSelectedEvent = useNavigationStore((s) => s.setSelectedEvent)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterId>('all')
  const [modalParticipant, setModalParticipant] = useState<MobileParticipant | null>(null)
  const [pendingScanGroup, setPendingScanGroup] = useState<MobileParticipant[] | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [continuousScan, setContinuousScan] = useState(false)
  const [continuousCount, setContinuousCount] = useState(0)
  const [alreadyScanned, setAlreadyScanned] = useState<MobileParticipant | null>(null)
  const [revertTarget, setRevertTarget] = useState<MobileParticipant | null>(null)
  const [showInventorySummary, setShowInventorySummary] = useState(false)
  // Servidor recusou retirada por falta de estoque vinculado (422
  // KIT_NO_STOCK_CONFIGURED). Operador pode forçar com motivo — re-tenta com
  // allowNoStock=true. Mantemos o participant + serverMessage pra reabrir o
  // modal com contexto e o continuação (ex: avançar próximo scan) depois.
  const [forcePrompt, setForcePrompt] = useState<{
    participant: MobileParticipant
    serverMessage?: string
  } | null>(null)

  const { toast, show: showToast } = useToast()
  const { data, isLoading, isFetching, isError, refetch } = useParticipants(event.id, { pageSize: 500 })
  const withdrawMutation = useKitWithdrawal()
  const revertMutation = useRevertKit()
  const inventory = useInventory(event.id)

  const participants = useMemo(() => {
    const all = data?.participants || []
    const allHaveFlag = all.length > 0 && all.every((p) => typeof p.hasKit === 'boolean')
    return allHaveFlag ? all.filter((p) => p.hasKit) : all
  }, [data?.participants])

  // Truth unica: kitWithdrawnAt do servidor (onMutate do useKitWithdrawal ja
  // seta otimista). Antes usavamos tambem um Set local persistido — isso
  // causava "100%" errado quando sessoes antigas deixavam IDs como entregues
  // e o servidor tinha revertido no meantime.
  const isDelivered = useCallback(
    (p: MobileParticipant) => Boolean(p.kitWithdrawnAt),
    [],
  )

  // Debounce 250ms — sem isso cada keystroke filtrava 30k+ participantes.
  // matchParticipant normaliza acentos internamente, então passa o cru.
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
      const done = isDelivered(p)
      if (filter === 'all') return true
      if (filter === 'pending') return !done
      return done
    })
  }, [participants, debouncedSearch, filter, isDelivered, searchIndex])

  const counts = useMemo(() => {
    let deliveredCount = 0
    for (const p of participants) if (isDelivered(p)) deliveredCount++
    return {
      all: participants.length,
      pending: participants.length - deliveredCount,
      delivered: deliveredCount,
    }
  }, [participants, isDelivered])

  const grouped = useMemo(() => groupByOrder(filtered), [filtered])

  const inventorySummary = useMemo(() => {
    const items = inventory.data?.items || []
    if (items.length === 0) return null
    const low = items.filter((i) => i.status === 'low')
    const out = items.filter((i) => i.status === 'out')
    return { items, low, out }
  }, [inventory.data?.items])

  // Map de busca rápida pra o expand do KitRow exibir estoque ao lado
  // de cada item do kit. Key normalizada pra "ticket - label" lowercase
  // — bate com o formato usado em inventory_items.category.
  const stockByCategory = useMemo(() => {
    const map = new Map<
      string,
      { currentStock: number; reservedStock: number; status: string }
    >()
    const items = inventory.data?.items || []
    for (const item of items) {
      if (typeof item.category !== 'string') continue
      const key = item.category.trim().toLowerCase()
      if (!key) continue
      // Se houver múltiplos items com mesma category (variantes), soma
      // current_stock — operador vê o total disponível pra essa linha.
      const prev = map.get(key)
      if (prev) {
        prev.currentStock += item.currentStock
        prev.reservedStock += item.reservedStock
        if (item.status === 'out' || prev.status === 'out') prev.status = 'out'
        else if (item.status === 'low' || prev.status === 'low') prev.status = 'low'
      } else {
        map.set(key, {
          currentStock: item.currentStock,
          reservedStock: item.reservedStock,
          status: item.status,
        })
      }
    }
    return map
  }, [inventory.data?.items])

  function isForceableNoStockError(err: unknown): err is ApiError {
    return (
      err instanceof ApiError &&
      err.status === 422 &&
      (err.code === 'KIT_NO_STOCK_CONFIGURED' || err.code === 'FORCE_REASON_REQUIRED')
    )
  }

  async function handleWithdraw(p: MobileParticipant) {
    if (withdrawMutation.isPending) return
    setModalParticipant(null)
    try {
      const res = await withdrawMutation.mutateAsync({
        participantId: p.participantId,
        eventId: event.id,
        instanceIndex: p.instanceIndex,
      })
      const firstErr = res?.kit?.errors?.[0]
      if (firstErr) {
        showToast(`Entregue parcial: ${firstErr.message}`, 'error')
      } else if (res?.implicitCheckIn) {
        showToast('Kit entregue e check-in validado!', 'success')
      } else {
        showToast('Kit entregue!', 'success')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast('Kit já havia sido retirado', 'success')
      } else if (isForceableNoStockError(err)) {
        setForcePrompt({ participant: p, serverMessage: err.message })
      } else {
        showToast(friendlyError(err, 'Erro ao entregar kit'), 'error')
      }
    }
  }

  async function executeForceWithdraw(reason: string) {
    if (!forcePrompt) return
    const p = forcePrompt.participant
    try {
      const res = await withdrawMutation.mutateAsync({
        participantId: p.participantId,
        eventId: event.id,
        instanceIndex: p.instanceIndex,
        allowNoStock: true,
        allowNoStockReason: reason,
      })
      setForcePrompt(null)
      if (res?.implicitCheckIn) {
        showToast('Retirada forçada + check-in validado', 'success')
      } else {
        showToast('Retirada forçada registrada', 'success')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setForcePrompt(null)
        showToast('Kit já havia sido retirado', 'success')
      } else {
        // Mantém o modal aberto pra operador ajustar motivo / cancelar
        showToast(friendlyError(err, 'Erro ao forçar retirada'), 'error')
      }
    }
  }

  async function executeRevertKit(p: MobileParticipant) {
    setRevertTarget(null)
    try {
      await revertMutation.mutateAsync({
        participantId: p.participantId,
        eventId: event.id,
      })
      showToast('Retirada revertida', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast('Nenhuma retirada para reverter', 'success')
      } else {
        showToast(friendlyError(err, 'Erro ao reverter retirada'), 'error')
      }
    }
  }

  async function handleScan(token: ScannedToken) {
    const matches = participants.filter((p) => p.participantId === token.participantId)
    if (matches.length > 0) {
      const stillPending = matches
        .filter((p) => !isDelivered(p))
        .sort((a, b) => (a.instanceIndex ?? 0) - (b.instanceIndex ?? 0))
      if (stillPending.length === 0) {
        const target = matches.find((p) => isDelivered(p)) || matches[0]
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
      setModalParticipant(stillPending[0])
      return
    }
    setScannerOpen(false)
    try {
      const res = await withdrawMutation.mutateAsync({
        participantId: token.participantId,
        eventId: event.id,
      })
      const firstErr = res?.kit?.errors?.[0]
      if (firstErr) {
        showToast(`Entregue parcial: ${firstErr.message}`, 'error')
      } else if (res?.implicitCheckIn) {
        showToast('Kit entregue e check-in validado!', 'success')
      } else {
        showToast('Kit entregue!', 'success')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast('Kit já havia sido retirado', 'success')
      } else if (isForceableNoStockError(err)) {
        // QR não tinha matches locais (participantes desconhecido pro app), mas o
        // servidor encontrou e recusou por falta de estoque. Não temos um
        // MobileParticipant pra abrir o ForceWithdrawalModal — orienta o operador
        // a buscar manualmente, onde o fluxo de força tá disponível.
        showToast(
          'Sem estoque vinculado — busque o participante na lista pra forçar',
          'error',
        )
      } else {
        showToast(friendlyError(err, 'Erro ao entregar kit'), 'error')
      }
    }
  }

  const handleContinuousScan = useCallback(async (token: ScannedToken) => {
    const matches = participants.filter((p) => p.participantId === token.participantId)
    if (matches.length === 0) {
      try {
        const res = await withdrawMutation.mutateAsync({
          participantId: token.participantId,
          eventId: event.id,
        })
        setContinuousCount((n) => n + 1)
        const firstErr = res?.kit?.errors?.[0]
        if (firstErr) { feedbackBad(); showToast(`Parcial: ${firstErr.message}`, 'error') }
        else showToast('Kit entregue', 'success')
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) showToast('Kit já retirado', 'success')
        else { feedbackBad(); showToast(friendlyError(err, 'Erro ao entregar kit'), 'error') }
      }
      return
    }
    const stillPending = matches
      .filter((p) => !isDelivered(p))
      .sort((a, b) => (a.instanceIndex ?? 0) - (b.instanceIndex ?? 0))
    if (stillPending.length === 0) {
      const target = matches.find((p) => isDelivered(p)) || matches[0]
      showToast(`${target.name} já retirou`, 'success')
      return
    }
    if (stillPending.length > 1) {
      setScannerOpen(false)
      setPendingScanGroup(stillPending)
      return
    }
    const target = stillPending[0]
    try {
      const res = await withdrawMutation.mutateAsync({
        participantId: target.participantId,
        eventId: event.id,
        instanceIndex: target.instanceIndex,
      })
      setContinuousCount((n) => n + 1)
      const firstErr = res?.kit?.errors?.[0]
      if (firstErr) { feedbackBad(); showToast(`Parcial: ${firstErr.message}`, 'error') }
      else showToast(`${target.name} ✓`, 'success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast(`${target.name} já retirou`, 'success')
      } else { feedbackBad(); showToast(friendlyError(err, 'Erro ao entregar kit'), 'error') }
    }
  }, [participants, withdrawMutation, event.id, isDelivered, showToast])

  if (scannerOpen) {
    return (
      <QRScanner
        expectedEventId={event.id}
        title={event.name}
        subtitle={continuousScan
          ? 'Modo contínuo · retirada'
          : 'Retirada de kit · aponte para o QR'}
        onClose={() => setScannerOpen(false)}
        onScan={continuousScan ? handleContinuousScan : handleScan}
        continuous={continuousScan}
        onContinuousChange={(next) => {
          setContinuousScan(next)
          if (!next) setContinuousCount(0)
        }}
        statusHint={continuousCount > 0 ? `${continuousCount} retirados` : 'Contínuo'}
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
          <Text style={styles.eventCaption}>Retirada de Kit</Text>
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
        <StatCell value={counts.delivered} label="Entregues" />
        <View style={styles.statDivider} />
        <StatCell value={counts.pending} label="Pendentes" valueColor={colors.accentOrange} />
        <View style={styles.statDivider} />
        <StatCell
          value={counts.all > 0 ? `${Math.round((counts.delivered / counts.all) * 100)}%` : '0%'}
          label="Taxa"
        />
      </View>

      <StalePacketWarning />

      {inventorySummary && inventorySummary.items.length > 0 ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <Pressable
            onPress={() => setShowInventorySummary((v) => !v)}
            style={styles.inventoryPill}
          >
            <Icon
              name="inventory_2"
              size={16}
              color={inventorySummary.out.length > 0 ? colors.accentRed : colors.textSecondary}
            />
            <Text style={styles.inventoryPillLabel} numberOfLines={1}>
              {inventorySummary.items.length} itens
              {inventorySummary.out.length > 0 ? ` · ${inventorySummary.out.length} esgotado(s)` : ''}
              {inventorySummary.low.length > 0 ? ` · ${inventorySummary.low.length} baixo(s)` : ''}
            </Text>
            <Icon
              name="expand_more"
              size={18}
              color={colors.textTertiary}
              style={{ transform: [{ rotate: showInventorySummary ? '180deg' : '0deg' }] }}
            />
          </Pressable>

          {showInventorySummary ? (
            <View style={styles.inventoryPanel}>
              {inventorySummary.items.map((item) => {
                const tone =
                  item.status === 'out' ? styles.inventoryRowOut
                  : item.status === 'low' ? styles.inventoryRowLow
                  : styles.inventoryRowOk
                return (
                  <View key={item.id} style={[styles.inventoryRow, tone]}>
                    <Text style={styles.inventoryName} numberOfLines={1}>
                      {item.name}{item.variant ? ` · ${item.variant}` : ''}
                    </Text>
                    <Text style={styles.inventoryStock}>
                      {item.currentStock}/{item.currentStock + item.withdrawnStock}
                    </Text>
                  </View>
                )
              })}
            </View>
          ) : null}
        </View>
      ) : null}

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
            Use o scanner abaixo — a retirada vai ser salva e sincronizada depois.
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
            <KitRow
              participant={item}
              group={grouped.groupOf.get(item.id)}
              delivered={isDelivered(item)}
              stockByCategory={stockByCategory}
              isPending={
                withdrawMutation.isPending &&
                withdrawMutation.variables?.participantId === item.participantId &&
                withdrawMutation.variables?.instanceIndex === item.instanceIndex
              }
              isReverting={
                revertMutation.isPending &&
                revertMutation.variables?.participantId === item.participantId
              }
              onWithdraw={() => setModalParticipant(item)}
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
              onRefresh={() => {
                refetch()
                inventory.refetch()
              }}
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
          subtitle={`Pedido ${pendingScanGroup[0]?.orderNumber || ''} · selecione para entregar`}
          onPick={(p) => { setPendingScanGroup(null); setModalParticipant(p) }}
          onClose={() => setPendingScanGroup(null)}
        />
      ) : null}

      {modalParticipant ? (
        <ConfirmationModal
          participant={modalParticipant}
          fieldsTitle="Kit a entregar"
          fieldsLayout="rows"
          fieldsLimit={10}
          confirmLabel="Entregar kit"
          confirmIcon={<Icon name="redeem" size={18} color={colors.textPrimary} />}
          onClose={() => setModalParticipant(null)}
          onConfirm={() => handleWithdraw(modalParticipant)}
          submitting={withdrawMutation.isPending}
        />
      ) : null}

      {alreadyScanned ? (
        <ConfirmationModal
          participant={alreadyScanned}
          fieldsTitle="Kit deste ingresso"
          fieldsLayout="rows"
          fieldsLimit={10}
          confirmLabel=""
          alreadyScanned
          alreadyScannedMessage="Kit já retirado"
          alreadyScannedDetail={formatWithdrawnAt(alreadyScanned.kitWithdrawnAt)}
          onClose={() => setAlreadyScanned(null)}
          onConfirm={() => setAlreadyScanned(null)}
        />
      ) : null}

      <ConfirmDialog
        open={!!revertTarget}
        title="Reverter retirada?"
        description={revertTarget
          ? `${revertTarget.name}\nO kit voltará ao estoque e esta retirada será desfeita.`
          : ''}
        confirmLabel="Reverter"
        tone="danger"
        onConfirm={() => revertTarget && executeRevertKit(revertTarget)}
        onCancel={() => setRevertTarget(null)}
      />

      {forcePrompt ? (
        <ForceWithdrawalModal
          participantName={forcePrompt.participant.name}
          serverMessage={forcePrompt.serverMessage}
          submitting={withdrawMutation.isPending}
          onConfirm={executeForceWithdraw}
          onClose={() => setForcePrompt(null)}
        />
      ) : null}
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

interface StockInfo {
  currentStock: number
  reservedStock: number
  status: string
}

const KitRow = memo(function KitRow({
  participant: p,
  delivered: isDone,
  isPending,
  isReverting,
  onWithdraw,
  onRevert,
  group,
  stockByCategory,
}: {
  participant: MobileParticipant
  delivered: boolean
  isPending?: boolean
  isReverting?: boolean
  onWithdraw: () => void
  onRevert: () => void
  group?: GroupInfo
  stockByCategory: Map<string, StockInfo>
}) {
  const [expanded, setExpanded] = useState(false)

  // Identifica os campos do kit (Camiseta, Medalha, etc.) e busca
  // o estoque vinculado pela category "ticket - Label". Operador no
  // balcão precisa ver "Camiseta GG → 12 disponíveis" pra saber se
  // ainda tem estoque do tamanho pedido SEM precisar trocar de tela.
  const kitItems = useMemo(() => {
    const fields = p.instanceFields || []
    const ticketLower = (p.ticketName || '').toLowerCase().trim()
    const list: Array<{ label: string; value: string; stock: StockInfo | null }> = []
    for (const f of fields) {
      if (!isKitFieldLabel(f.label)) continue
      const stockKey = `${ticketLower} - ${f.label.toLowerCase().trim()}`
      const stock = stockByCategory.get(stockKey) ?? null
      list.push({ label: f.label, value: f.value, stock })
    }
    return list
  }, [p.instanceFields, p.ticketName, stockByCategory])

  // Headline visual no card: mostra os itens do kit + valor selecionado
  // na linha colapsada, então operador NÃO precisa abrir pra entregar a
  // maioria dos kits — só olha o badge e entrega. Se tem 1 item só, mostra
  // "Camiseta GG"; com vários, "Camiseta GG · Medalha Ouro".
  const kitSummary = useMemo(() => {
    if (kitItems.length === 0) return null
    return kitItems
      .map((k) => `${k.label} ${k.value || '?'}`.trim())
      .join(' · ')
  }, [kitItems])

  const buyerDifferent =
    p.buyerName && p.buyerName !== 'N/A' && p.buyerName !== p.name
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
          {isDone ? (
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
          {p.nameFromForm === false && p.buyerName && p.buyerName !== 'N/A' ? (
            <Text style={styles.buyerHint} numberOfLines={1}>
              Comprador: {p.buyerName}
            </Text>
          ) : null}
          {kitSummary ? (
            <View style={styles.kitSummaryLine}>
              <Icon name="redeem" size={11} color={colors.accentGreen} />
              <Text style={styles.kitSummaryText} numberOfLines={1}>
                {kitSummary}
              </Text>
            </View>
          ) : null}
          <View style={styles.rowMeta}>
            <Text style={styles.rowMetaText} numberOfLines={1}>
              {group ? `${group.pos}/${group.total} · ` : ''}
              {p.orderNumber}
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

        {isDone ? (
          <Pressable
            onPress={() => setExpanded(!expanded)}
            style={styles.doneBlock}
          >
            <Icon name="check_circle" size={16} color={colors.accentGreen} />
            <Text style={styles.doneLabel}>Entregue</Text>
          </Pressable>
        ) : isPending ? (
          <View style={styles.pendingBlock}>
            <ActivityIndicator size="small" color={colors.accentGreen} />
          </View>
        ) : (
          <Pressable onPress={onWithdraw} style={styles.confirmBlock}>
            <Icon name="redeem" size={16} color={colors.textPrimary} />
            <Text style={styles.confirmLabel}>Entregar</Text>
          </Pressable>
        )}
      </View>

      {expanded ? (
        <View style={styles.details}>
          {/* ❶ KIT A ENTREGAR — destaque visual máximo. Operador NO BALCÃO
                precisa enxergar tamanho selecionado + estoque restante numa
                olhada só. Tudo o resto vem depois. */}
          {kitItems.length > 0 ? (
            <View>
              <Text style={styles.detailSectionLabelPrimary}>
                Kit a entregar
              </Text>
              <View style={{ gap: 8 }}>
                {kitItems.map((k, i) => (
                  <View key={`${k.label}-${i}`} style={styles.kitLineCard}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.kitLineLabel} numberOfLines={1}>
                        {k.label}
                      </Text>
                      <Text style={styles.kitLineValue} numberOfLines={1}>
                        {k.value || 'sem variante'}
                      </Text>
                    </View>
                    {k.stock ? (
                      <View
                        style={[
                          styles.stockBadge,
                          k.stock.status === 'out' && styles.stockBadgeOut,
                          k.stock.status === 'low' && styles.stockBadgeLow,
                        ]}
                      >
                        <Text
                          style={[
                            styles.stockBadgeValue,
                            k.stock.status === 'out' && { color: colors.accentRed },
                            k.stock.status === 'low' && { color: colors.accentOrange },
                          ]}
                        >
                          {k.stock.currentStock}
                        </Text>
                        <Text style={styles.stockBadgeLabel}>em estoque</Text>
                      </View>
                    ) : (
                      <View style={styles.stockBadge}>
                        <Text style={[styles.stockBadgeValue, { color: colors.textTertiary }]}>—</Text>
                        <Text style={styles.stockBadgeLabel}>sem item</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.noFormBlock}>
              <Icon
                name={p.nameFromForm === false ? 'priority_high' : 'info'}
                size={14}
                color={colors.accentOrange}
              />
              <Text style={styles.noFormText}>
                {p.nameFromForm === false
                  ? 'Participante não preencheu o formulário. Confirme pelo CPF/pedido e combine com o comprador o que entregar.'
                  : 'Pedido sem itens de kit configurados — não tem nada pra entregar aqui.'}
              </Text>
            </View>
          )}

          {/* ❷ CONFERIR IDENTIDADE — CPF + Pedido + Comprador (se diferente).
                Telefone fica aqui também porque operador no balcão de
                kit liga pro comprador quando: ingresso transferido,
                pedido perdido, ou tamanho indisponível pra trocar. */}
          <View>
            <Text style={styles.detailSectionLabel}>Conferir identidade</Text>
            <View style={styles.detailGrid}>
              <DetailField
                label="CPF (final)"
                value={formatCpfLast5(p.buyerCpfLast5)}
              />
              <DetailField label="Pedido" value={p.orderNumber || '—'} />
              <DetailField label="Telefone" value={formatPhoneBR(p.buyerPhone)} />
              {buyerDifferent ? (
                <DetailField label="Comprador" value={p.buyerName!} />
              ) : null}
              {p.instanceIndex && p.instanceTotal && p.instanceTotal > 1 ? (
                <DetailField
                  label="Posição"
                  value={`${p.instanceIndex} de ${p.instanceTotal}`}
                />
              ) : null}
            </View>
          </View>

          {/* ❸ STATUS — sempre claro: pendente ou entregue + quando. */}
          <View>
            <Text style={styles.detailSectionLabel}>Status</Text>
            {isDone && p.kitWithdrawnAt ? (
              <Text style={styles.statusOkText}>
                ✓ {formatWithdrawnAt(p.kitWithdrawnAt)}
              </Text>
            ) : isDone ? (
              <Text style={styles.statusOkText}>✓ Kit já entregue</Text>
            ) : (
              <Text style={styles.statusPendingText}>
                ● Pendente — kit ainda não entregue
              </Text>
            )}
          </View>

          {/* ❹ AÇÕES — só Reverter quando entregue (pra corrigir engano). */}
          {isDone ? (
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
                {isReverting ? 'Revertendo...' : 'Reverter retirada'}
              </Text>
            </Pressable>
          ) : null}

          {/* ❺ Email — só pra exceção (mandar email pro comprador
                pedindo confirmação). Telefone subiu pra identidade. */}
          {(p.buyerEmail || p.email) ? (
            <View style={styles.contactStrip}>
              <Text style={styles.contactStripText} numberOfLines={1}>
                ✉ {p.buyerEmail || p.email}
              </Text>
              {p.ticketName ? (
                <Text style={styles.contactStripText} numberOfLines={1}>
                  🎫 {p.ticketName}
                  {p.batch ? ` · ${p.batch}` : ''}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
})

function formatWithdrawnAt(iso: string | null | undefined): string | undefined {
  if (!iso) return 'Kit já retirado para este ingresso.'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Kit já retirado para este ingresso.'
  const date = d
    .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    .replace('.', '')
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `Kit retirado em ${date} às ${time}`
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
  inventoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  inventoryPillLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: font.weight.semibold,
    color: colors.textPrimary,
  },
  inventoryPanel: {
    marginTop: 6,
    padding: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    gap: 4,
  },
  inventoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  inventoryRowOk: {
    backgroundColor: colors.bgBase,
    borderColor: colors.borderMuted,
  },
  inventoryRowLow: {
    backgroundColor: colors.accentOrangeBg,
    borderColor: colors.accentOrangeBorder,
  },
  inventoryRowOut: {
    backgroundColor: colors.accentRedBg,
    borderColor: colors.accentRedBorder,
  },
  inventoryName: {
    flex: 1,
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
  },
  inventoryStock: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.textSecondary,
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
  detailSectionLabelPrimary: {
    fontSize: 11,
    fontWeight: font.weight.extrabold,
    color: colors.accentGreen,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  kitSummaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  kitSummaryText: {
    flex: 1,
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.accentGreen,
    letterSpacing: 0.2,
  },
  kitLineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: '#0F1F0F',
    borderWidth: 1,
    borderColor: '#234B23',
  },
  kitLineLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  kitLineValue: {
    fontSize: 14,
    fontWeight: font.weight.extrabold,
    color: colors.textPrimary,
    marginTop: 2,
  },
  stockBadge: {
    minWidth: 64,
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.bgBase,
    borderWidth: 1,
    borderColor: colors.borderMuted,
  },
  stockBadgeLow: {
    borderColor: '#4B3012',
    backgroundColor: '#1F1A0F',
  },
  stockBadgeOut: {
    borderColor: '#4A1F1F',
    backgroundColor: '#2A1414',
  },
  stockBadgeValue: {
    fontSize: 16,
    fontWeight: font.weight.extrabold,
    color: colors.accentGreen,
    lineHeight: 18,
  },
  stockBadgeLabel: {
    fontSize: 8,
    fontWeight: font.weight.semibold,
    color: colors.textTertiary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  contactStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#222222',
  },
  contactStripText: {
    fontSize: 10,
    fontWeight: font.weight.medium,
    color: colors.textTertiary,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  statusOkText: {
    fontSize: 12,
    fontWeight: font.weight.semibold,
    color: colors.accentGreen,
  },
  statusPendingText: {
    fontSize: 12,
    fontWeight: font.weight.semibold,
    color: colors.accentOrange,
  },
  revertButton: {
    marginTop: 4,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: '#2A1414',
    borderWidth: 1,
    borderColor: '#4A1F1F',
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
    backgroundColor: colors.accentOrangeBg,
    borderWidth: 1,
    borderColor: colors.accentOrange,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  confirmLabel: {
    fontSize: 12,
    fontWeight: font.weight.bold,
    color: colors.textPrimary,
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
