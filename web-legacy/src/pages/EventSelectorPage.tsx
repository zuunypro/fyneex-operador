import { useEffect } from 'react'
import { useNavigationStore, type EventInfo } from '../stores/navigationStore'
import { useEvents, type MobileEvent } from '../hooks/useEvents'
import { ApiError } from '../services/api'
import { formatEventDateTime } from '../services/formatters'

function toEventInfo(ev: MobileEvent): EventInfo {
  return {
    id: ev.id,
    name: ev.name,
    date: ev.date,
    time: ev.time,
    location: ev.location,
    image: ev.image,
    participants: ev.participantsCount,
  }
}

// Defense-in-depth: ignore server values that aren't absolute — a bare "/images/x.webp"
// would resolve against the mobile's own origin (no such asset) and render broken.
function isLoadableImage(src: string | null | undefined): src is string {
  return !!src && /^(https?:\/\/|data:)/i.test(src)
}

export function EventSelectorPage() {
  const setSelectedEvent = useNavigationStore((s) => s.setSelectedEvent)
  const logout = useNavigationStore((s) => s.logout)
  const { data, isLoading, isError, error, refetch } = useEvents()

  // Auto-logout on 401 — stale token, send user back to login
  useEffect(() => {
    if (isError && error instanceof ApiError && error.status === 401) {
      logout()
    }
  }, [isError, error, logout])

  const events = data?.events || []

  return (
    <div style={{ minHeight: '100dvh', background: '#111111' }}>
      {/* Cabeçalho */}
      <header className="enter" style={{ padding: '20px 24px 8px', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
          <span className="material-symbols-outlined icon-filled" style={{ color: '#3FB950', fontSize: 24 }}>bolt</span>
          <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.04em', fontStyle: 'italic', color: '#E8E8E8' }}>FYNEEX</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#E8E8E8', marginBottom: 4 }}>Escolha o Evento</h1>
        <p style={{ fontSize: 12, fontWeight: 500, color: '#8A8A8A' }}>Selecione um evento para continuar</p>
      </header>

      {/* Cards de Evento */}
      <section style={{ padding: '20px 20px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {isLoading && (
          <>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{
                width: '100%', borderRadius: 14, overflow: 'hidden',
                background: '#1A1A1A', border: '1px solid #2A2A2A',
              }}>
                <div style={{ width: '100%', aspectRatio: '16/9', background: '#222222' }} />
                <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ height: 16, width: '60%', borderRadius: 6, background: '#252525' }} />
                  <div style={{ height: 12, width: '40%', borderRadius: 6, background: '#202020' }} />
                </div>
              </div>
            ))}
          </>
        )}

        {isError && (error as any)?.status !== 401 && (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            background: '#1A1A1A', borderRadius: 14, border: '1px solid #2A2A2A',
          }}>
            <span className="material-symbols-outlined" style={{ color: '#F85149', fontSize: 36, display: 'block', marginBottom: 8 }}>wifi_off</span>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#E8E8E8', marginBottom: 4 }}>Erro ao carregar eventos</p>
            <p style={{ fontSize: 12, fontWeight: 500, color: '#F85149', marginBottom: 4, fontFamily: 'monospace' }}>
              {(error as any)?.message || String(error)}
            </p>
            <p style={{ fontSize: 11, fontWeight: 500, color: '#8A8A8A', marginBottom: 16 }}>
              Status: {(error as any)?.status ?? 'sem resposta'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => refetch()}
                className="pressable"
                style={{
                  padding: '8px 20px', borderRadius: 10,
                  background: '#238636', border: '1px solid #3FB950',
                  fontSize: 12, fontWeight: 700, color: '#E8E8E8', cursor: 'pointer',
                }}
              >
                Tentar novamente
              </button>
              <button
                onClick={() => logout()}
                className="pressable"
                style={{
                  padding: '8px 20px', borderRadius: 10,
                  background: '#1A1A1A', border: '1px solid #555555',
                  fontSize: 12, fontWeight: 700, color: '#8A8A8A', cursor: 'pointer',
                }}
              >
                Sair
              </button>
            </div>
          </div>
        )}

        {!isLoading && !isError && events.length === 0 && (
          <div style={{
            padding: '60px 20px', textAlign: 'center',
            background: '#1A1A1A', borderRadius: 14, border: '1px solid #2A2A2A',
          }}>
            <span className="material-symbols-outlined" style={{ color: '#333333', fontSize: 48, display: 'block', marginBottom: 12 }}>event_busy</span>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#555555' }}>Nenhum evento encontrado</p>
          </div>
        )}

        {!isLoading && events.map((ev, i) => {
          const { date: fDate, time: fTime } = formatEventDateTime(ev.date, ev.time)
          return (
          <button
            key={ev.id}
            onClick={() => setSelectedEvent(toEventInfo(ev))}
            className={`pressable enter enter-d${Math.min(i + 1, 5)}`}
            style={{
              width: '100%',
              borderRadius: 14,
              overflow: 'hidden',
              background: '#1A1A1A',
              border: '1px solid #333333',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {/* Imagem 16:9 */}
            <div style={{ width: '100%', aspectRatio: '16/9', overflow: 'hidden', position: 'relative' }}>
              {isLoadableImage(ev.image) ? (
                <img
                  src={ev.image}
                  alt={ev.name}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  background: '#222222',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span className="material-symbols-outlined" style={{ color: '#333333', fontSize: 48 }}>image</span>
                </div>
              )}
              {/* Badge de participantes */}
              <div style={{
                position: 'absolute', top: 10, right: 10,
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8,
                background: 'rgba(13,17,23,0.85)', border: '1px solid #238636',
                backdropFilter: 'blur(6px)',
              }}>
                <span className="material-symbols-outlined" style={{ color: '#3FB950', fontSize: 14 }}>group</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#3FB950' }}>{ev.participantsCount}</span>
              </div>
              {/* Status badge */}
              {ev.status && ev.status !== 'published' && (
                <div style={{
                  position: 'absolute', top: 10, left: 10,
                  padding: '3px 8px', borderRadius: 6,
                  background: 'rgba(13,17,23,0.85)',
                  fontSize: 10, fontWeight: 700,
                  color: ev.status === 'draft' ? '#D29922' : '#8A8A8A',
                  textTransform: 'uppercase',
                  backdropFilter: 'blur(6px)',
                }}>
                  {ev.status === 'draft' ? 'Rascunho' : ev.status}
                </div>
              )}
            </div>

            {/* Detalhes */}
            <div style={{
              padding: '14px 16px 16px',
              borderTop: '1px solid #333333',
              minWidth: 0,
            }}>
              <h3 style={{
                fontSize: 15, fontWeight: 800, color: '#E8E8E8', marginBottom: 8,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{ev.name}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                  <span className="material-symbols-outlined" style={{ color: '#3FB950', fontSize: 15 }}>calendar_today</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#8A8A8A', whiteSpace: 'nowrap' }}>{fDate}</span>
                </div>
                {fTime && (
                  <>
                    <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#333333', flexShrink: 0 }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <span className="material-symbols-outlined" style={{ color: '#D29922', fontSize: 15 }}>schedule</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#8A8A8A', whiteSpace: 'nowrap' }}>{fTime}</span>
                    </div>
                  </>
                )}
                <div style={{ width: 3, height: 3, borderRadius: '50%', background: '#333333', flexShrink: 0 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
                  <span className="material-symbols-outlined" style={{ color: '#8B949E', fontSize: 15, flexShrink: 0 }}>location_on</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: '#8A8A8A',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}>{ev.location}</span>
                </div>
              </div>
            </div>
          </button>
          )
        })}
      </section>
    </div>
  )
}
