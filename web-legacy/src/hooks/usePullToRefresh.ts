import { useEffect, useRef, useState } from 'react'

interface Options {
  /** Called when the user releases the pull past the threshold. Should return
   *  a promise so the indicator can spin until the refresh settles. */
  onRefresh: () => void | Promise<unknown>
  /** Pixels of pull required to trigger a refresh. Defaults to 64. */
  threshold?: number
  /** Disable the gesture (e.g. while the panel is mid-refresh). */
  disabled?: boolean
}

export interface PullToRefreshState {
  /** Attach to the scrollable container. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Current translation in px (0..threshold*1.5). */
  pull: number
  /** True once the user crossed the threshold; release fires onRefresh. */
  armed: boolean
  /** True while onRefresh's promise is still in-flight. */
  refreshing: boolean
}

/**
 * Adds iOS-style pull-to-refresh to a scrollable div. Only triggers when the
 * scroll position is already at the top, so ordinary scrolling through the
 * list is not hijacked. Follows the thumb 1:1 up to the threshold, then
 * enters a soft rubber-band past it.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 64,
  disabled,
}: Options): PullToRefreshState {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  // Keep the latest onRefresh in a ref so we don't re-attach listeners every
  // render. The attach effect runs once per mount (plus `disabled` flips),
  // and reads the current handler at release time.
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => { onRefreshRef.current = onRefresh })

  useEffect(() => {
    const el = containerRef.current
    if (!el || disabled) return

    let startY: number | null = null
    let dragging = false
    let currentPull = 0

    function onTouchStart(e: TouchEvent) {
      if (!el || refreshing) return
      if (el.scrollTop > 0) return
      startY = e.touches[0].clientY
      dragging = false
      currentPull = 0
    }

    function onTouchMove(e: TouchEvent) {
      if (startY == null) return
      if (!el || refreshing) return
      const dy = e.touches[0].clientY - startY
      if (dy <= 0) {
        currentPull = 0
        setPull(0)
        return
      }
      if (!dragging && dy > 6) dragging = true
      if (!dragging) return
      if (el.scrollTop > 0) {
        startY = null
        currentPull = 0
        setPull(0)
        return
      }
      const eased = dy < threshold ? dy : threshold + (dy - threshold) * 0.35
      currentPull = Math.min(eased, threshold * 1.6)
      setPull(currentPull)
      if (e.cancelable) e.preventDefault()
    }

    function onTouchEnd() {
      startY = null
      dragging = false
      if (currentPull >= threshold && !refreshing) {
        setRefreshing(true)
        setPull(threshold)
        Promise.resolve(onRefreshRef.current())
          .finally(() => {
            setRefreshing(false)
            setPull(0)
          })
      } else {
        setPull(0)
      }
      currentPull = 0
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [disabled, refreshing, threshold])

  return { containerRef, pull, armed: pull >= threshold, refreshing }
}
