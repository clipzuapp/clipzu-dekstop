import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useCaption } from '../../store/useCaption'
import { useTimeline } from '../../store/useTimeline'
import { useConfirm } from '../../store/useConfirm'
import { useToast } from '../../store/useToast'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/index'
import { formatTime } from '../../utils/format'
import { firstFreeCaptionLane, usedCaptionLanes } from '../../../shared/captions/lanes'
import { DIAGNOSTICS_EXPORT_CHANNEL } from '../../../shared/ipc/channels'

/** Map raw error strings to user-friendly messages */
function friendlyErrorMessage(raw: string): string {
  if (raw.includes('3221226505') || raw.includes('STACK_BUFFER_OVERRUN')) {
    return 'Whisper engine crashed with a stack buffer overrun (0xC0000409). This is typically caused by binary/model incompatibility — the whisper-cli.exe or its ggml DLLs cannot process this model format. Run the Diagnostics and click "Run Tests" to confirm.'
  }
  if (raw.includes('3221225477') || raw.includes('ACCESS_VIOLATION')) {
    return 'Whisper engine crashed with an access violation. Try updating your Visual C++ Redistributables from Microsoft.'
  }
  if (raw.includes('3221225725') || raw.includes('ILLEGAL_INSTRUCTION')) {
    return 'Whisper engine encountered an illegal CPU instruction. Your processor may not support the required AVX2 instruction set.'
  }
  if (raw.includes('ENV_CHECK_FAILED')) {
    return raw.replace('Transcription failed: ENV_CHECK_FAILED: ', '').replace('ENV_CHECK_FAILED: ', '')
  }
  if (raw.includes('spawn error') || raw.includes('ENOENT')) {
    return 'Could not launch the Whisper binary. Check that the application binaries are intact.'
  }
  if (raw.includes('model') && raw.includes('not found')) {
    return 'Whisper model file is missing. Please re-download the model file.'
  }
  return 'An unexpected error occurred during transcription.'
}

/** Derive a human-readable stage label from progress percentage */
function transcriptionStage(progress: number): string {
  if (progress <= 5) return 'Extracting audio...'
  if (progress <= 90) return 'Transcribing...'
  if (progress < 100) return 'Generating captions...'
  return 'Done'
}

/** Section header for diagnostics modal */
function SectionHeader({ label }: { label: string }): JSX.Element {
  return (
    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-1 border-t border-editor-border/50">
      {label}
    </div>
  )
}

/** Single row in diagnostics modal — boolean values get OK/MISSING coloring */
function DiagRow({ label, value, mono }: { label: string; value: unknown; mono?: boolean }): JSX.Element {
  const boolVal = typeof value === 'boolean' ? value : undefined
  const strVal  = typeof value === 'boolean' ? (value ? 'OK' : 'MISSING') : String(value ?? '')
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={
        typeof boolVal === 'boolean'
          ? (boolVal ? 'text-green-400' : 'text-danger')
          : mono ? 'text-gray-300 font-mono text-[10px] truncate ml-2 max-w-[180px]' : 'text-gray-300'
      }>
        {strVal}
      </span>
    </div>
  )
}

/** Test result row for live diagnostic tests */
function TestResultRow({ label, result }: { label: string; result?: Record<string, unknown> }): JSX.Element {
  if (!result) return <div className="flex justify-between"><span className="text-gray-500">{label}</span><span className="text-gray-600">—</span></div>
  const ok = result.ok as boolean
  const exitCode = result.exitCode as number | null
  const error = result.error as string | undefined
  const errorType = result.errorType as string | undefined
  const statusLabel = ok ? 'PASS'
    : errorType === 'timeout' ? 'TIMEOUT'
    : errorType === 'crash' ? 'CRASH'
    : error ? `FAIL: ${error}`
    : `FAIL (exit ${exitCode})`
  const colorClass = ok ? 'text-green-400'
    : errorType === 'timeout' ? 'text-yellow-400'
    : 'text-danger'
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={colorClass}>{statusLabel}</span>
    </div>
  )
}

export function CaptionEditor(): JSX.Element {
  const entries = useTimeline((s) => s.textClips)
  const focusedId = useTimeline((s) => s.focusedId)
  const textClips = useTimeline((s) => s.textClips)
  const status = useCaption((s) => s.status)
  const progress = useCaption((s) => s.progress)
  const language = useCaption((s) => s.language)
  const error = useCaption((s) => s.error)

  const selectedId = useMemo(() => {
    if (!focusedId) return null
    return textClips.some((tc) => tc.id === focusedId) ? focusedId : null
  }, [focusedId, textClips])

  const editEntry = useCaption((s) => s.editEntry)
  const deleteEntry = useCaption((s) => s.deleteEntry)
  const selectEntry = useCaption((s) => s.selectEntry)
  const setLanguage = useCaption((s) => s.setLanguage)
  const cancelTranscription = useCaption((s) => s.cancelTranscription)
  const importSRT = useCaption((s) => s.importSRT)
  const clearCaptions = useCaption((s) => s.clearCaptions)
  const splitEntry = useCaption((s) => s.splitEntry)
  const splitEntryWithText = useCaption((s) => s.splitEntryWithText)
  const mergeEntries = useCaption((s) => s.mergeEntries)
  const setEntryTiming = useCaption((s) => s.setEntryTiming)
  const reformatForShorts = useCaption((s) => s.reformatForShorts)

  const playheadMs = useTimeline((s) => s.playheadMs)

  const [srtInput, setSrtInput] = useState('')
  const [showImport, setShowImport] = useState(false)
  // P2.1: explicit SRT import lane. null = first free at import time.
  const [srtLane, setSrtLane] = useState<number | null>(null)
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [editingTimingId, setEditingTimingId] = useState<string | null>(null)
  const [diagnosticTests, setDiagnosticTests] = useState<Record<string, unknown> | null>(null)
  const [runningTests, setRunningTests] = useState(false)
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  // Toast on transcription completion
  const prevStatus = useRef(status)
  useEffect(() => {
    if (prevStatus.current === 'transcribing' && status === 'done') {
      useToast.getState().success(`Transcription complete — ${entries.length} captions`)
    }
    prevStatus.current = status
  }, [status, entries.length])

  const handleTranscribe = useCallback(async (): Promise<void> => {
    const state = useTimeline.getState()
    const clips = state.clips
    if (clips.length === 0) {
      useToast.getState().warning('Add a video to the timeline first')
      return
    }
    const targetId = (state.focusedId && clips.some((c) => c.id === state.focusedId))
      ? state.focusedId
      : clips[0].id
    await useCaption.getState().transcribeClip(targetId, language)
  }, [language])

  // P2.1: explicit lane picker (default first free). Resolved against live
  // lanes at click time so concurrent edits can't silently pile onto lane 0.
  const srtExistingLanes = usedCaptionLanes(textClips)
  const srtDefaultLane = firstFreeCaptionLane(textClips)
  const handleImportSRT = (): void => {
    if (srtInput.trim()) {
      importSRT(srtInput, srtLane ?? srtDefaultLane)
      setSrtInput('')
      setSrtLane(null)
      setShowImport(false)
    }
  }

  const handleDiagnostics = async (): Promise<void> => {
    try {
      const result = await window.electron.ipcRenderer.invoke('whisper:getDiagnostics') as Record<string, unknown>
      setDiagnostics(result)
      setDiagnosticTests(null)
      setShowDiagnostics(true)
    } catch {
      setDiagnostics({ error: 'Could not fetch diagnostics' })
      setShowDiagnostics(true)
    }
  }

  const handleRunDiagnosticTests = async (): Promise<void> => {
    setRunningTests(true)
    setDiagnosticTests(null)
    try {
      const result = await window.electron.ipcRenderer.invoke('whisper:runDiagnosticTests') as Record<string, unknown>
      setDiagnosticTests(result)
    } catch (e) {
      setDiagnosticTests({ error: (e as Error).message })
    } finally {
      setRunningTests(false)
    }
  }

  const handleExportDiagnostics = async (): Promise<void> => {
    setExportingDiagnostics(true)
    try {
      const result: unknown = await window.electron.ipcRenderer.invoke(DIAGNOSTICS_EXPORT_CHANNEL)
      if (typeof result !== 'object' || result === null || typeof (result as { ok?: unknown }).ok !== 'boolean') {
        throw new Error('Invalid diagnostic export response.')
      }
      const response = result as { ok: boolean; canceled?: boolean; error?: string }
      if (response.ok) useToast.getState().success('Diagnostic bundle saved.')
      else if (!response.canceled) useToast.getState().error(response.error ?? 'Could not export diagnostics.')
    } catch (e) {
      useToast.getState().error('Could not export diagnostics.', e instanceof Error ? e.message : String(e))
    } finally {
      setExportingDiagnostics(false)
    }
  }

  const handleCaptionKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>, entryId: string) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault()
      const textarea = e.currentTarget
      const cursorPos = textarea.selectionStart ?? 0
      const text = textarea.value
      const textBefore = text.slice(0, cursorPos).trim()
      const textAfter = text.slice(cursorPos).trim()

      // If there's nothing to split, just ignore
      if (!textBefore && !textAfter) return

      const entry = entries.find((en) => en.id === entryId)
      if (!entry) return

      // Split at playhead if within the entry, otherwise at midpoint
      const ph = useTimeline.getState().playheadMs
      const splitAt = (ph > entry.startMs && ph < entry.endMs)
        ? ph
        : Math.round((entry.startMs + entry.endMs) / 2)

      splitEntryWithText(entryId, textBefore || textAfter, textAfter || textBefore, splitAt)
    }
    // Ctrl+Enter or Shift+Enter: default newline behavior (no prevention needed)
  }, [entries, splitEntryWithText])

  const handleSplit = (entryId: string): void => {
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) return
    // Split at playhead if within the entry, otherwise split at midpoint
    const splitAt = (playheadMs >= entry.startMs && playheadMs < entry.endMs)
      ? playheadMs
      : Math.round((entry.startMs + entry.endMs) / 2)
    splitEntry(entryId, splitAt)
  }

  const handleMerge = (entryId: string): void => {
    const idx = entries.findIndex((e) => e.id === entryId)
    if (idx < 0 || idx >= entries.length - 1) return
    mergeEntries(entryId, entries[idx + 1].id)
  }

  return (
    <div className="p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">Captions</h3>
        <span className="text-[10px] text-gray-500">{entries.length} entries</span>
      </div>

      {/* Language selector */}
      <div className="flex gap-2">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="input flex-1 text-xs"
        >
          <option value="auto">Auto-detect</option>
          <option value="en">English</option>
          <option value="id">Indonesian</option>
          <option value="ja">Japanese</option>
          <option value="ko">Korean</option>
          <option value="zh">Chinese</option>
          <option value="es">Spanish</option>
          <option value="fr">French</option>
        </select>
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        {status === 'transcribing' ? (
          <button className="btn btn-danger flex-1 text-xs" onClick={cancelTranscription}>
            Cancel ({Math.round(progress)}%)
          </button>
        ) : (
          <button className="btn btn-primary flex-1 text-xs" onClick={handleTranscribe}>
            Transcribe Audio
          </button>
        )}
        <button className="btn btn-secondary text-xs" onClick={() => setShowImport(!showImport)}>
          SRT
        </button>
        {entries.length > 0 && (
          <>
            <button className="btn btn-secondary text-xs" onClick={() => {
              useConfirm.getState().show({
                title: 'Clear All Captions',
                message: `Delete all ${entries.length} caption entries? This cannot be undone.`,
                variant: 'danger',
                confirmLabel: 'Clear All'
              }).then((confirmed) => { if (confirmed) clearCaptions() })
            }}>
              Clear
            </button>
            <button className="btn btn-secondary text-xs" onClick={reformatForShorts} title="Reformat for TikTok/Reels/Shorts">
              Shorts
            </button>
          </>
        )}
      </div>

      {/* Progress bar with stage label */}
      {status === 'transcribing' && (
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-gray-400">{transcriptionStage(progress)}</span>
            <span className="text-[10px] text-gray-500 tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-1.5 bg-editor-surface rounded overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Structured error card */}
      {error && (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded space-y-2">
          <p className="text-sm font-semibold text-danger">Transcription Failed</p>
          <p className="text-xs text-gray-400">{friendlyErrorMessage(error)}</p>
          <details className="text-[10px] text-gray-600">
            <summary className="cursor-pointer hover:text-gray-400 select-none">Show Details</summary>
            <pre className="mt-1 whitespace-pre-wrap break-all leading-4 max-h-32 overflow-y-auto">{error}</pre>
          </details>
          <div className="flex gap-2">
            <button className="btn btn-primary text-xs" onClick={handleTranscribe}>
              Retry
            </button>
            <button className="btn btn-secondary text-xs" onClick={handleDiagnostics}>
              Diagnostics
            </button>
          </div>
        </div>
      )}

      {/* Diagnostics modal */}
      {showDiagnostics && diagnostics && (
        <div className="p-3 bg-editor-surface border border-editor-border rounded space-y-2 text-xs">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-gray-300">System Diagnostics</span>
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary text-xs py-1" onClick={() => void handleExportDiagnostics()} disabled={exportingDiagnostics}>
                {exportingDiagnostics ? 'Preparing…' : 'Export bundle'}
              </button>
              <button className="text-gray-500 hover:text-gray-300" onClick={() => setShowDiagnostics(false)}>Close</button>
            </div>
          </div>

          {/* Binary */}
          <SectionHeader label="Binary" />
          <DiagRow label="Status" value={diagnostics.binary as boolean} />
          <DiagRow label="Path" value={diagnostics.binaryPath as string} mono />

          {/* Model */}
          <SectionHeader label="Model" />
          <DiagRow label="Status" value={diagnostics.model as boolean} />
          <DiagRow label="Path" value={diagnostics.modelPath as string} mono />

          {/* VC Runtime */}
          <SectionHeader label="VC Runtime" />
          <DiagRow label="Status" value={diagnostics.vcRuntime as boolean} />

          {/* CPU */}
          <SectionHeader label="CPU" />
          <DiagRow label="Name" value={diagnostics.cpuName as string} />

          {/* CPU Features */}
          <SectionHeader label="CPU Features" />
          <DiagRow label="AVX" value={diagnostics.cpuAVX as boolean} />
          <DiagRow label="AVX2" value={diagnostics.cpuAVX2 as boolean} />
          <DiagRow label="FMA" value={diagnostics.cpuFMA as boolean} />
          <DiagRow label="SSE4.1" value={diagnostics.cpuSSE41 as boolean} />
          <DiagRow label="SSE4.2" value={diagnostics.cpuSSE42 as boolean} />

          {/* System */}
          <SectionHeader label="System" />
          <DiagRow label="RAM" value={`${(Number(diagnostics.ramTotalMB) / 1024).toFixed(1)} GB`} />
          <DiagRow label="OS" value={diagnostics.osVersion as string} />

          {/* Whisper Version */}
          <SectionHeader label="Whisper" />
          <DiagRow label="Version" value={diagnostics.whisperVersion as string} />

          {/* Model Compatibility */}
          {diagnostics.modelCompatibility
            ? (() => {
                interface MC {
                  activeModel: string
                  primaryOk: boolean
                  fallbackLevel: number
                  triedModels: Array<{ file: string; ok: boolean; exitCode: number | null; error?: string; errorType?: string }>
                }
                const mc: MC = diagnostics.modelCompatibility as MC
                return (
                  <>
                    <SectionHeader label="Model Compatibility" />
                    <DiagRow label="Active Model" value={mc.activeModel} />
                    <DiagRow label="Primary OK" value={mc.primaryOk} />
                    <DiagRow label="Fallback Level" value={String(mc.fallbackLevel ?? '—')} />
                    {mc.triedModels.length > 0 && (
                      <div className="space-y-0.5 mt-1">
                        <span className="text-[10px] text-gray-500">Tried Models:</span>
                        {mc.triedModels.map((m, i) => (
                          <div key={i} className="flex justify-between text-[10px]">
                            <span className="text-gray-500">{m.file}</span>
                            <span className={
                              m.ok ? 'text-green-400'
                              : m.errorType === 'timeout' ? 'text-yellow-400'
                              : 'text-danger'
                            }>
                              {m.ok ? 'PASS'
                              : m.errorType === 'timeout' ? 'TIMEOUT'
                              : m.errorType === 'crash' ? 'CRASH'
                              : m.errorType === 'not_found' ? 'MISSING'
                              : m.error || 'FAIL'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()
            : null}

          {/* Live Diagnostic Tests */}
          <SectionHeader label="Live Tests" />
          <div className="space-y-1">
            <button
              className="btn btn-secondary w-full text-xs py-1"
              onClick={handleRunDiagnosticTests}
              disabled={runningTests}
            >
              {runningTests ? 'Running tests...' : 'Run Binary Test · Run Model Test'}
            </button>
            {diagnosticTests && (
              <div className="space-y-0.5 mt-1">
                <TestResultRow label="Binary Help" result={diagnosticTests.binaryHelp as Record<string, unknown> | undefined} />
                <TestResultRow label="Model Load" result={diagnosticTests.modelLoad as Record<string, unknown> | undefined} />
                <TestResultRow label="Audio Process" result={diagnosticTests.audioProcess as Record<string, unknown> | undefined} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* SRT Import */}
      {showImport && (
        <div className="space-y-2">
          <textarea
            value={srtInput}
            onChange={(e) => setSrtInput(e.target.value)}
            placeholder="Paste SRT content here..."
            className="input w-full h-24 text-xs resize-none"
          />
          <label className="flex items-center gap-2 text-[11px] text-gray-400">
            <span className="shrink-0">Caption lane</span>
            <select
              value={srtLane ?? srtDefaultLane}
              onChange={(e) => setSrtLane(Number(e.target.value))}
              className="input flex-1 text-xs"
            >
              {srtExistingLanes.map((lane) => (
                <option key={lane} value={lane}>
                  {lane === 0 ? 'Captions' : `Captions ${lane + 1}`} (lane {lane})
                </option>
              ))}
              <option value={srtDefaultLane}>
                {srtDefaultLane === 0 ? 'Captions' : `Captions ${srtDefaultLane + 1}`} (new lane)
              </option>
            </select>
          </label>
          <button className="btn btn-primary w-full text-xs" onClick={handleImportSRT}>
            Import SRT
          </button>
        </div>
      )}

      {/* Caption entries list */}
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {entries.map((entry, idx) => (
          <div
            key={entry.id}
            className={`p-2 rounded border transition-colors ${
              selectedId === entry.id
                ? 'bg-accent/20 border-accent/40'
                : 'bg-editor-surface hover:bg-editor-hover border-transparent'
            }`}
            onContextMenu={(e) => {
              e.preventDefault()
              const ph = useTimeline.getState().playheadMs
              setCtxMenu({
                x: e.clientX, y: e.clientY,
                items: [
                  { label: 'Edit Text', onClick: () => selectEntry(entry.id) },
                  { divider: true },
                  { label: 'Duplicate', onClick: () => useCaption.getState().duplicateEntry(entry.id) },
                  { label: 'Split at Playhead', disabled: !(ph > entry.startMs && ph < entry.endMs), onClick: () => {
                    useCaption.getState().splitEntry(entry.id, ph)
                  }},
                  { label: 'Merge with Next', disabled: idx >= entries.length - 1, onClick: () => {
                    useCaption.getState().mergeEntries(entry.id, entries[idx + 1].id)
                  }},
                  { divider: true },
                  { label: 'Delete', danger: true, onClick: () => {
                    useConfirm.getState().show({
                      title: 'Delete Caption',
                      message: `Delete caption "${entry.text.slice(0, 40)}${entry.text.length > 40 ? '…' : ''}"?`,
                      variant: 'danger',
                      confirmLabel: 'Delete'
                    }).then((c) => { if (c) deleteEntry(entry.id) })
                  }}
                ]
              })
            }}
            onClick={() => selectEntry(entry.id)}
          >
            {/* Timing row */}
            <div className="flex items-center justify-between mb-1 gap-1">
              {editingTimingId === entry.id ? (
                <div className="flex items-center gap-1 flex-1">
                  <input
                    type="number"
                    defaultValue={entry.startMs}
                    className="input w-20 text-[10px] p-0.5"
                    onBlur={(e) => setEntryTiming(entry.id, parseInt(e.target.value), entry.endMs)}
                  />
                  <span className="text-gray-600 text-[10px]">→</span>
                  <input
                    type="number"
                    defaultValue={entry.endMs}
                    className="input w-20 text-[10px] p-0.5"
                    onBlur={(e) => {
                      setEntryTiming(entry.id, entry.startMs, parseInt(e.target.value))
                      setEditingTimingId(null)
                    }}
                  />
                </div>
              ) : (
                <span
                  className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-300"
                  onClick={(e) => { e.stopPropagation(); setEditingTimingId(entry.id) }}
                  title="Click to edit timing"
                >
                  {formatTime(entry.startMs)} – {formatTime(entry.endMs)}
                </span>
              )}
              <div className="flex gap-1 shrink-0">
                <button
                  className="text-[10px] text-gray-600 hover:text-accent transition-colors px-1"
                  onClick={(e) => { e.stopPropagation(); handleSplit(entry.id) }}
                  title="Split at playhead or midpoint"
                >
                  Split
                </button>
                {idx < entries.length - 1 && (
                  <button
                    className="text-[10px] text-gray-600 hover:text-accent transition-colors px-1"
                    onClick={(e) => { e.stopPropagation(); handleMerge(entry.id) }}
                    title="Merge with next caption"
                  >
                    Merge
                  </button>
                )}
                <button
                  className="text-[10px] text-gray-600 hover:text-danger transition-colors px-1"
                  onClick={(e) => { e.stopPropagation(); deleteEntry(entry.id) }}
                >
                  Del
                </button>
              </div>
            </div>

            {/* Text content */}
            {selectedId === entry.id ? (
              <textarea
                value={entry.text}
                onChange={(e) => editEntry(entry.id, e.target.value)}
                onKeyDown={(e) => handleCaptionKeyDown(e, entry.id)}
                className="input w-full text-xs resize-none bg-transparent border-0 p-0"
                rows={2}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <p className="text-xs text-gray-300 line-clamp-2">{entry.text}</p>
            )}
          </div>
        ))}
      </div>

      {/* Empty state */}
      {entries.length === 0 && status === 'idle' && !error && (() => {
        const clipCount = useTimeline.getState().clips.length
        if (clipCount === 0) {
          return (
            <div className="text-center py-6 text-gray-600 text-xs space-y-2">
              <svg className="w-8 h-8 mx-auto opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p className="font-medium text-gray-500">Import a video to get started</p>
              <p>Add a clip to the timeline, then click Transcribe</p>
            </div>
          )
        }
        return (
          <div className="text-center py-6 text-gray-600 text-xs space-y-2">
            <svg className="w-8 h-8 mx-auto opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <p className="font-medium text-gray-500">No captions yet</p>
            <p>Click Transcribe Audio to generate captions from your timeline clip</p>
          </div>
        )
      })()}

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          items={ctxMenu.items}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}

export default CaptionEditor
