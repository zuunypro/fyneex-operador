/**
 * Mobile API Client (native)
 *
 * Em web tudo era same-origin (/api/...) com proxy/rewrite. Em RN não existe
 * origem same-site, então apontamos direto pro backend. O CORS do servidor
 * precisa aceitar requests sem Origin (o padrão em fetch nativo do RN) ou
 * liberar o scheme do app. Se precisar alternar (ex: staging) basta trocar
 * BASE_URL ou expor via EXPO_PUBLIC_API_URL.
 */

import Constants from 'expo-constants'
import { getAccessHashSync } from '@/stores/userStore'

const FALLBACK_URL = 'https://fyneexsports.com'
const BASE_URL = (
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  process.env.EXPO_PUBLIC_API_URL ||
  FALLBACK_URL
).replace(/\/$/, '')

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

function getAuthHeaders(): Record<string, string> {
  const hash = getAccessHashSync()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
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

export function getApiBaseUrl(): string {
  return BASE_URL
}
