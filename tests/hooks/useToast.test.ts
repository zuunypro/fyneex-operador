/**
 * @jest-environment jsdom
 *
 * Tests pra useToast.
 *
 * Bug histórico: trocar de evento no meio do toast disparava setState
 * em componente desmontado (warning + memory leak). O cleanup ref do
 * timer evita isso.
 */

import { renderHook, act } from '@testing-library/react'
import { useToast } from '@/hooks/useToast'

describe('useToast', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('estado inicial: toast=null', () => {
    const { result } = renderHook(() => useToast())
    expect(result.current.toast).toBeNull()
  })

  it('show() seta toast com message+type+id', () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.show('feito', 'success') })
    expect(result.current.toast).toMatchObject({ message: 'feito', type: 'success' })
    expect(typeof result.current.toast!.id).toBe('number')
  })

  it('toast some após durationMs', () => {
    const { result } = renderHook(() => useToast(2000))
    act(() => { result.current.show('hi', 'info') })
    expect(result.current.toast).not.toBeNull()
    act(() => { jest.advanceTimersByTime(1999) })
    expect(result.current.toast).not.toBeNull()
    act(() => { jest.advanceTimersByTime(2) })
    expect(result.current.toast).toBeNull()
  })

  it('show() durante toast ativo substitui o antigo', () => {
    const { result } = renderHook(() => useToast(3000))
    act(() => { result.current.show('a', 'info') })
    const id1 = result.current.toast!.id
    act(() => { result.current.show('b', 'error') })
    expect(result.current.toast!.message).toBe('b')
    expect(result.current.toast!.id).not.toBe(id1)
  })

  it('regressão: timer do antigo NÃO esconde o novo (race)', () => {
    const { result } = renderHook(() => useToast(3000))
    act(() => { result.current.show('a', 'info') })
    act(() => { jest.advanceTimersByTime(2999) })
    act(() => { result.current.show('b', 'success') })
    // Avança 1ms: o timer ANTIGO venceria aqui, mas o id checagem evita o nullify
    act(() => { jest.advanceTimersByTime(1) })
    expect(result.current.toast?.message).toBe('b')
  })

  it('dismiss() esconde imediatamente', () => {
    const { result } = renderHook(() => useToast(5000))
    act(() => { result.current.show('hi', 'info') })
    act(() => { result.current.dismiss() })
    expect(result.current.toast).toBeNull()
  })

  it('cleanup no unmount: timer pendente não vaza', () => {
    const { result, unmount } = renderHook(() => useToast(3000))
    act(() => { result.current.show('hi', 'success') })
    unmount()
    expect(() => { act(() => { jest.advanceTimersByTime(5000) }) }).not.toThrow()
  })

  it('três types possíveis: success / error / info', () => {
    const { result } = renderHook(() => useToast())
    act(() => { result.current.show('a', 'success') })
    expect(result.current.toast?.type).toBe('success')
    act(() => { result.current.show('b', 'error') })
    expect(result.current.toast?.type).toBe('error')
    act(() => { result.current.show('c', 'info') })
    expect(result.current.toast?.type).toBe('info')
  })
})
