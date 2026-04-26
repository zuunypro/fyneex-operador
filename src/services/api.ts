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
import { getDeviceIdHashSync } from '@/services/secureToken'

const FALLBACK_URL = 'https://fyneexsports.com'
const rawUrl = (
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  process.env.EXPO_PUBLIC_API_URL ||
  FALLBACK_URL
).replace(/\/$/, '')

// Se a env vier vazia ou inválida, usa o fallback ao invés de tentar um URL quebrado.
const BASE_URL = rawUrl.startsWith('http') ? rawUrl : FALLBACK_URL

const DEFAULT_API_TIMEOUT_MS = 30_000

export class ApiError extends Error {
  status: number
  code?: string
  /** Seconds to wait before retrying — populated from the Retry-After header on 429. */
  retryAfter?: number
  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

/**
 * Allowlist: garante que mesmo se um OTA update malicioso conseguisse trocar
 * `extra.apiUrl` ou `EXPO_PUBLIC_API_URL`, o app NÃO mande token Bearer pra
 * um host adversarial. Antes rodava como IIFE em import-time e podia crashar
 * o app inteiro fora do alcance do ErrorBoundary; agora é lazy + cacheada,
 * e o erro é exposto via `getBaseUrlError()` pro App.tsx mostrar UI de erro
 * recuperável (fail-fast no primeiro request, não no boot).
 */
const ALLOWED_HOSTS = ['fyneexsports.com', 'www.fyneexsports.com']

let __baseUrlValidationError: ApiError | null = null
let __baseUrlValidated = false

function validateBaseUrlOnce(): void {
  if (__baseUrlValidated) {
    if (__baseUrlValidationError) throw __baseUrlValidationError
    return
  }
  __baseUrlValidated = true
  try {
    const u = new URL(BASE_URL)
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.includes(u.hostname)) {
      __baseUrlValidationError = new ApiError(
        `BASE_URL não permitida: ${BASE_URL}`,
        0,
        'INVALID_BASE_URL',
      )
    }
  } catch (err) {
    if (err instanceof ApiError) {
      __baseUrlValidationError = err
    } else {
      __baseUrlValidationError = new ApiError(
        'BASE_URL inválida — configuração quebrada',
        0,
        'INVALID_BASE_URL',
      )
    }
  }
  if (__baseUrlValidationError) throw __baseUrlValidationError
}

/**
 * Retorna mensagem do erro de BASE_URL se houver, ou null. Usado pelo
 * `App.tsx` pós-hydrate pra mostrar tela "Atualize o app" sem crashar.
 * Roda a validação on-demand (cacheada) sem propagar throw.
 */
export function getBaseUrlError(): string | null {
  try {
    validateBaseUrlOnce()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

function getAuthHeaders(): Record<string, string> {
  const hash = getAccessHashSync()
  const deviceIdHash = getDeviceIdHashSync()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (hash) headers['Authorization'] = `Bearer ${hash}`
  // X-Device-Id: SHA-256 do Android ID/applicationId. Permite ao servidor
  // detectar token sendo usado de outro device (session hijack defense).
  // Pode ser ausente em primeiro request antes do init terminar — servidor
  // tolera por backward-compat, mas próximos requests sempre carregam.
  if (deviceIdHash) headers['X-Device-Id'] = deviceIdHash
  return headers
}

async function handleResponse<T>(res: Response): Promise<T> {
  let data: Record<string, unknown> = {}
  try {
    data = await res.json() as Record<string, unknown>
  } catch {
    // Resposta não é JSON (ex: HTML de 502/503 de gateway). Nunca vazamos o HTML
    // pro operador — mensagem genérica por status.
    if (!res.ok) {
      throw new ApiError(
        res.status >= 500
          ? 'Erro no servidor — tente novamente em instantes'
          : `HTTP ${res.status}`,
        res.status,
      )
    }
  }
  if (!res.ok) {
    const message = (data.error as string) || `HTTP ${res.status}`
    const code = data.code as string | undefined
    let retryAfter: number | undefined
    if (res.status === 429) {
      const raw = res.headers.get('Retry-After')
      if (raw) {
        const parsed = parseInt(raw, 10)
        if (Number.isFinite(parsed) && parsed > 0) retryAfter = parsed
      }
    }
    throw new ApiError(message, res.status, code, retryAfter)
  }
  return data as T
}

/**
 * Wrapper de fetch com timeout (AbortController) pra não pendurar em rede
 * lenta ou servidor travado. Aceita signal externo do chamador (ex: syncNow
 * que tem seu próprio timeout de 15s mais curto).
 */
async function doFetch(
  input: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_API_TIMEOUT_MS)

  // Propaga o abort do caller pra nosso controller (o primeiro a abortar vence).
  signal?.addEventListener('abort', () => controller.abort(), { once: true })

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ApiError('Tempo esgotado — servidor sem resposta', 0, 'TIMEOUT')
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new ApiError(`Falha de rede: ${msg}`, 0, 'NETWORK_ERROR')
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  validateBaseUrlOnce()
  const res = await doFetch(
    `${BASE_URL}${path}`,
    { method: 'GET', headers: getAuthHeaders() },
    signal,
  )
  return handleResponse<T>(res)
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  validateBaseUrlOnce()
  const res = await doFetch(
    `${BASE_URL}${path}`,
    {
      method: 'POST',
      headers: { ...getAuthHeaders(), ...extraHeaders },
      body: JSON.stringify(body),
    },
    signal,
  )
  return handleResponse<T>(res)
}

export function getApiBaseUrl(): string {
  validateBaseUrlOnce()
  return BASE_URL
}

/**
 * Best-effort logout no servidor — invalida o access_hash em mobile_users.
 * Timeout curto (3s) pra não travar UX se offline. Se falhar, token segue
 * válido até expirar (TTL 30d) ou rotacionar no próximo login do mesmo user.
 */
export async function apiLogout(): Promise<void> {
  // Logout é best-effort; se BASE_URL inválida, simplesmente não tenta server.
  if (getBaseUrlError()) return
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3000)
  try {
    await fetch(`${BASE_URL}/api/mobile/logout`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: '{}',
      signal: controller.signal,
    })
  } catch {
    /* best-effort */
  } finally {
    clearTimeout(timeoutId)
  }
}
