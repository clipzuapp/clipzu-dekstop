import { useEffect, useState } from 'react'
import { useToast, type ToastItem, type ToastType } from '../../store/useToast'

const ICON: Record<ToastType, string> = {
  success: '\u2713',
  error: '\u2715',
  warning: '\u26A0',
  info: '\u2139'
}

const BG: Record<ToastType, string> = {
  success: 'rgba(34, 197, 94, 0.18)',
  error: 'rgba(239, 68, 68, 0.18)',
  warning: 'rgba(245, 158, 11, 0.18)',
  info: 'rgba(148, 163, 184, 0.15)'
}

const BORDER: Record<ToastType, string> = {
  success: 'rgba(34, 197, 94, 0.4)',
  error: 'rgba(239, 68, 68, 0.4)',
  warning: 'rgba(245, 158, 11, 0.4)',
  info: 'rgba(148, 163, 184, 0.3)'
}

const TEXT: Record<ToastType, string> = {
  success: '#4ade80',
  error: '#f87171',
  warning: '#fbbf24',
  info: '#cbd5e1'
}

function ToastCard({ item }: { item: ToastItem }): JSX.Element {
  const dismiss = useToast((s) => s.dismiss)
  const [entering, setEntering] = useState(true)
  const [copied, setCopied] = useState(false)

  const copyDetails = async (): Promise<void> => {
    if (!item.details) return
    try {
      await navigator.clipboard.writeText(item.details)
      setCopied(true)
    } catch {
      const field = document.createElement('textarea')
      field.value = item.details
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.appendChild(field)
      field.select()
      const ok = document.execCommand('copy')
      field.remove()
      setCopied(ok)
    }
  }

  useEffect(() => {
    const timer = requestAnimationFrame(() => setEntering(false))
    return () => cancelAnimationFrame(timer)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '6px',
        background: BG[item.type],
        border: `0.5px solid ${BORDER[item.type]}`,
        color: TEXT[item.type],
        fontSize: '12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        pointerEvents: 'auto',
        transform: entering ? 'translateX(120%)' : 'translateX(0)',
        opacity: entering ? 0 : 1,
        transition: 'transform 0.25s ease-out, opacity 0.25s ease-out',
        maxWidth: '360px',
        wordBreak: 'break-word'
      }}
      role="alert"
    >
      <span style={{ fontSize: '14px', flexShrink: 0, lineHeight: 1 }}>
        {ICON[item.type]}
      </span>
      <span style={{ flex: 1 }}>{item.message}</span>
      {item.details && (
        <button
          style={{ flexShrink: 0, background: 'none', border: '1px solid currentColor', borderRadius: 4, color: 'inherit', cursor: 'pointer', fontSize: 10, padding: '3px 5px' }}
          onClick={() => void copyDetails()}
          title="Copy diagnostic details to clipboard"
        >
          {copied ? 'Copied' : 'Copy details'}
        </button>
      )}
      <button
        style={{
          flexShrink: 0,
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: '14px',
          opacity: 0.5,
          padding: '0 2px',
          lineHeight: 1
        }}
        onClick={() => dismiss(item.id)}
        title="Dismiss"
      >
        &times;
      </button>
    </div>
  )
}

export function ToastContainer(): JSX.Element {
  const toasts = useToast((s) => s.toasts)

  if (toasts.length === 0) return <></>

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 3000,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: '8px',
        pointerEvents: 'none'
      }}
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  )
}

export default ToastContainer
