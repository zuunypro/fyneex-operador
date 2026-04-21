import { useNavigationStore, type TabId } from '../stores/navigationStore'

const tabs: { id: TabId; icon: string; label: string }[] = [
  { id: 'dashboard', icon: 'grid_view', label: 'Início' },
  { id: 'checkin', icon: 'how_to_reg', label: 'Check-in' },
  { id: 'stock', icon: 'inventory_2', label: 'Estoque' },
  { id: 'profile', icon: 'person', label: 'Perfil' },
]

export function BottomNav() {
  const activeTab = useNavigationStore((s) => s.activeTab)
  const setActiveTab = useNavigationStore((s) => s.setActiveTab)

  return (
    <nav
      aria-label="Navegação principal"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: '#1A1A1A',
        borderTop: '1px solid #333333',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: '6px 8px',
          maxWidth: 430,
          margin: '0 auto',
        }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '6px 8px',
                minWidth: 56,
                minHeight: 48,
                flex: 1,
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              {active && (
                <div
                  style={{
                    position: 'absolute',
                    top: -6,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 20,
                    height: 3,
                    borderRadius: 2,
                    background: '#3FB950',
                  }}
                />
              )}
              <span
                className={`material-symbols-outlined ${active ? 'icon-filled' : ''}`}
                style={{ fontSize: 22, color: active ? '#3FB950' : '#555555' }}
              >
                {tab.icon}
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: active ? '#3FB950' : '#555555',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
