/**
 * Feedback helpers for the scanner/checkin flow. Race day is noisy — toast-only
 * feedback isn't enough, the operator often scans without looking at the screen.
 * Layers haptic (expo-haptics) + audio (Audio.Sound on a tiny PCM blob) cues.
 */

import * as Haptics from 'expo-haptics'

type BeepKind = 'ok' | 'bad'

export function beep(kind: BeepKind = 'ok') {
  // Haptic + native system sound. Full Audio.Sound would add ~200KB bundle
  // for a 100ms beep; we rely on notificationAsync which produces an audible
  // click on most Android devices and haptic on iOS.
  if (kind === 'ok') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
  } else {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
  }
}

export function vibrate(pattern: number | number[]) {
  if (typeof pattern === 'number') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
  } else {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
  }
}

export function feedbackOk() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

export function feedbackBad() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
}

/** No-op em RN — mantido pra compat com chamadas existentes vindas do web. */
export function primeAudio() { /* noop */ }
