import { useEffect, useRef, useCallback } from 'react'

export interface ContextMenuItem {
  label?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  divider?: boolean
  onClick?: () => void
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  x: number
  y: number
  onClose: () => void
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  // Clamp to viewport edges — calculate after mount so we have dimensions
  const clampPosition = useCallback((el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let clampedX = x
    let clampedY = y

    if (x + rect.width > vw) clampedX = vw - rect.width - 8
    if (y + rect.height > vh) clampedY = vh - rect.height - 8
    if (clampedX < 4) clampedX = 4
    if (clampedY < 4) clampedY = 4

    el.style.left = `${clampedX}px`
    el.style.top = `${clampedY}px`
    el.style.visibility = 'visible'
  }, [x, y])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Close on outside mousedown
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid the same mousedown that triggered the context menu
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleMouseDown)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', handleMouseDown)
    }
  }, [onClose])

  // Clamp after render
  useEffect(() => {
    if (menuRef.current) {
      clampPosition(menuRef.current)
    }
  }, [clampPosition])

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        zIndex: 2000,
        visibility: 'hidden',
        minWidth: '180px',
        padding: '4px 0',
        background: 'var(--bg2)',
        border: '0.5px solid var(--border)',
        borderRadius: '6px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        userSelect: 'none'
      }}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return (
            <div
              key={`div-${i}`}
              style={{
                height: '1px',
                background: 'var(--border)',
                margin: '3px 6px'
              }}
            />
          )
        }

        return (
          <button
            key={`item-${i}`}
            disabled={item.disabled}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              padding: '5px 12px',
              fontSize: '12px',
              color: item.disabled
                ? 'var(--text3)'
                : item.danger
                  ? '#f87171'
                  : 'var(--text1)',
              background: 'transparent',
              border: 'none',
              cursor: item.disabled ? 'default' : 'pointer',
              textAlign: 'left',
              opacity: item.disabled ? 0.4 : 1,
              transition: 'background 0.08s'
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                e.currentTarget.style.background = 'var(--bg3)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            onClick={() => {
              if (!item.disabled && item.onClick) {
                item.onClick()
              }
              onClose()
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{
                fontSize: '10px',
                color: 'var(--text3)',
                marginLeft: '24px',
                fontFamily: 'var(--font-mono)'
              }}>
                {item.shortcut}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default ContextMenu
