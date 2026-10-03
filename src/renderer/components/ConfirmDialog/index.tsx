import { useEffect, useCallback, useState } from 'react'
import { useConfirm } from '../../store/useConfirm'

/**
 * ConfirmDialog — reusable confirmation modal with promise-based API.
 * Rendered once in page.tsx; triggered via useConfirm.getState().show(options).
 *
 * P1.5 input variant: when options.input is present (and the dialog was
 * opened via showWithInput), a text field renders. Enter confirms with the
 * trimmed value (empty resolves null = no-op), Escape cancels.
 */
export function ConfirmDialog(): JSX.Element | null {
  const isOpen = useConfirm((s) => s.isOpen)
  const options = useConfirm((s) => s.options)

  const [draft, setDraft] = useState('')

  // Reset the draft whenever a new dialog opens.
  useEffect(() => {
    if (isOpen && options) {
      setDraft(options.input?.initialValue ?? '')
    }
  }, [isOpen, options])

  const confirm = useCallback(() => {
    useConfirm.getState()._close(true)
  }, [])

  const cancel = useCallback(() => {
    useConfirm.getState()._close(false)
  }, [])

  const confirmInput = useCallback(() => {
    const value = draft.trim()
    useConfirm.getState()._closeWithInput(value.length > 0 ? value : null)
  }, [draft])

  const cancelInput = useCallback(() => {
    useConfirm.getState()._closeWithInput(null)
  }, [])

  // Close on Escape / confirm on Enter
  useEffect(() => {
    if (!isOpen) return
    const isInputMode = !!options?.input
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (isInputMode ? cancelInput : cancel)()
      if (e.key === 'Enter') (isInputMode ? confirmInput : confirm)()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, options, confirm, cancel, confirmInput, cancelInput])

  if (!isOpen || !options) return null

  const isDanger = options.variant === 'danger'
  const isInputMode = !!options.input

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)'
      }}
      onClick={isInputMode ? cancelInput : cancel}
    >
      <div
        style={{
          background: 'var(--bg1)', border: '0.5px solid var(--border)',
          borderRadius: '8px', padding: '20px 24px',
          minWidth: '320px', maxWidth: '420px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{
          fontSize: '14px', fontWeight: 600, color: 'var(--text1)', margin: '0 0 8px'
        }}>
          {options.title}
        </h3>
        <p style={{
          fontSize: '12px', color: 'var(--text2)', margin: '0 0 20px', lineHeight: 1.5
        }}>
          {options.message}
        </p>
        {isInputMode && (
          <input
            autoFocus
            value={draft}
            placeholder={options.input?.placeholder ?? ''}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Let the input handle text keys; Enter/Escape are also
              // handled globally above — stop double handling here.
              e.stopPropagation()
              if (e.key === 'Enter') confirmInput()
              if (e.key === 'Escape') cancelInput()
            }}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '6px 10px', fontSize: '12px', borderRadius: '4px',
              background: 'var(--bg3)', color: 'var(--text1)',
              border: '0.5px solid var(--border)', outline: 'none',
              margin: '0 0 20px'
            }}
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            style={{
              padding: '6px 16px', fontSize: '12px', borderRadius: '4px',
              background: 'var(--bg3)', color: 'var(--text1)',
              border: '0.5px solid var(--border)', cursor: 'pointer'
            }}
            onClick={isInputMode ? cancelInput : cancel}
          >
            {options.cancelLabel || 'Cancel'}
          </button>
          <button
            style={{
              padding: '6px 16px', fontSize: '12px', borderRadius: '4px',
              background: isDanger ? '#dc2626' : 'var(--accent)',
              color: '#fff', border: 'none', cursor: 'pointer',
              fontWeight: 500
            }}
            onClick={isInputMode ? confirmInput : confirm}
          >
            {options.confirmLabel || (isDanger ? 'Delete' : isInputMode ? 'Rename' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
