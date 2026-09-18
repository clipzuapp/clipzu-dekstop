import { useEffect } from 'react'
import { useRelink } from '../../store/useRelink'
import { applyLoadedProject } from '../../services/projectSession'
import { useToast } from '../../store/useToast'

/**
 * RelinkDialog — one-click missing-media recovery.
 *
 * Opened automatically when a project load fails because media moved. Lists
 * every missing file, lets the user locate each one or scan a folder, then
 * retries the SAME project. Locate/scan are main-process dialogs (native),
 * so this component only drives the session and renders progress.
 */
export function RelinkDialog(): JSX.Element | null {
  const open = useRelink((s) => s.open)
  const projectFile = useRelink((s) => s.projectFile)
  const missing = useRelink((s) => s.missing)
  const busy = useRelink((s) => s.busy)
  const error = useRelink((s) => s.error)

  const locate = useRelink((s) => s.locate)
  const scan = useRelink((s) => s.scan)
  const retry = useRelink((s) => s.retry)
  const cancel = useRelink((s) => s.cancel)

  // Escape cancels (only when not mid-operation).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) void cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, cancel])

  if (!open) return null

  const handleRetry = async (): Promise<void> => {
    const result = await retry()
    if (result) {
      applyLoadedProject(result)
    } else if (!useRelink.getState().error) {
      useToast.getState().info('Still missing media — locate the remaining files and retry.')
    }
  }

  const fileName = projectFile.split(/[\\/]/).pop() || projectFile

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)'
      }}
      onClick={() => { if (!busy) void cancel() }}
    >
      <div
        style={{
          background: 'var(--bg1)', border: '0.5px solid var(--border)',
          borderRadius: '8px', padding: '20px 24px',
          width: '520px', maxWidth: '90vw', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text1)', margin: '0 0 4px' }}>
          Missing media
        </h3>
        <p style={{ fontSize: '12px', color: 'var(--text2)', margin: '0 0 12px', lineHeight: 1.5 }}>
          {missing.length > 0
            ? `${missing.length} file${missing.length === 1 ? '' : 's'} referenced by "${fileName}" could not be found. Locate them to continue — nothing has been loaded yet.`
            : `All files for "${fileName}" are now resolved.`}
        </p>

        {missing.length > 0 && (
          <div style={{ overflowY: 'auto', flex: 1, margin: '0 0 12px', border: '0.5px solid var(--border)', borderRadius: '6px' }}>
            {missing.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 10px', borderBottom: '0.5px solid var(--border)'
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '12px', color: 'var(--text1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {entry.filename}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    expected: {entry.expected[0]}
                  </div>
                </div>
                <button
                  style={buttonStyle(false)}
                  disabled={busy}
                  onClick={() => void locate(entry.id)}
                >
                  Locate…
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p style={{ fontSize: '11px', color: '#f87171', margin: '0 0 10px' }}>{error}</p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
          <button style={buttonStyle(false)} disabled={busy} onClick={() => void scan()}>
            Scan folder…
          </button>
          <div style={{ flex: 1 }} />
          <button style={buttonStyle(false)} disabled={busy} onClick={() => void cancel()}>
            Cancel
          </button>
          <button
            style={buttonStyle(true, missing.length > 0 || busy)}
            disabled={busy || missing.length > 0}
            onClick={() => void handleRetry()}
          >
            {busy ? 'Working…' : missing.length > 0 ? 'Locate all files to continue' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}

function buttonStyle(primary: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '6px 14px', fontSize: '12px', borderRadius: '4px',
    background: primary ? 'var(--accent)' : 'var(--bg3)',
    color: primary ? '#fff' : 'var(--text1)',
    border: primary ? 'none' : '0.5px solid var(--border)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontWeight: primary ? 500 : 400,
    whiteSpace: 'nowrap'
  }
}

export default RelinkDialog
