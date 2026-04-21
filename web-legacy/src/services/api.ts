/**
 * Mobile API Client
 *
 * Centralized fetch wrapper for all calls to the Fyneex backend.
 * Reads auth token from localStorage and attaches as Bearer header.
 */

// Always use same-origin fetches. In dev the Vite proxy forwards /api → localhost:3000;
// in prod the Vercel rewrite forwards /api → fyneexsports.com. Inlining an absolute
// URL here would turn every call into a cross-origin request, and the backend only
// authorises CORS for https://app.fyneex.com, so the browser would block everything
// with "NetworkError when attempting to fetch resource". Keep BASE_URL empty.
const BASE_URL = ''

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function getAccessHash(): string | null {
  try {
    const raw = localStorage.getItem('fyneex_mobile_user')
    if (!raw) return null
    const parsed = JSON.parse(raw) as { accessHash?: string }
    return parsed.accessHash || null
  } catch {
    return null
  }
}

function getAuthHeaders(): HeadersInit {
  const hash = getAccessHash()
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (hash) headers['Authorization'] = `Bearer ${hash}`
  return headers
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({})) as Record<string, unknown>

  if (!res.ok) {
    const message = (data.error as string) || `HTTP ${res.status}`
    const code = data.code as string | undefined
    throw new ApiError(message, res.status, code)
  }

  return data as T
}

async function doFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (err) {
    // Surface the real network error so we don't mislead operators into thinking
    // they're offline when it's actually a certificate / DNS / CSP issue.
    const msg = err instanceof Error ? err.message : String(err)
    throw new ApiError(`Falha de rede: ${msg}`, 0, 'NETWORK_ERROR')
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await doFetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  })
  return handleResponse<T>(res)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await doFetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  })
  return handleResponse<T>(res)
}
