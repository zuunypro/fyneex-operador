/**
 * Feedback helpers for the scanner/checkin flow. Runs in noisy environments
 * (race day gate), so relying on visual toasts alone is not enough — the
 * operator often scans without looking at the screen. These helpers layer
 * haptic + audio cues that work inside the WebView the APK will ship in.
 */

type BeepKind = 'ok' | 'bad'

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx && ctx.state !== 'closed') return ctx
  const Ctor = window.AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    ctx = null
  }
  return ctx
}

export function beep(kind: BeepKind = 'ok') {
  const ac = getCtx()
  if (!ac) return
  // Mobile browsers suspend AudioContext until a user gesture. The scanner
  // button tap should have resumed it earlier; retry here anyway so the first
  // scan of a new session still plays.
  if (ac.state === 'suspended') ac.resume().catch(() => { /* ignore */ })
  try {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.value = kind === 'ok' ? 880 : 220
    const now = ac.currentTime
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.22, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'ok' ? 0.12 : 0.3))
    osc.connect(gain).connect(ac.destination)
    osc.start(now)
    osc.stop(now + (kind === 'ok' ? 0.14 : 0.32))
  } catch {
    /* audio disabled — silent fallback */
  }
}

export function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try { navigator.vibrate?.(pattern) } catch { /* ignore */ }
}

export function feedbackOk() {
  vibrate(60)
  beep('ok')
}

export function feedbackBad() {
  vibrate([40, 60, 40])
  beep('bad')
}

/**
 * Call once inside a user-gesture handler (e.g. tap on the scanner FAB) so
 * iOS/Android browsers allow audio playback for the rest of the session.
 */
export function primeAudio() {
  const ac = getCtx()
  if (ac && ac.state === 'suspended') ac.resume().catch(() => { /* ignore */ })
}
