/**
 * Secure token + device id service.
 *
 * Hardening 2026-04-26: o accessHash (32 bytes hex emitido por /api/mobile/login)
 * antes ficava em AsyncStorage plain text dentro do JSON do user. Backup do
 * Android (allowBackup=true por default), root, ADB e malware com leitura de
 * sandbox conseguiam exfiltrar.
 *
 * Agora vai pra SecureStore (Android Keystore / iOS Keychain) — chave separada
 * do user object. A flag WHEN_UNLOCKED_THIS_DEVICE_ONLY (iOS) impede backup
 * cross-device; no Android, Keystore por default já é hardware-backed em
 * devices modernos.
 *
 * Device-id binding: cada request leva X-Device-Id (SHA-256 do Android ID
 * estável + bundle/version). O servidor pode rejeitar requests onde o token
 * vaza pra outro device — defense in depth contra session hijack.
 */

import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'fyneex_access_hash'
const DEVICE_ID_KEY = 'fyneex_device_id'

/* ── Access hash (Bearer token) ─────────────────────────────────────────── */

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  // iOS: token só legível enquanto device tá unlocked, e só no device de
  // origem (não migra via iCloud Backup pra outro device).
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

export async function setAccessHash(hash: string): Promise<void> {
  // SecureStore tem cap de 2KB por valor — accessHash é 64 chars hex (32 bytes)
  // então cabe trivialmente.
  await SecureStore.setItemAsync(TOKEN_KEY, hash, SECURE_OPTS)
}

export async function getAccessHash(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTS)
  } catch {
    return null
  }
}

export async function clearAccessHash(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTS)
  } catch {
    // OK if it doesn't exist
  }
}

/* ── Device ID + hash ───────────────────────────────────────────────────── */

let _deviceIdCache: string | null = null
let _deviceIdHashCache: string | null = null

/**
 * UUID v4 fallback puro JS (sem dependência crypto.getRandomValues garantida
 * em RN). Usado só quando Android ID indisponível (raríssimo) — entropia
 * suficiente pra distinguir devices em logs.
 */
function uuidv4Fallback(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Device ID síncrono — cache obrigatório. Use initDeviceIdHash() no boot
 * antes de chamar getDeviceIdSync.
 */
export function getDeviceIdSync(): string {
  if (!_deviceIdCache) {
    // Fallback de emergência (não devia rodar — initDeviceIdHash já priming).
    _deviceIdCache = uuidv4Fallback()
  }
  return _deviceIdCache
}

/**
 * Resolve device id estável. Prefere Android ID (Settings.Secure.ANDROID_ID),
 * que é per-app+per-user signing e estável entre boots. Fallback pra
 * applicationId+nativeApplicationVersion se indisponível (ex: web/dev). Se
 * ambos falham, gera UUID e persiste em SecureStore — última chance de
 * estabilidade.
 */
export async function getDeviceId(): Promise<string> {
  if (_deviceIdCache) return _deviceIdCache

  // 1. Tenta Android ID. expo-application em iOS retorna null aqui.
  try {
    const androidId = Application.getAndroidId()
    if (androidId && androidId.length > 0) {
      _deviceIdCache = androidId
      return androidId
    }
  } catch {
    // ignore
  }

  // 2. Fallback: applicationId + nativeApplicationVersion (estável-ish).
  const appId = Application.applicationId ?? ''
  const appVer = Application.nativeApplicationVersion ?? ''
  if (appId || appVer) {
    const composed = `${appId}#${appVer}`
    if (composed.length > 1) {
      _deviceIdCache = composed
      return composed
    }
  }

  // 3. Último recurso: UUID persistido em SecureStore.
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY)
    if (stored) {
      _deviceIdCache = stored
      return stored
    }
    const generated = uuidv4Fallback()
    await SecureStore.setItemAsync(DEVICE_ID_KEY, generated)
    _deviceIdCache = generated
    return generated
  } catch {
    // Falha total — retorna UUID em memória só pra essa sessão.
    const generated = uuidv4Fallback()
    _deviceIdCache = generated
    return generated
  }
}

export async function getDeviceIdHash(): Promise<string> {
  if (_deviceIdHashCache) return _deviceIdHashCache
  const id = await getDeviceId()
  try {
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      id,
    )
    _deviceIdHashCache = hash
    return hash
  } catch {
    // Fallback pseudo-hash (não criptográfico) — só pra não bloquear request.
    // Em produção real isto não devia rodar; expo-crypto sempre disponível.
    let h = 0
    for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
    const fake = Math.abs(h).toString(16).padStart(8, '0').repeat(8).slice(0, 64)
    _deviceIdHashCache = fake
    return fake
  }
}

/**
 * Acessor síncrono pro device id hash. Retorna null se ainda não inicializado
 * (api.ts trata como "sem header" pra não bloquear primeiro request — boot
 * sempre chama initDeviceIdHash antes do primeiro fetch).
 */
export function getDeviceIdHashSync(): string | null {
  return _deviceIdHashCache
}

/**
 * Pre-warm o cache de device id + hash. Chamar no boot do App.tsx antes de
 * qualquer request — assim getAuthHeaders() (sync) consegue ler do cache.
 */
export async function initDeviceIdHash(): Promise<void> {
  await getDeviceIdHash()
}
