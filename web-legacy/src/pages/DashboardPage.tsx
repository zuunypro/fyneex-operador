import { useNavigationStore } from '../stores/navigationStore'
import { useUserStore } from '../stores/userStore'
import { useEventStats } from '../hooks/useEventStats'
import { formatEventDateTime } from '../services/formatters'

export function DashboardPage() {
  const event = useNavigationStore((s) => s.selectedEvent)
  const user = useUserStore((s) => s.user)
  const { data: statsData, isLoading: statsLoading } = useEventStats(event?.id || '')

  const stats = statsData?.stats
  const checkinRate = stats?.checkinRate ?? 0
  const stockRate = stats?.stock?.rate ?? 0
  const stockReserved = stats?.stock?.totalReserved ?? 0
  const stockWithdrawn = stats?.stock?.totalWithdrawn ?? 0
  const stockPending = stats?.stock?.pendingWithdrawals ?? 0
  const stockTotalItems = stats?.stock?.totalItems ?? 0
  // "Tem estoque" = item cadastrado E com unidades reservadas a entregar.
  // Sem reservas, a % seria sempre 0% e confunde — mostra "sem itens" no lugar.
  const hasStock = stockTotalItems > 0 && stockReserved > 0

  const initials = user?.name
    ? user.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')
    : '?'

  return (
    <div className="dashboard-frame">
      {/* ── Funcionário ── */}
      <header style={{ padding: '16px 20px 20px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: '#238636', border: '2px solid #3FB950',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 800, color: '#E8E8E8',
          flexShrink: 0,
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#E8E8E8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.name || 'Usuário'}
          </p>
        </div>
        <div style={{
          padding: '4px 10px', borderRadius: 6, flexShrink: 0,
          background: '#222222', border: '1px solid #333333',
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#8A8A8A', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Staff
          </span>
        </div>
      </header>

      {/* ── Evento Ativo ── */}
      <div style={{ flexShrink: 0 }}>
        <EventBanner />
      </div>

      {/* ── Progresso ── */}
      <section style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        {statsLoading ? (
          <>
            <div className="skeleton" style={{ height: 64, borderRadius: 12, background: '#1A1A1A' }} />
            <div className="skeleton" style={{ height: 64, borderRadius: 12, background: '#1A1A1A' }} />
          </>
        ) : (
          <>
            <ProgressBar
              label="Check-in"
              value={checkinRate}
              icon="how_to_reg"
              detail={stats ? `${stats.validated} / ${stats.total}` : undefined}
              color="#3FB950"
            />
            <ProgressBar
              label="Estoque entregue"
              value={stockRate}
              icon="inventory_2"
              detail={hasStock
                ? `${stockWithdrawn} / ${stockReserved}${stockPending > 0 ? ` · ${stockPending} a entregar` : ''}`
                : 'sem itens'}
              color="#D29922"
              muted={!hasStock}
            />
          </>
        )}
      </section>

      {/* ── Gráfico ── */}
      <section style={{ padding: '0 20px 20px', flexShrink: 0, height: 220 }}>
        {statsLoading ? (
          <div className="skeleton" style={{ height: '100%', borderRadius: 12, background: '#1A1A1A' }} />
        ) : (
          <BarChart checkin={checkinRate} stock={stockRate} hasStock={hasStock} />
        )}
      </section>
    </div>
  )
}

/* ─── Sub-componentes ─── */

function ProgressBar({
  label, value, icon, detail, color, muted,
}: {
  label: string; value: number; icon: string; detail?: string; color: string; muted?: boolean
}) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12,
      background: '#1A1A1A', border: '1px solid #333333',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: muted ? '#555555' : '#8A8A8A', flexShrink: 0 }}>{icon}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#E8E8E8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {detail && <span style={{ fontSize: 11, fontWeight: 500, color: '#555555' }}>{detail}</span>}
          <span style={{ fontSize: 12, fontWeight: 700, color: muted ? '#555555' : '#E8E8E8' }}>{value}%</span>
        </div>
      </div>
      <div style={{ width: '100%', height: 6, borderRadius: 3, background: '#2A2A2A', overflow: 'hidden' }}>
        <div style={{
          width: `${value}%`, height: '100%', borderRadius: 3,
          background: muted ? '#3A3A3A' : color,
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  )
}

const gridLines = [0, 25, 50, 75, 100]

function BarChart({ checkin, stock, hasStock }: { checkin: number; stock: number; hasStock: boolean }) {
  const bars = [
    { label: 'Check-in', value: checkin, icon: 'how_to_reg', color: '#3FB950', muted: false },
    { label: 'Estoque', value: stock, icon: 'inventory_2', color: '#D29922', muted: !hasStock },
  ]

  return (
    <div style={{
      padding: 16, borderRadius: 12,
      background: '#1A1A1A', border: '1px solid #333333',
      height: '100%', minHeight: 140, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#8A8A8A', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16 }}>
        Visão geral
      </p>

      <div style={{ flex: 1, display: 'flex', gap: 8, minHeight: 0 }}>
        {/* eixo Y */}
        <div style={{ display: 'flex', flexDirection: 'column-reverse', justifyContent: 'space-between', paddingBottom: 28 }}>
          {gridLines.map(v => (
            <span key={v} style={{ fontSize: 9, fontWeight: 600, color: '#555555', lineHeight: 1, width: 22, textAlign: 'right' }}>{v}</span>
          ))}
        </div>

        {/* barras + linhas de grade */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {/* linhas horizontais */}
          <div style={{ position: 'absolute', inset: '0 0 28px 0' }}>
            {gridLines.map((v, i) => (
              <div key={v} style={{
                position: 'absolute',
                bottom: `${v}%`, left: 0, right: 0,
                height: 1,
                background: i === 0 ? '#444444' : '#2A2A2A',
              }} />
            ))}
          </div>

          {/* barras */}
          <div style={{ position: 'absolute', inset: '0 0 28px 0', display: 'flex', alignItems: 'flex-end', gap: 12, padding: '0 12px' }}>
            {bars.map(bar => (
              <div key={bar.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: bar.muted ? '#555555' : '#E8E8E8', marginBottom: 4 }}>{bar.value}%</span>
                <div style={{
                  width: '70%', maxWidth: 80,
                  height: `${bar.value}%`,
                  borderRadius: '6px 6px 2px 2px',
                  background: bar.muted ? '#3A3A3A' : bar.color,
                  minHeight: 3,
                  transition: 'height 0.6s ease',
                }} />
              </div>
            ))}
          </div>

          {/* rótulos */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 28, display: 'flex', gap: 12, padding: '0 12px' }}>
            {bars.map(bar => (
              <div key={bar.label} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 6, minWidth: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 12, color: bar.muted ? '#555555' : '#8A8A8A', flexShrink: 0 }}>{bar.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: bar.muted ? '#555555' : '#8A8A8A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bar.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function EventBanner() {
  const event = useNavigationStore((s) => s.selectedEvent)
  const setSelectedEvent = useNavigationStore((s) => s.setSelectedEvent)
  if (!event) return null

  const isImageLoadable = !!event.image && /^(https?:\/\/|data:)/i.test(event.image)
  const { date, time } = formatEventDateTime(event.date, event.time)

  return (
    <section style={{ padding: '0 20px 16px' }}>
      <div style={{
        borderRadius: 12, overflow: 'hidden',
        background: '#1A1A1A', border: '1px solid #333333',
        position: 'relative',
      }}>
        {/* Foto 16:9 */}
        <div style={{ width: '100%', aspectRatio: '16/9', overflow: 'hidden', position: 'relative', background: '#222222' }}>
          {isImageLoadable ? (
            <img
              src={event.image}
              alt={event.name}
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="material-symbols-outlined" style={{ color: '#333333', fontSize: 48 }}>event</span>
            </div>
          )}
          {/* Botão trocar evento */}
          <button
            onClick={() => setSelectedEvent(null)}
            aria-label="Trocar evento"
            className="pressable"
            style={{
              position: 'absolute', top: 10, right: 10,
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(13,17,23,0.85)', border: '1px solid #333333',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', backdropFilter: 'blur(6px)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#E8E8E8' }}>swap_horiz</span>
          </button>
        </div>

        {/* Detalhes */}
        <div style={{ padding: '12px 14px 14px', borderTop: '1px solid #2A2A2A', minWidth: 0 }}>
          <p style={{
            fontSize: 14, fontWeight: 800, color: '#E8E8E8', marginBottom: 6,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {event.name}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#3FB950' }}>calendar_today</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#8A8A8A' }}>{date}</span>
            </div>
            {time && (
              <>
                <div style={{ width: 2, height: 2, borderRadius: '50%', background: '#333333', flexShrink: 0 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#D29922' }}>schedule</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#8A8A8A' }}>{time}</span>
                </div>
              </>
            )}
            <div style={{ width: 2, height: 2, borderRadius: '50%', background: '#333333', flexShrink: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#8B949E', flexShrink: 0 }}>location_on</span>
              <span style={{
                fontSize: 11, fontWeight: 600, color: '#8A8A8A',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                minWidth: 0,
              }}>{event.location}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
