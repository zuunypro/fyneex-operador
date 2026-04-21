export function StatusBar() {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 44,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        background: '#111111',
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: '#E8E8E8' }}>9:41</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#E8E8E8' }}>signal_cellular_alt</span>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#E8E8E8' }}>wifi</span>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#E8E8E8' }}>battery_full</span>
      </div>
    </div>
  )
}
