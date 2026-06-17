import { useEffect, useCallback } from 'react'
import { useConfirm } from '../../store/useConfirm'

/**
 * ConfirmDialog — reusable confirmation modal with promise-based API.
 * Rendered once in page.tsx; triggered via useConfirm.getState().show(options).
 */
export function ConfirmDialog(): JSX.Element | null {
  const isOpen = useConfirm((s) => s.isOpen)
  const options = useConfirm((s) => s.options)

  const confirm = useCallback(() => {
    useConfirm.getState()._close(true)
  }, [])

  const cancel = useCallback(() => {
    useConfirm.getState()._close(false)
  }, [])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
      if (e.key === 'Enter') confirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, confirm, cancel])

  if (!isOpen || !options) return null

  const isDanger = options.variant === 'danger'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)'
      }}
      onClick={cancel}
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            style={{
              padding: '6px 16px', fontSize: '12px', borderRadius: '4px',
              background: 'var(--bg3)', color: 'var(--text1)',
              border: '0.5px solid var(--border)', cursor: 'pointer'
            }}
            onClick={cancel}
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
            onClick={confirm}
          >
            {options.confirmLabel || (isDanger ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
