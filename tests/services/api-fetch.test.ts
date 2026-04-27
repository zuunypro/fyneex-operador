/**
 * Tests pra apiGet / apiPost / apiLogout — usa global.fetch mockado pra
 * exercitar o caminho completo: headers, JSON parsing, ApiError de status,
 * 429 com Retry-After, network error, timeout (abort).
 *
 * Cobre os bugs históricos:
 *   - HTML de gateway 502 vazava como mensagem "exceção" — handleResponse
 *     agora retorna mensagem genérica.
 *   - Authorization header só era setado se hash existisse — testar ambos.
 *   - apiLogout precisa ser best-effort (não throw mesmo offline).
 */

interface MockResponse {
  ok: boolean
  status: number
  headers?: Record<string, string>
  json?: unknown
  jsonThrows?: boolean
}

function makeFetchMock(responses: MockResponse | MockResponse[]) {
  // Replays a última resposta indefinidamente — testes que chamam apiGet duas
  // vezes (ex: expect().rejects.toMatchObject + expect().rejects.toBeInstanceOf)
  // não devem ficar sem resposta no segundo dispatch.
  const arr = Array.isArray(responses) ? responses : [responses]
  let idx = 0
  const calls: { url: string; init: RequestInit }[] = []
  const fn = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const r = arr[Math.min(idx++, arr.length - 1)]
    return {
      ok: r.ok,
      status: r.status,
      headers: { get: (k: string) => (r.headers ?? {})[k.toLowerCase()] ?? null },
      json: async () => {
        if (r.jsonThrows) throw new Error('not json')
        return r.json
      },
    } as unknown as Response
  })
  return { fn, calls }
}

describe('apiGet — happy path', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('GET retorna JSON parsed quando ok=true', async () => {
    const { fn } = makeFetchMock({ ok: true, status: 200, json: { foo: 'bar' } })
    global.fetch = fn as unknown as typeof fetch
    jest.isolateModules(() => {
      // sem await — no problem
    })
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    const result = await apiGet<{ foo: string }>('/api/test')
    expect(result).toEqual({ foo: 'bar' })
  })

  it('GET monta URL com BASE_URL + path', async () => {
    const { fn, calls } = makeFetchMock({ ok: true, status: 200, json: {} })
    global.fetch = fn as unknown as typeof fetch
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    await apiGet('/api/foo')
    expect(calls[0].url).toBe('https://fyneexsports.com/api/foo')
    expect(calls[0].init.method).toBe('GET')
  })

  it('GET inclui Content-Type + Accept default', async () => {
    const { fn, calls } = makeFetchMock({ ok: true, status: 200, json: {} })
    global.fetch = fn as unknown as typeof fetch
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    await apiGet('/api/foo')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Accept']).toBe('application/json')
  })
})

describe('apiPost — happy path', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('POST envia body como JSON string', async () => {
    const { fn, calls } = makeFetchMock({ ok: true, status: 200, json: { ok: true } })
    global.fetch = fn as unknown as typeof fetch
    const { apiPost } = require('@/services/api') as typeof import('@/services/api')
    await apiPost('/api/foo', { a: 1, b: 'x' })
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.body).toBe(JSON.stringify({ a: 1, b: 'x' }))
  })

  it('POST aceita extraHeaders (ex: Idempotency-Key)', async () => {
    const { fn, calls } = makeFetchMock({ ok: true, status: 200, json: {} })
    global.fetch = fn as unknown as typeof fetch
    const { apiPost } = require('@/services/api') as typeof import('@/services/api')
    await apiPost('/api/foo', {}, undefined, { 'Idempotency-Key': 'abc' })
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('abc')
  })
})

describe('handleResponse — error paths', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('400 com JSON { error, code } → ApiError com message + code', async () => {
    const { fn } = makeFetchMock({
      ok: false, status: 400, json: { error: 'algo errado', code: 'EVENT_INACTIVE' },
    })
    global.fetch = fn as unknown as typeof fetch
    const { apiGet, ApiError } = require('@/services/api') as typeof import('@/services/api')
    await expect(apiGet('/x')).rejects.toMatchObject({
      message: 'algo errado',
      status: 400,
      code: 'EVENT_INACTIVE',
    })
    await expect(apiGet('/x')).rejects.toBeInstanceOf(ApiError)
  })

  it('429 com Retry-After header → ApiError.retryAfter', async () => {
    const { fn } = makeFetchMock({
      ok: false, status: 429, headers: { 'retry-after': '30' },
      json: { error: 'rate limit' },
    })
    global.fetch = fn as unknown as typeof fetch
    const { apiPost } = require('@/services/api') as typeof import('@/services/api')
    await expect(apiPost('/x', {})).rejects.toMatchObject({
      status: 429,
      retryAfter: 30,
    })
  })

  it('429 sem Retry-After → ApiError.retryAfter undefined (não NaN)', async () => {
    const { fn } = makeFetchMock({ ok: false, status: 429, json: { error: 'rate' } })
    global.fetch = fn as unknown as typeof fetch
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    try {
      await apiGet('/x')
      fail('should have thrown')
    } catch (err: unknown) {
      const apiErr = err as { retryAfter?: number }
      expect(apiErr.retryAfter).toBeUndefined()
    }
  })

  it('regressão: 502 com HTML (não-JSON) NÃO vaza HTML pro caller', async () => {
    const { fn } = makeFetchMock({ ok: false, status: 502, jsonThrows: true })
    global.fetch = fn as unknown as typeof fetch
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    await expect(apiGet('/x')).rejects.toMatchObject({
      status: 502,
    })
    await expect(apiGet('/x')).rejects.toThrow(/servidor|tente/i)
  })

  it('400 sem JSON parseable → mensagem genérica baseada em status', async () => {
    const { fn } = makeFetchMock({ ok: false, status: 400, jsonThrows: true })
    global.fetch = fn as unknown as typeof fetch
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    await expect(apiGet('/x')).rejects.toMatchObject({
      status: 400,
    })
  })

  it('200 ok mas JSON parse falha → retorna data vazio (não throw)', async () => {
    // Este path da implementação: data = {} se json() throws e ok=true.
    const { fn } = makeFetchMock({ ok: true, status: 200, jsonThrows: true })
    global.fetch = fn as unknown as typeof fetch
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    const result = await apiGet('/x')
    expect(result).toEqual({})
  })
})

describe('Network error / timeout', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('fetch throw genérico → ApiError code=NETWORK_ERROR status=0', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('Network request failed')
    }) as unknown as typeof fetch
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    await expect(apiGet('/x')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    })
  })

  it('signal externo aborta → ApiError code=TIMEOUT', async () => {
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      // Simula que o servidor nunca responde — espera o abort do controller
      return new Promise<Response>((_resolve, reject) => {
        const sig = init.signal as AbortSignal
        sig.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      })
    }) as unknown as typeof fetch

    const controller = new AbortController()
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    const promise = apiGet('/x', controller.signal)
    setTimeout(() => controller.abort(), 10)
    await expect(promise).rejects.toMatchObject({
      status: 0,
      code: 'TIMEOUT',
    })
  })
})

describe('apiLogout — best-effort', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('chama POST /api/mobile/logout', async () => {
    const { fn, calls } = makeFetchMock({ ok: true, status: 200, json: {} })
    global.fetch = fn as unknown as typeof fetch
    const { apiLogout } = require('@/services/api') as typeof import('@/services/api')
    await apiLogout()
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0].url).toContain('/api/mobile/logout')
    expect(calls[0].init.method).toBe('POST')
  })

  it('não throw se servidor falhar (best-effort)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const { apiLogout } = require('@/services/api') as typeof import('@/services/api')
    await expect(apiLogout()).resolves.not.toThrow()
  })

  it('não throw se servidor retornar 500', async () => {
    const { fn } = makeFetchMock({ ok: false, status: 500, json: {} })
    global.fetch = fn as unknown as typeof fetch
    const { apiLogout } = require('@/services/api') as typeof import('@/services/api')
    await expect(apiLogout()).resolves.not.toThrow()
  })
})

describe('Authorization + X-Device-Id headers', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('inclui Bearer token quando setUser foi chamado', async () => {
    const { fn, calls } = makeFetchMock({ ok: true, status: 200, json: {} })
    global.fetch = fn as unknown as typeof fetch
    // Setup user (set accessHashMirror via setUser)
    const { useUserStore } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    await useUserStore.getState().setUser({
      id: 'u1', name: 'A', email: 'a@b.com', accessHash: 'tok-xxx',
    })
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    await apiGet('/api/foo')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer tok-xxx')
  })

  it('NÃO inclui Authorization quando user não setado', async () => {
    const { useUserStore } = require('@/stores/userStore') as typeof import('@/stores/userStore')
    await useUserStore.getState().clearUser()
    const { fn, calls } = makeFetchMock({ ok: true, status: 200, json: {} })
    global.fetch = fn as unknown as typeof fetch
    const { apiGet } = require('@/services/api') as typeof import('@/services/api')
    await apiGet('/api/foo')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })
})
