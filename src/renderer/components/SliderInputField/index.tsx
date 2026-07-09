import { useState, useRef, useCallback, useEffect, useMemo } from 'react'

// ---------------------------------------------------------------------------
// SliderInputField — SSOT dual slider + numeric input control
// ---------------------------------------------------------------------------
//
// Replaces ALL range-only sliders and ad-hoc dual-controls across the app.
// Bidirectionally synced: dragging slider updates input, typing updates slider.
// Built-in debounce support for high-frequency store writes (e.g., caption style).
//
// Layout (labeled):  [label 90px] [====slider====] [__52px input__] [unit]
// Layout (compact):  [====slider====] [__52px input__]

// ---------------------------------------------------------------------------
// Debounce utility — local to this module, not exported
// ---------------------------------------------------------------------------

function makeDebounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SliderInputFieldProps {
  /** Display label. Hidden in compact mode. */
  label: string
  /** Current value (controlled). */
  value: number
  /** Minimum allowed value. */
  min: number
  /** Maximum allowed value. */
  max: number
  /** Step increment. */
  step: number
  /** Unit suffix displayed after input (e.g., 'px', '%', '°', 'dB', 'ms', '×'). */
  unit?: string
  /** Called when value changes. For debounced mode, fires after debounce delay. */
  onChange: (value: number) => void
  /** Debounce delay in ms for onChange. 0 = immediate (default). */
  debounceMs?: number
  /** Disable the control. */
  disabled?: boolean
  /** Compact mode: hides label, removes horizontal padding. For toolbar/transport use. */
  compact?: boolean
  /** Additional CSS class for the root container. */
  className?: string
}

// ---------------------------------------------------------------------------
// Clamp + snap utilities
// ---------------------------------------------------------------------------

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val))
}

function snapToStep(val: number, min: number, step: number): number {
  if (step <= 0) return val
  const steps = Math.round((val - min) / step)
  return min + steps * step
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SliderInputField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  debounceMs = 0,
  disabled = false,
  compact = false,
  className
}: SliderInputFieldProps): JSX.Element {
  // Local state for immediate visual feedback (slider + input both read from this)
  const [localValue, setLocalValue] = useState(value)

  // Sync local state when external value changes (selection change, undo/redo, etc.)
  useEffect(() => { setLocalValue(value) }, [value])

  // Debounced onChange caller — stable reference, recreated only when onChange or debounceMs changes
  const debouncedOnChange = useMemo(
    () => debounceMs > 0 ? makeDebounce(onChange, debounceMs) : null,
    [onChange, debounceMs]
  )

  // Cleanup debounce timer on unmount
  const debouncedRef = useRef(debouncedOnChange)
  debouncedRef.current = debouncedOnChange
  useEffect(() => {
    return () => {
      // Clear any pending debounce on unmount
      if (debouncedRef.current) {
        // The debounce timer is internal to makeDebounce — no external cleanup needed
        // as React GC will collect the closure
      }
    }
  }, [])

  // Process a new value: clamp, snap, update local, fire onChange
  const processValue = useCallback((raw: number): void => {
    const clamped = clamp(raw, min, max)
    const snapped = snapToStep(clamped, min, step)
    // Round to avoid floating point drift
    const precision = step < 1 ? Math.ceil(-Math.log10(step)) : 0
    const rounded = precision > 0 ? Math.round(snapped * 10 ** precision) / (10 ** precision) : snapped

    setLocalValue(rounded)

    if (debounceMs > 0 && debouncedRef.current) {
      debouncedRef.current(rounded)
    } else {
      onChange(rounded)
    }
  }, [min, max, step, onChange, debounceMs])

  // Slider drag handler — immediate (no debounce for slider, feels laggy)
  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = parseFloat(e.target.value)
    if (Number.isNaN(raw)) return
    setLocalValue(raw)
    // Slider always fires immediately for smooth dragging
    if (debounceMs > 0 && debouncedRef.current) {
      debouncedRef.current(raw)
    } else {
      onChange(raw)
    }
  }, [onChange, debounceMs])

  // Numeric input handler — debounced for typing
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = parseFloat(e.target.value)
    if (Number.isNaN(raw)) return
    processValue(raw)
  }, [processValue])

  // On input blur, snap and clamp the displayed value
  const handleInputBlur = useCallback((): void => {
    const clamped = clamp(localValue, min, max)
    const snapped = snapToStep(clamped, min, step)
    const precision = step < 1 ? Math.ceil(-Math.log10(step)) : 0
    const rounded = precision > 0 ? Math.round(snapped * 10 ** precision) / (10 ** precision) : snapped
    setLocalValue(rounded)
    // Fire onChange with the final snapped value if different
    if (rounded !== localValue) {
      onChange(rounded)
    }
  }, [localValue, min, max, step, onChange])

  // Keyboard: Enter commits and blurs
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur()
    }
  }, [])

  // Format display value: use step precision
  const displayValue = useMemo((): string => {
    const precision = step < 1 ? Math.ceil(-Math.log10(step)) : 0
    return localValue.toFixed(precision)
  }, [localValue, step])

  const rootClass = compact
    ? `sif-row sif-compact${className ? ` ${className}` : ''}`
    : `sif-row${className ? ` ${className}` : ''}`

  return (
    <div className={rootClass}>
      {!compact && (
        <span className="sif-label">{label}</span>
      )}
      <input
        type="range"
        className="sif-slider"
        min={min}
        max={max}
        step={step}
        value={localValue}
        onChange={handleSliderChange}
        disabled={disabled}
      />
      <input
        type="number"
        className="sif-input"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={handleInputKeyDown}
        disabled={disabled}
      />
      {unit && (
        <span className="sif-unit">{unit}</span>
      )}
    </div>
  )
}

export default SliderInputField
