import { useMemo, useRef, useCallback } from 'react'

/**
 * Debounce a callback by the specified delay.
 * Returns a stable function reference that can be used in event handlers.
 */
export function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  return useMemo(() => {
    const debouncedFn = (...args: Parameters<T>): void => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args)
        timeoutRef.current = null
      }, delay)
    }

    return debouncedFn as T
  }, [callback, delay])
}

/**
 * Create a debounced version of a function that updates state.
 * Live preview: call onInput immediately for visual feedback
 * Store write: debounced by 50ms to avoid excessive updates
 */
export function useDebounce<T>(
  fn: (value: T) => void,
  delay: number
): (value: T) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  return useCallback(
    (value: T): void => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        fn(value)
        timeoutRef.current = null
      }, delay)
    },
    [fn, delay]
  )
}
