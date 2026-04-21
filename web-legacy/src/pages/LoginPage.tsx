import { useState } from 'react'
import { useNavigationStore } from '../stores/navigationStore'
import { useUserStore } from '../stores/userStore'
import { apiPost, ApiError } from '../services/api'
import type { User } from '../schemas/user.schema'

interface LoginResponse {
  success: boolean
  user: {
    id: string
    name: string
    email: string
    accessHash: string
    organizerId?: string
  }
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const setIsLoggedIn = useNavigationStore((s) => s.setIsLoggedIn)
  const setUser = useUserStore((s) => s.setUser)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isLoading) return
    setErrorMessage('')
    setIsLoading(true)
    try {
      const res = await apiPost<LoginResponse>('/api/mobile/login', { email, password })
      if (res.success && res.user) {
        const user: User = {
          id: res.user.id,
          name: res.user.name,
          email: res.user.email,
          accessHash: res.user.accessHash,
          organizerId: res.user.organizerId,
        }
        setUser(user)
        setIsLoggedIn(true)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage('Erro de conexão. Verifique sua internet.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100dvh', background: '#111111',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ── Branding ── */}
      <header className="enter" style={{ padding: '60px 24px 8px', textAlign: 'center', maxWidth: 430, margin: '0 auto', width: '100%' }}>
        <img
          src="/fyneex-logo.webp"
          alt="Fyneex Sports"
          width={180}
          height={60}
          decoding="async"
          style={{ width: 180, maxWidth: '70%', height: 'auto', margin: '0 auto 8px', display: 'block' }}
        />
        <p style={{ fontSize: 11, fontWeight: 600, color: '#555555', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
          Gestão de Eventos Esportivos
        </p>
      </header>

      {/* ── Formulário ── */}
      <form onSubmit={handleSubmit} className="enter enter-d1" style={{ padding: '36px 20px 0', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 430, margin: '0 auto', width: '100%' }}>
        <InputField
          icon="mail"
          placeholder="E-mail"
          value={email}
          onChange={setEmail}
          type="email"
          disabled={isLoading}
          autoComplete="username"
          inputMode="email"
        />

        <div style={{ position: 'relative' }}>
          <InputField
            icon="lock"
            placeholder="Senha"
            value={password}
            onChange={setPassword}
            type={showPass ? 'text' : 'password'}
            disabled={isLoading}
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            style={{
              position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#555555' }}>
              {showPass ? 'visibility_off' : 'visibility'}
            </span>
          </button>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '10px 14px', borderRadius: 10,
            background: '#1A0A0A', border: '1px solid #4A1A1A',
            minWidth: 0,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#F85149', flexShrink: 0, marginTop: 1 }}>error</span>
            <span style={{
              fontSize: 12, fontWeight: 500, color: '#F85149',
              minWidth: 0, flex: 1, wordBreak: 'break-word',
            }}>{errorMessage}</span>
          </div>
        )}

        <div style={{ textAlign: 'right' }}>
          <button
            type="button"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: '#8B949E',
            }}
          >
            Esqueceu a senha?
          </button>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="pressable"
          style={{
            width: '100%', height: 48, borderRadius: 12, marginTop: 4,
            background: isLoading ? '#1A2E1A' : '#238636',
            border: `1px solid ${isLoading ? '#2A4A2A' : '#3FB950'}`,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 700,
            color: isLoading ? '#4A7A4A' : '#E8E8E8',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'background 0.2s, border-color 0.2s',
          }}
        >
          {isLoading ? (
            <>
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                border: '2px solid #4A7A4A', borderTopColor: '#3FB950',
                animation: 'spin 0.7s linear infinite',
              }} />
              Entrando...
            </>
          ) : (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>login</span>
              Entrar
            </>
          )}
        </button>
      </form>


      {/* ── Footer ── */}
      <div style={{ flex: 1 }} />
      <p className="enter enter-d4" style={{ padding: '20px', textAlign: 'center', fontSize: 10, color: '#555555', fontWeight: 500 }}>
        Ao continuar, você concorda com nossos{' '}
        <span style={{ color: '#8B949E' }}>Termos de Uso</span> e{' '}
        <span style={{ color: '#8B949E' }}>Política de Privacidade</span>
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

/* ─── Input ─── */

function InputField({
  icon, placeholder, value, onChange, type, disabled, autoComplete, inputMode,
}: {
  icon: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  type: string
  disabled?: boolean
  autoComplete?: string
  inputMode?: 'email' | 'text' | 'numeric' | 'tel' | 'url' | 'search' | 'none'
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      height: 48, borderRadius: 12,
      background: '#1A1A1A', border: '1px solid #333333',
      padding: '0 14px',
      opacity: disabled ? 0.6 : 1,
    }}>
      <span className="material-symbols-outlined" style={{ color: '#555555', fontSize: 20, flexShrink: 0 }}>{icon}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoComplete={autoComplete}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1, height: '100%', minWidth: 0,
          background: 'transparent', border: 'none', outline: 'none',
          fontSize: 16, fontWeight: 500, color: '#E8E8E8', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}
