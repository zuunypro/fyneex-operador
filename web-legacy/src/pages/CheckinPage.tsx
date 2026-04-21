import { useState, useMemo, memo, useDeferredValue, useCallback } from 'react'
import { useNavigationStore } from '../stores/navigationStore'
import { useParticipants, type MobileParticipant } from '../hooks/useParticipants'
import { useCheckin } from '../hooks/useCheckin'
import { useRevertCheckin } from '../hooks/useRevertCheckin'
import { useToast } from '../hooks/useToast'
import { useRecentObservations } from '../hooks/useRecentObservations'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { ApiError } from '../services/api'
import { QRScanner, type ScannedToken } from '../components/QRScanner'
import { InstanceSelectorModal } from '../components/InstanceSelectorModal'
import { ConfirmationModal } from '../components/ConfirmationModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { groupByOrder, matchParticipant } from '../utils/participants'
import { feedbackBad, feedbackOk } from '../utils/feedback'

type FilterId = 'all' | 'pending' | 'checked'

/* ─── Página ─── */

export function CheckinPage() {
  const event = useNavigationStore((s) => s.selectedEvent)!
  const setSelectedEvent = useNavigationStore((s) => s.setSelectedEvent)

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
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

  const filtered = useMemo(() => {
    const s = deferredSearch.toLowerCase()
    return participants.filter((p) => {
      if (!matchParticipant(p, s)) return false
      if (filter === 'all') return true
      if (filter === 'pending') return p.status === 'pending'
      return p.status === 'checked'
    })
  }, [participants, deferredSearch, filter])

  const counts = useMemo(() => ({
    all: participants.length,
    pending: participants.filter((p) => p.status === 'pending').length,
    checked: participants.filter((p) => p.status === 'checked').length,
  }), [participants])

  const grouped = useMemo(() => groupByOrder(filtered), [filtered])

  const {
    containerRef: listContainerRef,
    pull: pullDistance,
    armed: pullArmed,
    refreshing: pullRefreshing,
  } = usePullToRefresh({
    onRefresh: () => refetch(),
    disabled: isLoading,
  })

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
      } else if (err instanceof ApiError) {
        showToast(err.message, 'error')
      } else {
        showToast('Erro ao realizar check-in', 'error')
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
      } else if (err instanceof ApiError) {
        showToast(err.message, 'error')
      } else {
        showToast('Erro ao reverter check-in', 'error')
      }
    }
  }

  // Single-shot scan: opens the confirmation modal so the operator can add
  // an observation before the check-in fires.
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
    // Not in loaded list — check in directly with the raw id.
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
      } else if (err instanceof ApiError) {
        showToast(err.message, 'error')
      } else {
        showToast('Erro ao realizar check-in', 'error')
      }
    }
  }

  // Continuous scan: the scanner stays open and the handler races through
  // single-pending + already-done paths without opening the modal. Ambiguous
  // (multi-pending) scans fall back to closing the scanner + instance picker.
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
        } else if (err instanceof ApiError) {
          feedbackBad()
          showToast(err.message, 'error')
        } else {
          feedbackBad()
          showToast('Erro ao realizar check-in', 'error')
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
      // Ambiguous — bail out of continuous mode to let the operator pick.
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
      } else if (err instanceof ApiError) {
        feedbackBad()
        showToast(err.message, 'error')
      } else {
        feedbackBad()
        showToast('Erro ao realizar check-in', 'error')
      }
    }
  }, [participants, checkinMutation, event.id, showToast])

  const filters: { id: FilterId; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'pending', label: 'Pendentes' },
    { id: 'checked', label: 'Confirmados' },
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

      {/* ── Evento Ativo ── */}
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
          <p style={{ fontSize: 10, fontWeight: 600, color: '#555555' }}>Check-in Manual</p>
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
              <p style={{ fontSize: 18, fontWeight: 800, color: '#E8E8E8', marginBottom: 2 }}>{counts.checked}</p>
              <p style={{ fontSize: 9, fontWeight: 600, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Feitos</p>
            </div>
            <div style={{ width: 1, background: '#2A2A2A', margin: '10px 0' }} />
            <div style={{ flex: 1, textAlign: 'center', padding: '8px 8px' }}>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#D29922', marginBottom: 2 }}>{counts.pending}</p>
              <p style={{ fontSize: 9, fontWeight: 600, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pendentes</p>
            </div>
            <div style={{ width: 1, background: '#2A2A2A', margin: '10px 0' }} />
            <div style={{ flex: 1, textAlign: 'center', padding: '8px 8px' }}>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#E8E8E8', marginBottom: 2 }}>
                {counts.all > 0 ? Math.round((counts.checked / counts.all) * 100) : 0}%
              </p>
              <p style={{ fontSize: 9, fontWeight: 600, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Taxa</p>
            </div>
          </div>
        )}
      </div>

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
            placeholder="Buscar por nome, ID ou pedido..."
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
          onClick={() => refetch()}
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

          {!isLoading && !isError && filtered.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <span className="material-symbols-outlined" style={{ color: '#333333', fontSize: 36, marginBottom: 8, display: 'block' }}>person_search</span>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#555555' }}>Nenhum participante encontrado</p>
            </div>
          )}

          {!isLoading && !isError && grouped.items.map((p) => (
            <ParticipantRow
              key={p.id}
              participant={p}
              group={grouped.groupOf.get(p.id)}
              isPending={
                checkinMutation.isPending &&
                checkinMutation.variables?.participantId === p.participantId &&
                checkinMutation.variables?.instanceIndex === p.instanceIndex
              }
              isReverting={
                revertMutation.isPending &&
                revertMutation.variables?.participantId === p.participantId &&
                revertMutation.variables?.instanceIndex === p.instanceIndex
              }
              onCheckin={() => openCheckinModal(p)}
              onRevert={() => setRevertTarget(p)}
            />
          ))}
        </div>
      </section>

      {/* ── FAB: Scanner QR ── */}
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
          <span className="material-symbols-outlined icon-filled" style={{ color: '#111111', fontSize: 28 }}>qr_code_scanner</span>
        </button>
      </div>

      {/* ── Scanner QR ── */}
      {scannerOpen && (
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
      )}

      {/* ── Selecionar instância (QR ambíguo) ── */}
      {pendingScanGroup && (
        <InstanceSelectorModal
          candidates={pendingScanGroup}
          subtitle={`Pedido ${pendingScanGroup[0]?.orderNumber || ''} · selecione qual ingresso confirmar`}
          onPick={(p) => { setPendingScanGroup(null); openCheckinModal(p) }}
          onClose={() => setPendingScanGroup(null)}
        />
      )}

      {/* ── Modal de Confirmação ── */}
      {modalParticipant && (
        <ConfirmationModal
          participant={modalParticipant}
          obsText={obsText}
          onObsChange={setObsText}
          fieldsTitle="Identificação deste ingresso"
          fieldsLayout="grid"
          fieldsLimit={6}
          confirmLabel="Confirmar"
          confirmIcon={<span className="material-symbols-outlined" style={{ fontSize: 18, color: '#E8E8E8' }}>how_to_reg</span>}
          onClose={() => { setModalParticipant(null); setObsText('') }}
          onConfirm={() => handleCheckin(modalParticipant, obsText)}
          submitting={checkinMutation.isPending}
        />
      )}

      {/* ── Modal: QR já escaneado ── */}
      {alreadyScanned && (
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
      )}

      {/* ── Confirmação de reversão ── */}
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

      <style>{`
        @keyframes slideDown { from { transform: translateX(-50%) translateY(-10px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

/* ─── Linha do Participante ─── */

const ParticipantRow = memo(function ParticipantRow({
  participant: p, isPending, isReverting, onCheckin, onRevert, group,
}: {
  participant: MobileParticipant
  isPending?: boolean
  isReverting?: boolean
  onCheckin: () => void
  onRevert: () => void
  group?: { pos: number; total: number; color: string; first: boolean; last: boolean }
}) {
  const isChecked = p.status === 'checked'
  const [expanded, setExpanded] = useState(false)
  const observation = p.observation

  return (
    <div
      className="list-row"
      style={{
        padding: '10px 14px',
        opacity: isPending ? 0.7 : 1,
        transition: 'opacity 0.2s',
        position: 'relative',
        // Let the browser skip rendering rows that are off-screen. Massive
        // scroll perf win with 500+ participants; the contain-intrinsic-size
        // keeps the scrollbar accurate while the row is culled.
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
          {isChecked && (
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

        {isChecked ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="pressable"
            style={{
              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            <span className="material-symbols-outlined icon-filled" style={{ color: '#3FB950', fontSize: 16 }}>check_circle</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#3FB950' }}>Feito</span>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#555555', marginLeft: 2, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>expand_more</span>
          </button>
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
          <button onClick={onCheckin} className="pressable" style={{
            height: 30, padding: '0 14px', borderRadius: 8,
            background: '#238636', border: '1px solid #3FB950',
            cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#E8E8E8',
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#E8E8E8' }}>how_to_reg</span>
            Confirmar
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
              (f) => f.label.toLowerCase() !== 'nome'
            )
            if (extraFields.length === 0) return null
            return (
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  Dados do participante
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 10px' }}>
                  {extraFields.map((f) => (
                    <DetailField key={f.label} label={f.label} value={f.value} />
                  ))}
                </div>
              </div>
            )
          })()}

          {isChecked && (
            <div style={{ paddingTop: 8, borderTop: '1px solid #222222' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Observação
              </p>
              <p style={{ fontSize: 12, fontWeight: 500, color: observation ? '#B0B0B0' : '#444444' }}>
                {observation || 'Nenhuma observação registrada.'}
              </p>
            </div>
          )}

          {isChecked && (
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
              {isReverting ? 'Revertendo...' : 'Reverter check-in'}
            </button>
          )}
        </div>
      )}
    </div>
  )
})

function formatCheckedInAt(iso: string | null | undefined): string | undefined {
  if (!iso) return 'Check-in já registrado para este ingresso.'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Check-in já registrado para este ingresso.'
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `Check-in feito em ${date} às ${time}`
}

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
