/**
 * @jest-environment jsdom
 *
 * Tests pra useDebouncedValue.
 *
 * Bug que esse hook previne: keystroke disparando query SQL/HTTP a cada
 * letra. Sem debounce, busca em 30k participants ficava lagada. Quebrar
 * o cleanup do timeout vaza setState em componentes desmontados (warning
 * + memory leak).
 */

import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('retorna o valor inicial imediatamente (1ª render)', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 250))
    expect(result.current).toBe('a')
  })

  it('atualiza após o delay vencer', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, 250),
      { initialProps: { v: 'a' } },
    )
    rerender({ v: 'b' })
    expect(result.current).toBe('a') // ainda no antigo
    act(() => { jest.advanceTimersByTime(249) })
    expect(result.current).toBe('a')
    act(() => { jest.advanceTimersByTime(1) })
    expect(result.current).toBe('b')
  })

  it('mudança rápida cancela timer anterior (mantém só o último)', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, 250),
      { initialProps: { v: 'a' } },
    )
    rerender({ v: 'b' })
    act(() => { jest.advanceTimersByTime(100) })
    rerender({ v: 'c' })
    act(() => { jest.advanceTimersByTime(100) })
    rerender({ v: 'd' })
    act(() => { jest.advanceTimersByTime(250) })
    expect(result.current).toBe('d')
  })

  it('delay=0 atualiza imediatamente (síncrono no flush)', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, 0),
      { initialProps: { v: 'a' } },
    )
    rerender({ v: 'b' })
    expect(result.current).toBe('b')
  })

  it('delay negativo é tratado como imediato (defensive)', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, -100),
      { initialProps: { v: 'a' } },
    )
    rerender({ v: 'b' })
    expect(result.current).toBe('b')
  })

  it('cleanup no unmount não vaza setState (não throw warning)', () => {
    const { unmount, rerender } = renderHook(
      ({ v }: { v: string }) => useDebouncedValue(v, 250),
      { initialProps: { v: 'a' } },
    )
    rerender({ v: 'b' })
    unmount()
    // Avança o timer DEPOIS do unmount — sem cleanup, isto causaria warning
    expect(() => {
      act(() => { jest.advanceTimersByTime(500) })
    }).not.toThrow()
  })

  it('regressão: tipos genéricos preservados (não vira any)', () => {
    interface ComplexShape { foo: string; bar: number }
    const { result } = renderHook(() =>
      useDebouncedValue<ComplexShape>({ foo: 'x', bar: 1 }, 0),
    )
    expect(result.current.foo).toBe('x')
    expect(result.current.bar).toBe(1)
  })
})
