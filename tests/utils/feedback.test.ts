/**
 * Tests pra haptics/beep helpers. Eles são fire-and-forget mas não podem
 * jogar throw pra cima — qualquer throw mata o handler de scan e a UI fica
 * "scanner morto" sem feedback visual. Aqui validamos que sempre swallow.
 */

import { beep, vibrate, feedbackOk, feedbackBad, primeAudio } from '@/utils/feedback'
import * as Haptics from 'expo-haptics'

describe('feedback helpers', () => {
  const notification = Haptics.notificationAsync as jest.Mock
  const impact = Haptics.impactAsync as jest.Mock

  beforeEach(() => {
    notification.mockClear()
    impact.mockClear()
  })

  it('beep("ok") chama Success notification', () => {
    beep('ok')
    expect(notification).toHaveBeenCalledWith('success')
  })

  it('beep("bad") chama Error notification', () => {
    beep('bad')
    expect(notification).toHaveBeenCalledWith('error')
  })

  it('beep() default é "ok"', () => {
    beep()
    expect(notification).toHaveBeenCalledWith('success')
  })

  it('vibrate(number) chama impact Medium', () => {
    vibrate(100)
    expect(impact).toHaveBeenCalledWith('medium')
  })

  it('vibrate(array) chama notification Warning', () => {
    vibrate([100, 50, 100])
    expect(notification).toHaveBeenCalledWith('warning')
  })

  it('feedbackOk / feedbackBad são atalhos pros tipos', () => {
    feedbackOk()
    expect(notification).toHaveBeenLastCalledWith('success')
    feedbackBad()
    expect(notification).toHaveBeenLastCalledWith('error')
  })

  it('regressão: throw em Haptics não propaga (não mata scanner)', () => {
    notification.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    expect(() => beep('ok')).not.toThrow()
  })

  it('primeAudio é no-op em RN (compat com web)', () => {
    expect(() => primeAudio()).not.toThrow()
  })
})
