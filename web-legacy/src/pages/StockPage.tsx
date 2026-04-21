import { useState, useMemo, useEffect, memo, useDeferredValue, useCallback } from 'react'
import { useNavigationStore } from '../stores/navigationStore'
import { useParticipants, type MobileParticipant } from '../hooks/useParticipants'
import { useKitWithdrawal } from '../hooks/useKitWithdrawal'
import { useRevertKit } from '../hooks/useRevertKit'
import { useDeliveredKits } from '../hooks/useDeliveredKits'
import { useInventory, type InventoryItem } from '../hooks/useInventory'
import { useToast } from '../hooks/useToast'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { ApiError } from '../services/api'
import { QRScanner, type ScannedToken } from '../components/QRScanner'
import { InstanceSelectorModal } from '../components/InstanceSelectorModal'
import { ConfirmationModal } from '../components/ConfirmationModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { groupByOrder, matchParticipant } from '../utils/participants'
import { feedbackBad, feedbackOk } from '../utils/feedback'

type FilterId = 'all' | 'pending' | 'delivered'

/* ─── Página ─── */

export function StockPage() {
  const event = useNavigationStore((s) => s.selectedEvent)!
  const setSelectedEvent = useNavigationStore((s) => s.setSelectedEvent)

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [filter, setFilter] = useState<FilterId>('all')
  const [modalParticipant, setModalParticipant] = useState<MobileParticipant | null>(null)
  const [pendingScanGroup, setPendingScanGroup] = useState<MobileParticipant[] | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [continuousScan, setContinuousScan] = useState(false)
  const [continuousCount, setContinuousCount] = useState(0)
  const [alreadyScanned, setAlreadyScanned] = useState<MobileParticipant | null>(null)
  const [revertTarget, setRevertTarget] = useState<MobileParticipant | null>(null)
  const [showInventorySummary, setShowInventorySummary] = useState(false)

  const { toast, show: showToast } = useToast()
  const { data, isLoading, isFetching, isError, refetch } = useParticipants(event.id, { pageSize: 500 })
  const withdrawMutation = useKitWithdrawal()
  const revertMutation = useRevertKit()
  const delivered = useDeliveredKits(event.id)
  const inventory = useInventory(event.id)

  const participants = useMemo(() => {
    const all = data?.participants || []
    const allHaveFlag = all.length > 0 && all.every((p) => typeof p.hasKit === 'boolean')
    return allHaveFlag ? all.filter((p) => p.hasKit) : all
  }, [data?.participants])

  useEffect(() => {
    if (!data?.participants) return
    delivered.pruneTo(data.participants.map((p) => p.id))
  }, [data?.participants, delivered])

  const isDelivered = useCallback((p: MobileParticipant) =>
    Boolean(p.kitWithdrawnAt) || delivered.has(p.id),
  [delivered])

  const filtered = useMemo(() => {
    const s = deferredSearch.toLowerCase()
    return participants.filter((p) => {
      if (!matchParticipant(p, s)) return false
      const done = isDelivered(p)
      if (filter === 'all') return true
      if (filter === 'pending') return !done
      return done
    })
  }, [participants, deferredSearch, filter, isDelivered])

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

  const {
    containerRef: listContainerRef,
    pull: pullDistance,
    armed: pullArmed,
    refreshing: pullRefreshing,
  } = usePullToRefresh({
    onRefresh: () => Promise.all([refetch(), inventory.refetch()]),
    disabled: isLoading,
  })

  // Inventory summary — pill that lets the operator know if a size is
  // running low BEFORE they take the kit from the shelf.
  const inventorySummary = useMemo(() => {
    const items = inventory.data?.items || []
    if (items.length === 0) return null
    const low = items.filter((i) => i.status === 'low')
    const out = items.filter((i) => i.status === 'out')
    return { items, low, out }
  }, [inventory.data?.items])

  async function handleWithdraw(p: MobileParticipant) {
    if (withdrawMutation.isPending) return
    setModalParticipant(null)
    try {
      const res = await withdrawMutation.mutateAsync({
        participantId: p.participantId,
        eventId: event.id,
        instanceIndex: p.instanceIndex,
      })
      delivered.add(p.id)
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
        delivered.add(p.id)
        showToast('Kit já havia sido retirado', 'success')
      } else if (err instanceof ApiError) {
        showToast(err.message, 'error')
      } else {
        showToast('Erro ao entregar kit', 'error')
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
      delivered.remove(p.id)
      showToast('Retirada revertida', 'success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        delivered.remove(p.id)
        showToast('Nenhuma retirada para reverter', 'success')
      } else if (err instanceof ApiError) {
        showToast(err.message, 'error')
      } else {
        showToast('Erro ao reverter retirada', 'error')
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
      } else if (err instanceof ApiError) {
        showToast(err.message, 'error')
      } else {
        showToast('Erro ao entregar kit', 'error')
      }
    }
  }

  // Continuous scan: skips the delivery modal. This trades off the chance to
  // visually confirm the kit contents against the queue throughput — safest
  // when every purchase maps to an identical kit. Ambiguous multi-pending
  // still bails out to the picker so the operator can't accidentally hand
  // the wrong participant's kit.
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
        if (firstErr) {
          feedbackBad()
          showToast(`Parcial: ${firstErr.message}`, 'error')
        } else {
          showToast('Kit entregue', 'success')
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          showToast('Kit já retirado', 'success')
        } else if (err instanceof ApiError) {
          feedbackBad()
          showToast(err.message, 'error')
        } else {
          feedbackBad()
          showToast('Erro ao entregar kit', 'error')
        }
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
      delivered.add(target.id)
      setContinuousCount((n) => n + 1)
      const firstErr = res?.kit?.errors?.[0]
      if (firstErr) {
        feedbackBad()
        showToast(`Parcial: ${firstErr.message}`, 'error')
      } else {
        showToast(`${target.name} ✓`, 'success')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        delivered.add(target.id)
        showToast(`${target.name} já retirou`, 'success')
      } else if (err instanceof ApiError) {
        feedbackBad()
        showToast(err.message, 'error')
      } else {
        feedbackBad()
        showToast('Erro ao entregar kit', 'error')
      }
    }
  }, [participants, withdrawMutation, event.id, isDelivered, delivered, showToast])

  const filters: { id: FilterId; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'pending', label: 'Pendentes' },
    { id: 'delivered', label: 'Entregues' },
  ]

  return (
    <div className="checkin-frame">
      {/* ── Toast ── */}
      {toast && (
        <div
          role="status"
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          style={{
            position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
            zIndex: 200, padding: '10px 18px', borderRadius: 10,
            background: toast.type === 'success' ? '#0D2818' : '#2A0A0A',
            border: `1px solid ${toast.type === 'success' ? '#238636' : '#4A1A1A'}`,
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            animation: 'slideDown 0.2s ease',
            maxWidth: '90vw',
          }}>
          <span className="material-symbols-outlined icon-filled" style={{
            fontSize: 16,
            color: toast.type === 'success' ? '#3FB950' : '#F85149',
          }}>
            {toast.type === 'success' ? 'check_circle' : 'error'}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 600, color: '#E8E8E8',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {toast.message}
          </span>
        </div>
      )}

      {/* ── Header ── */}
      <header className="enter" style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button
          onClick={() => setSelectedEvent(null)}
          className="pressable"
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: '#1A1A1A', border: '1px solid #333333',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <span className="material-symbols-outlined" style={{ color: '#8A8A8A', fontSize: 20 }}>swap_horiz</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{
            fontSize: 15, fontWeight: 800, color: '#E8E8E8',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {event.name}
          </h1>
          <p style={{ fontSize: 10, fontWeight: 600, color: '#555555' }}>Retirada de Kit</p>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 10px', borderRadius: 6,
          background: '#222222', border: '1px solid #333333',
        }}>
          <div
            className={isFetching ? 'live-dot' : ''}
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: isFetching ? '#3FB950' : '#555555',
              transition: 'background 0.3s',
            }}
          />
          <span style={{ fontSize: 10, fontWeight: 700, color: isFetching ? '#3FB950' : '#E8E8E8', textTransform: 'uppercase', transition: 'color 0.3s' }}>
            Ao Vivo
          </span>
        </div>
      </header>

      {/* ── Estatísticas ── */}
      <div className="enter" style={{ padding: '8px 20px 0', flexShrink: 0 }}>
        {isLoading ? (
          <div className="skeleton" style={{ height: 60, borderRadius: 12, background: '#1A1A1A' }} />
        ) : (
          <div className="card-inset" style={{ display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, textAlign: 'center', padding: '8px 8px' }}>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#E8E8E8', marginBottom: 2 }}>{counts.delivered}</p>
              <p style={{ fontSize: 9, fontWeight: 600, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Entregues</p>
            </div>
            <div style={{ width: 1, background: '#2A2A2A', margin: '10px 0' }} />
            <div style={{ flex: 1, textAlign: 'center', padding: '8px 8px' }}>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#D29922', marginBottom: 2 }}>{counts.pending}</p>
              <p style={{ fontSize: 9, fontWeight: 600, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pendentes</p>
            </div>
            <div style={{ width: 1, background: '#2A2A2A', margin: '10px 0' }} />
            <div style={{ flex: 1, textAlign: 'center', padding: '8px 8px' }}>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#E8E8E8', marginBottom: 2 }}>
                {counts.all > 0 ? Math.round((counts.delivered / counts.all) * 100) : 0}%
              </p>
              <p style={{ fontSize: 9, fontWeight: 600, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Taxa</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Badge de estoque ── */}
      {inventorySummary && inventorySummary.items.length > 0 && (
        <div className="enter enter-d1" style={{ padding: '8px 20px 0', flexShrink: 0 }}>
          <button
            onClick={() => setShowInventorySummary((v) => !v)}
            className="pressable"
            aria-expanded={showInventorySummary}
            style={{
              width: '100%', textAlign: 'left',
              background: '#1A1A1A', border: '1px solid #333333',
              borderRadius: 12, padding: '10px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
              cursor: 'pointer',
            }}
          >
            <span
              className="material-symbols-outlined icon-filled"
              style={{
                fontSize: 18,
                color: inventorySummary.out.length > 0
                  ? '#F85149'
                  : inventorySummary.low.length > 0
                    ? '#D29922'
                    : '#3FB950',
              }}
            >
              inventory_2
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: 11, fontWeight: 700, color: '#E8E8E8',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {inventorySummary.out.length > 0
                  ? `${inventorySummary.out.length} item(s) esgotado(s)`
                  : inventorySummary.low.length > 0
                    ? `${inventorySummary.low.length} item(s) com estoque baixo`
                    : 'Estoque em dia'}
              </p>
              <p style={{ fontSize: 10, fontWeight: 500, color: '#8A8A8A' }}>
                {showInventorySummary ? 'Esconder detalhes' : 'Ver detalhes'}
              </p>
            </div>
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 14, color: '#555555',
                transition: 'transform 0.2s',
                transform: showInventorySummary ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            >
              expand_more
            </span>
          </button>
          {showInventorySummary && (
            <InventoryList items={inventorySummary.items} />
          )}
        </div>
      )}

      {/* ── Busca ── */}
      <div className="enter enter-d1" style={{ padding: '10px 20px 0', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          height: 40, borderRadius: 12,
          background: '#1A1A1A', border: '1px solid #333333',
          padding: '0 14px',
        }}>
          <span className="material-symbols-outlined" style={{ color: '#555555', fontSize: 20 }}>search</span>
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="Buscar por nome, pedido, CPF..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, height: '100%', minWidth: 0,
              background: 'transparent', border: 'none', outline: 'none',
              fontSize: 16, fontWeight: 500, color: '#E8E8E8', fontFamily: 'inherit',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Limpar busca"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              <span className="material-symbols-outlined" style={{ color: '#555555', fontSize: 18 }}>close</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="enter enter-d2 no-scrollbar" style={{ padding: '10px 20px 0', display: 'flex', gap: 8, overflowX: 'auto', flexShrink: 0 }}>
        {filters.map((f) => {
          const active = filter === f.id
          const count = counts[f.id]
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="pressable"
              aria-pressed={active}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 20,
                background: active ? '#E8E8E8' : '#1A1A1A',
                border: `1px solid ${active ? '#E8E8E8' : '#333333'}`,
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: active ? '#111111' : '#8A8A8A' }}>
                {f.label}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                background: active ? '#333333' : '#2A2A2A',
                color: active ? '#E8E8E8' : '#8A8A8A',
              }}>
                {count}
              </span>
            </button>
          )
        })}

        <button
          onClick={() => { refetch(); inventory.refetch() }}
          className="pressable"
          aria-label="Atualizar lista"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '8px 12px', borderRadius: 20, marginLeft: 'auto', flexShrink: 0,
            background: '#1A1A1A', border: '1px solid #333333', cursor: 'pointer',
          }}
        >
          <span className="material-symbols-outlined" style={{
            fontSize: 14, color: '#555555',
            animation: isFetching || pullRefreshing ? 'spin 1s linear infinite' : 'none',
          }}>refresh</span>
        </button>
      </div>

      {/* ── Lista de Participantes ── */}
      <section className="enter enter-d3" style={{ padding: '8px 20px 0', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 72 }}>
        <div
          ref={listContainerRef}
          className="list-container thin-scrollbar"
          style={{
            flex: 1, overflowY: 'auto', borderRadius: 12,
            transform: `translateY(${pullDistance}px)`,
            transition: pullDistance === 0 ? 'transform 0.2s ease' : 'none',
          }}
        >
          {pullDistance > 0 && (
            <div
              aria-hidden
              style={{
                position: 'absolute', top: -40, left: 0, right: 0,
                display: 'flex', justifyContent: 'center',
                height: 40, alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 22,
                  color: pullArmed ? '#3FB950' : '#555555',
                  transform: pullRefreshing
                    ? 'none'
                    : `rotate(${Math.min(pullDistance * 4, 180)}deg)`,
                  animation: pullRefreshing ? 'spin 1s linear infinite' : 'none',
                  transition: 'color 0.2s',
                }}
              >
                {pullRefreshing ? 'progress_activity' : 'arrow_downward'}
              </span>
            </div>
          )}

          {isLoading && (
            <div role="status" aria-busy="true" aria-label="Carregando participantes">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="list-row skeleton" style={{ padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: '#222222', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ height: 13, width: '55%', borderRadius: 4, background: '#222222' }} />
                    <div style={{ height: 11, width: '35%', borderRadius: 4, background: '#1E1E1E' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {isError && !isLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <span className="material-symbols-outlined" style={{ color: '#F85149', fontSize: 36, marginBottom: 8, display: 'block' }}>wifi_off</span>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#E8E8E8', marginBottom: 4 }}>Erro ao carregar participantes</p>
              <button onClick={() => refetch()} className="pressable" style={{
                marginTop: 12, padding: '8px 20px', borderRadius: 10,
                background: '#238636', border: '1px solid #3FB950',
                fontSize: 12, fontWeight: 700, color: '#E8E8E8', cursor: 'pointer',
              }}>
                Tentar novamente
              </button>
            </div>
          )}

          {!isLoading && !isError && grouped.items.length === 0 && (() => {
            const noKitConfigured = (data?.participants?.length ?? 0) > 0 && participants.length === 0
            const icon = noKitConfigured ? 'inventory_2' : 'person_search'
            const headline = noKitConfigured
              ? 'Nenhum kit configurado'
              : (search || filter !== 'all' ? 'Nenhum resultado para os filtros' : 'Nenhum participante encontrado')
            const sub = noKitConfigured
              ? 'Cadastre itens em /organizador/estoque para que apareçam aqui.'
              : null
            return (
              <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: '#333333', fontSize: 36, marginBottom: 8, display: 'block' }}>{icon}</span>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#8A8A8A' }}>{headline}</p>
                {sub && <p style={{ fontSize: 11, fontWeight: 500, color: '#555555', marginTop: 6, padding: '0 12px' }}>{sub}</p>}
              </div>
            )
          })()}

          {!isLoading && !isError && grouped.items.map((p) => (
            <ParticipantRow
              key={p.id}
              participant={p}
              delivered={isDelivered(p)}
              group={grouped.groupOf.get(p.id)}
              isPending={
                withdrawMutation.isPending &&
                withdrawMutation.variables?.participantId === p.participantId &&
                withdrawMutation.variables?.instanceIndex === p.instanceIndex
              }
              isReverting={
                revertMutation.isPending &&
                revertMutation.variables?.participantId === p.participantId
              }
              onClick={() => setModalParticipant(p)}
              onRevert={() => setRevertTarget(p)}
            />
          ))}
        </div>
      </section>

      {/* ── FAB: Scanner ── */}
      <div style={{
        position: 'fixed',
        bottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
        left: '50%',
        transform: 'translateX(-50%)', zIndex: 60,
      }}>
        <button
          onClick={() => {
            feedbackOk()
            setContinuousCount(0)
            setScannerOpen(true)
          }}
          className="pressable"
          aria-label="Escanear QR Code"
          style={{
            width: 56, height: 56, borderRadius: 16,
            background: '#E8E8E8', border: '2px solid #FFFFFF',
            boxShadow: '0 4px 20px #00000060, 0 0 0 4px #11111180',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <span className="material-symbols-outlined icon-filled" style={{ color: '#111111', fontSize: 28 }}>barcode_scanner</span>
        </button>
      </div>

      {/* ── Scanner QR ── */}
      {scannerOpen && (
        <QRScanner
          expectedEventId={event.id}
          title={event.name}
          subtitle={continuousScan
            ? 'Modo contínuo · kit entregue automaticamente'
            : 'Retirada de kit · aponte para o QR'}
          onClose={() => setScannerOpen(false)}
          onScan={continuousScan ? handleContinuousScan : handleScan}
          continuous={continuousScan}
          onContinuousChange={(next) => {
            setContinuousScan(next)
            if (!next) setContinuousCount(0)
          }}
          statusHint={continuousCount > 0 ? `${continuousCount} kits` : 'Contínuo'}
        />
      )}

      {/* ── Selecionar instância (QR ambíguo) ── */}
      {pendingScanGroup && (
        <InstanceSelectorModal
          candidates={pendingScanGroup}
          subtitle={`Pedido ${pendingScanGroup[0]?.orderNumber || ''} · selecione qual kit entregar`}
          onPick={(p) => { setPendingScanGroup(null); setModalParticipant(p) }}
          onClose={() => setPendingScanGroup(null)}
        />
      )}

      {/* ── Modal de Entrega ── */}
      {modalParticipant && (
        <ConfirmationModal
          participant={modalParticipant}
          fieldsTitle="Kit"
          fieldsLayout="rows"
          fieldsLimit={8}
          fieldsExcludeLabelRegex={/^nome( completo)?$/i}
          confirmLabel={withdrawMutation.isPending ? 'Entregando...' : 'Confirmar Entrega do Kit'}
          confirmIcon={<span className="material-symbols-outlined icon-filled" style={{ fontSize: 18, color: '#E8E8E8' }}>inventory_2</span>}
          submitting={withdrawMutation.isPending}
          onConfirm={() => handleWithdraw(modalParticipant)}
          onClose={() => setModalParticipant(null)}
        />
      )}

      {/* ── Modal: QR já escaneado ── */}
      {alreadyScanned && (
        <ConfirmationModal
          participant={alreadyScanned}
          fieldsTitle="Kit"
          fieldsLayout="rows"
          fieldsLimit={8}
          fieldsExcludeLabelRegex={/^nome( completo)?$/i}
          confirmLabel=""
          alreadyScanned
          alreadyScannedMessage="Este QR já foi escaneado"
          alreadyScannedDetail={formatKitWithdrawnAt(alreadyScanned.kitWithdrawnAt)}
          onClose={() => setAlreadyScanned(null)}
          onConfirm={() => setAlreadyScanned(null)}
        />
      )}

      {/* ── Confirmação de reversão ── */}
      <ConfirmDialog
        open={!!revertTarget}
        title="Reverter retirada de kit?"
        description={revertTarget
          ? `${revertTarget.instanceIndex !== undefined && revertTarget.instanceTotal !== undefined && revertTarget.instanceTotal > 1
              ? `${revertTarget.name} (ingresso #${revertTarget.instanceIndex})`
              : revertTarget.name}\nO kit voltará para o estoque.`
          : ''}
        confirmLabel="Reverter"
        tone="danger"
        onConfirm={() => revertTarget && executeRevertKit(revertTarget)}
        onCancel={() => setRevertTarget(null)}
      />

      <style>{`
        @keyframes slideDown { from { transform: translateX(-50%) translateY(-10px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

function formatKitWithdrawnAt(iso: string | null | undefined): string | undefined {
  if (!iso) return 'Kit já foi retirado para este ingresso.'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Kit já foi retirado para este ingresso.'
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `Kit entregue em ${date} às ${time}`
}

/* ─── Lista de estoque ─── */

function InventoryList({ items }: { items: InventoryItem[] }) {
  if (items.length === 0) return null
  return (
    <div
      className="thin-scrollbar"
      style={{
        marginTop: 6, maxHeight: 180, overflowY: 'auto',
        background: '#111111', border: '1px solid #2A2A2A',
        borderRadius: 10, padding: '6px 2px',
      }}
    >
      {items.map((item) => {
        const color = item.status === 'out'
          ? '#F85149'
          : item.status === 'low'
            ? '#D29922'
            : '#3FB950'
        const label = [item.name, item.variant].filter(Boolean).join(' · ')
        return (
          <div
            key={item.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 10px',
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0,
            }} />
            <p style={{
              flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, color: '#E8E8E8',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {label}
            </p>
            <span style={{
              fontSize: 11, fontWeight: 800, color, whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {item.currentStock}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ─── Linha do Participante ─── */

const ParticipantRow = memo(function ParticipantRow({
  participant: p, delivered, isPending, isReverting, onClick, onRevert, group,
}: {
  participant: MobileParticipant
  delivered: boolean
  isPending?: boolean
  isReverting?: boolean
  onClick: () => void
  onRevert: () => void
  group?: { pos: number; total: number; color: string; first: boolean; last: boolean }
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="list-row"
      style={{
        padding: '10px 14px',
        opacity: isPending ? 0.7 : 1,
        transition: 'opacity 0.2s',
        position: 'relative',
        contentVisibility: 'auto',
        containIntrinsicSize: '64px',
      }}
    >
      {group && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: group.first ? 6 : 0,
            bottom: group.last ? 6 : 0,
            width: 3,
            background: group.color,
            borderRadius: group.first && group.last
              ? '2px'
              : group.first
                ? '0 0 2px 2px'
                : group.last
                  ? '2px 2px 0 0'
                  : '0',
          }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: '#222222', border: '1px solid #333333',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 800, color: '#E8E8E8',
          }}>
            {p.initials}
          </div>
          {delivered && (
            <div style={{
              position: 'absolute', bottom: -3, right: -3,
              width: 18, height: 18, borderRadius: '50%',
              background: '#238636', border: '2px solid #111111',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="material-symbols-outlined icon-filled" style={{ color: '#E8E8E8', fontSize: 11 }}>check</span>
            </div>
          )}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="pressable"
          style={{
            flex: 1, minWidth: 0,
            background: 'none', border: 'none', padding: 0,
            textAlign: 'left', cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
            <p style={{
              fontSize: 13, fontWeight: 700, color: '#E8E8E8',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              flex: 1, minWidth: 0,
            }}>{p.name}</p>
            {p.instanceIndex !== undefined && p.instanceTotal !== undefined && (
              <span style={{
                fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6,
                background: '#1E2A3E', border: '1px solid #2A3E5A', color: '#79B8FF',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                #{p.instanceIndex}/{p.instanceTotal}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <p style={{
              fontSize: 11, fontWeight: 500, color: '#555555',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0,
            }}>
              {group ? `${group.pos}/${group.total} · ` : ''}{p.orderNumber} · {p.category}
            </p>
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 13, color: '#555555', flexShrink: 0,
                transition: 'transform 0.2s',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            >
              expand_more
            </span>
          </div>
        </button>

        {delivered ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
            padding: '0 4px',
          }}>
            <span className="material-symbols-outlined icon-filled" style={{ color: '#3FB950', fontSize: 16 }}>check_circle</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#3FB950' }}>Entregue</span>
          </div>
        ) : isPending ? (
          <div style={{
            height: 30, padding: '0 14px', borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#1A2E1A', border: '1px solid #2A4A2A',
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              border: '2px solid #2A4A2A', borderTopColor: '#3FB950',
              animation: 'spin 0.7s linear infinite',
            }} />
          </div>
        ) : (
          <button onClick={onClick} className="pressable" style={{
            height: 30, padding: '0 12px', borderRadius: 8,
            background: '#238636', border: '1px solid #3FB950',
            cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#E8E8E8',
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
          }}>
            <span className="material-symbols-outlined icon-filled" style={{ fontSize: 14, color: '#E8E8E8' }}>inventory_2</span>
            Entregar
          </button>
        )}
      </div>

      {expanded && (
        <div style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 10,
          background: '#111111', border: '1px solid #2A2A2A',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Comprador
            </p>
            <p style={{
              fontSize: 12, fontWeight: 700, color: '#E8E8E8', marginBottom: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {p.buyerName || p.name}
            </p>
            {(p.buyerEmail || p.email) && (
              <p style={{
                fontSize: 11, fontWeight: 500, color: '#8A8A8A',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {p.buyerEmail || p.email}
              </p>
            )}
          </div>

          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Compra
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 10px' }}>
              <DetailField label="Pedido" value={p.orderNumber || '—'} />
              <DetailField label="Ingresso" value={p.ticketName || '—'} />
              {p.batch && <DetailField label="Lote" value={p.batch} />}
              <DetailField label="Categoria" value={p.category || '—'} />
            </div>
          </div>

          {(() => {
            const extraFields = (p.instanceFields || []).filter(
              (f) => !/^nome( completo)?$/i.test(f.label),
            )
            if (extraFields.length === 0) return null
            return (
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Kit · Dados do participante
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 10px' }}>
                  {extraFields.map((f) => (
                    <DetailField key={f.label} label={f.label} value={f.value} />
                  ))}
                </div>
              </div>
            )
          })()}

          {delivered && (
            <div style={{ paddingTop: 8, borderTop: '1px solid #222222' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Status
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="material-symbols-outlined icon-filled" style={{ color: '#3FB950', fontSize: 14 }}>check_circle</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#3FB950' }}>Kit entregue nesta sessão</span>
              </div>
            </div>
          )}

          {delivered && (
            <button
              onClick={onRevert}
              disabled={isReverting}
              className="pressable"
              style={{
                marginTop: 4, height: 36, borderRadius: 8,
                background: '#2A1414', border: '1px solid #4A1A1A',
                cursor: isReverting ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: 700, color: '#F85149',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: isReverting ? 0.7 : 1,
              }}
            >
              {isReverting ? (
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  border: '2px solid #4A1A1A', borderTopColor: '#F85149',
                  animation: 'spin 0.7s linear infinite',
                }} />
              ) : (
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#F85149' }}>undo</span>
              )}
              {isReverting ? 'Revertendo...' : 'Reverter retirada'}
            </button>
          )}
        </div>
      )}
    </div>
  )
})

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span style={{
        display: 'block', fontSize: 9, fontWeight: 700, color: '#555555',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        {label}
      </span>
      <span style={{
        display: 'block', fontSize: 11, fontWeight: 600, color: '#B0B0B0',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  )
}
