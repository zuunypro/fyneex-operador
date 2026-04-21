import { useUserStore } from '../stores/userStore'
import { useNavigationStore } from '../stores/navigationStore'

export function ProfilePage() {
  const user = useUserStore((s) => s.user)
  const logout = useNavigationStore((s) => s.logout)

  const initials = user?.name
    ? user.name.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')
    : '?'

  return (
    <div style={{ paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))' }}>
      {/* ── Avatar + Nome ── */}
      <header className="enter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 24px 16px' }}>
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <div style={{
            width: 88, height: 88, borderRadius: '50%',
            border: '2px solid #238636', padding: 3,
            background: '#1A1A1A',
          }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: '50%',
              background: '#238636',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, fontWeight: 800, color: '#E8E8E8',
            }}>
              {initials}
            </div>
          </div>
        </div>
        <h2 className="truncate" style={{ fontSize: 20, fontWeight: 800, color: '#E8E8E8', marginBottom: 4, maxWidth: '100%', textAlign: 'center', padding: '0 24px' }}>
          {user?.name || 'Usuário'}
        </h2>
        <p className="truncate" style={{ fontSize: 12, fontWeight: 500, color: '#8A8A8A', marginBottom: 8, maxWidth: '100%', textAlign: 'center', padding: '0 24px' }}>
          {user?.email || ''}
        </p>
        <div className="badge-green" style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Staff
        </div>
      </header>

      {/* ── Configurações ── */}
      <section style={{ padding: '12px 20px 0' }}>
        <h3 className="enter enter-d2" style={{ fontSize: 11, fontWeight: 700, color: '#8A8A8A', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12, marginLeft: 4 }}>
          Conta
        </h3>

        <div className="list-container" style={{ marginBottom: 16 }}>
          <SettingRow icon="manage_accounts" badge="green" label="Configurações da Conta" delay={3} />
          <SettingRow icon="notifications_active" badge="blue" label="Notificações" delay={3} />
          <SettingRow icon="shield" badge="orange" label="Privacidade e Segurança" delay={4} />
        </div>

        {/* ── Sair ── */}
        <div className="enter enter-d5">
          <button
            onClick={logout}
            className="pressable"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 16, borderRadius: 12,
              background: '#1F1111', border: '1px solid #5C1A1A',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: '#2D0F0F', border: '1px solid #5C1A1A',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-outlined" style={{ color: '#F85149', fontSize: 20 }}>logout</span>
              </div>
              <span className="truncate" style={{ fontSize: 13, fontWeight: 700, color: '#F85149' }}>Sair da Conta</span>
            </div>
            <span className="material-symbols-outlined" style={{ color: '#5C1A1A', fontSize: 16, flexShrink: 0 }}>chevron_right</span>
          </button>
        </div>

        {/* ── Rodapé ── */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <span className="material-symbols-outlined icon-filled" style={{ color: '#2A2A2A', fontSize: 18 }}>bolt</span>
            <span style={{ fontSize: 15, fontWeight: 900, letterSpacing: '-0.04em', fontStyle: 'italic', color: '#2A2A2A' }}>FYNEEX</span>
          </div>
          <p style={{ fontSize: 9, fontWeight: 500, color: '#333333' }}>v2.0.4</p>
        </div>
      </section>
    </div>
  )
}

function SettingRow({
  icon, badge, label, delay,
}: {
  icon: string; badge: 'green' | 'orange' | 'blue'; label: string; delay: number
}) {
  const colors = {
    green:  { bg: '#112211', color: '#3FB950', border: '#238636' },
    orange: { bg: '#1F1A0F', color: '#D29922', border: '#4B3012' },
    blue:   { bg: '#1A1A1A', color: '#8B949E', border: '#333333' },
  }
  const c = colors[badge]

  return (
    <div className={`list-row enter enter-d${delay}`} style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: c.bg, border: `1px solid ${c.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-outlined" style={{ color: c.color, fontSize: 20 }}>{icon}</span>
        </div>
        <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: '#E8E8E8' }}>{label}</span>
      </div>
      <span className="material-symbols-outlined" style={{ color: '#333333', fontSize: 16, flexShrink: 0 }}>chevron_right</span>
    </div>
  )
}
