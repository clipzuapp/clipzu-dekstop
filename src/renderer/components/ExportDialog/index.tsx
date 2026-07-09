import { useShallow } from 'zustand/react/shallow'
import { useExport, EXPORT_PRESETS } from '../../store/useExport'
import type { PresetKey } from '../../store/useExport'
import { useTimeline, DEFAULT_TRANSFORM, computeEffectiveMuted, computeEffectiveVideoHidden, computeEffectiveVideoMuted, type TimelineState } from '../../store/useTimeline'
import { useProject } from '../../store/useProject'
import { useCaption } from '../../store/useCaption'
import { useToast } from '../../store/useToast'
import { formatDuration } from '../../utils/format'


/**
 * ExportDialog - Modal for export configuration and queue management
 */
export function ExportDialog({ onClose, show = true }: { onClose: () => void; show?: boolean }): JSX.Element {
  const {
    preset, setPreset,
    upscaleEnabled, setUpscaleEnabled,
    upscaleAlgorithm, setUpscaleAlgorithm,
    codec, setCodec,
    qualityPreset, setQualityPreset,
    bitrateKbps, setBitrate,
    bitrateMode, setBitrateMode,
    exportFrameRange, setExportFrameRange,
    audioOnly, setAudioOnly,
    fps, setFps,
    hardwareAccel, setHardwareAccel,
    queue, startExport, cancelExport, clearQueue
  } = useExport(useShallow((s) => ({
    preset: s.preset,
    setPreset: s.setPreset,
    upscaleEnabled: s.upscaleEnabled,
    setUpscaleEnabled: s.setUpscaleEnabled,
    upscaleAlgorithm: s.upscaleAlgorithm,
    setUpscaleAlgorithm: s.setUpscaleAlgorithm,
    codec: s.codec,
    setCodec: s.setCodec,
    qualityPreset: s.qualityPreset,
    setQualityPreset: s.setQualityPreset,
    bitrateKbps: s.bitrateKbps,
    setBitrate: s.setBitrate,
    bitrateMode: s.bitrateMode,
    setBitrateMode: s.setBitrateMode,
    exportFrameRange: s.exportFrameRange,
    setExportFrameRange: s.setExportFrameRange,
    audioOnly: s.audioOnly,
    setAudioOnly: s.setAudioOnly,
    fps: s.fps,
    setFps: s.setFps,
    hardwareAccel: s.hardwareAccel,
    setHardwareAccel: s.setHardwareAccel,
    queue: s.queue,
    startExport: s.startExport,
    cancelExport: s.cancelExport,
    clearQueue: s.clearQueue
  })))

  const { clips, audioTracks, textClips, totalDurationMs, tracks } = useTimeline(useShallow((s: TimelineState) => ({
    clips: s.clips,
    audioTracks: s.audioTracks,
    textClips: s.textClips,
    totalDurationMs: s.totalDurationMs,
    tracks: s.tracks
  })))

  const projectResolution = useProject((s) => s.resolution)
  const projectFps = useProject((s) => s.fps)
  const captionStyle = useCaption((s) => s.activeStyle)

  // Use store-level isExporting — single source of truth
  const isExporting = useExport((s) => s.isExporting)

  const handleExport = async (): Promise<void> => {
    if (clips.length === 0) {
      useToast.getState().warning('No clips in timeline to export')
      return
    }

    let defaultExt = 'mp4'
    if (codec === 'prores') defaultExt = 'mov'
    else if (codec === 'vp9') defaultExt = 'webm'

    const outputPath = await window.electron.ipcRenderer.invoke(
      'ffmpeg:openSaveDialog',
      `export_${Date.now()}.${defaultExt}`
    )
    if (!outputPath) return

    try {
      // Create temp ASS if captions exist (before starting video export).
      // ASS preserves per-caption style/font contracts; SRT can only carry one global style.
      let srtPath: string | null = null
      if (textClips.length > 0) {
        const dims = useExport.getState().getOutputDimensions()
        const renderWidth = upscaleEnabled ? Math.round(dims.width / 2) : dims.width
        const renderHeight = upscaleEnabled ? Math.round(dims.height / 2) : dims.height
        // fallbackStyle is CaptionStyle — pass it directly, no manual field projection needed
        const fallbackStyle = captionStyle
        srtPath = await window.electron.ipcRenderer.invoke('project:createTempASS', textClips.map((clip) => ({
          startMs: clip.startMs,
          endMs: clip.endMs,
          text: clip.text,
          words: clip.words,
          // Per-clip style is already CaptionStyle — pass through without projection
          style: clip.style ?? undefined
        })), {
          outputWidth: renderWidth,
          outputHeight: renderHeight,
          projectWidth: projectResolution.width,
          projectHeight: projectResolution.height,
          fallbackStyle
        })
      }

      // Start video export (async in main process — returns job immediately)
      await startExport({
        clipPaths: clips.map((c) => c.path),
        clipTrackIndices: clips.map((c) => c.trackIndex),
        clipHasAudio: clips.map((c) => c.hasAudio ?? true),
        // Respect track hidden + solo state — matches what Preview renders
        clipHidden: clips.map((c) => computeEffectiveVideoHidden(c.trackIndex, tracks)),
        // Respect per-clip mute AND video track mute — matches Preview audio behavior
        clipVideoMuted: clips.map((c) => computeEffectiveVideoMuted(c.muted ?? false, c.trackIndex, tracks)),
        clipFadeInMs: clips.map((c) => c.fadeInMs ?? 0),
        clipFadeOutMs: clips.map((c) => c.fadeOutMs ?? 0),
        clipTransforms: clips.map((c) => c.transform ?? DEFAULT_TRANSFORM),
        clipVolumes: clips.map((c) => ({ volume: c.volume ?? 1, muted: c.muted ?? false })),
        clipStartMs: clips.map((c) => c.startMs),
        clipDurationMs: clips.map((c) => c.durationMs),
        clipTrimStarts: clips.map((c) => c.trimStart),
        clipSpeeds: clips.map((c) => c.speed ?? 1),
        audioTracks: audioTracks
          .filter((t) => !computeEffectiveMuted(t.muted, t.trackIndex, tracks))
          .map((t) => ({
            path: t.path,
            startMs: t.startMs,
            volume: t.volume,
            trimStart: t.trimStart ?? 0,
            durationMs: t.durationMs,
            fadeInMs: t.fadeInMs ?? 0,
            fadeOutMs: t.fadeOutMs ?? 0
          })),
        srtPath,
        // captionStyle is CaptionStyle — pass directly
        captionStyle: textClips.length > 0 ? captionStyle : null,
        outputPath,
        totalDurationMs,
        projectWidth: projectResolution.width,
        projectHeight: projectResolution.height,
        fps: projectFps
      })
      // Export SRT sidecar (non-blocking — don't show error since video may still succeed)
      if (textClips.length > 0) {
        window.electron.ipcRenderer.invoke(
          'project:exportSRT',
          textClips,
          outputPath
        ).catch((err) => {
          console.warn('SRT export failed (video export unaffected):', err)
        })
      }

      useToast.getState().info('Export started — encoding in progress')
    } catch (err) {
      console.error('Export failed:', err)
      useToast.getState().error(`Export failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className={`export-drawer${show ? ' open' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-editor-border shrink-0">
          <h2 className="text-lg font-semibold">Export</h2>
          <button className="text-gray-500 hover:text-gray-300 text-lg leading-none" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Preset Picker */}
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Preset</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as PresetKey)}
              style={{
                width: '100%',
                background: 'var(--bg2)',
                color: 'var(--text1)',
                border: '0.5px solid var(--border)',
                borderRadius: '4px',
                padding: '5px 8px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {Object.entries(EXPORT_PRESETS).map(([key, val]) => (
                <option key={key} value={key} style={{ background: '#1e1e24', color: '#e0e0e0' }}>
                  {val.label}
                </option>
              ))}
            </select>
            {preset !== 'custom' && (
              <p className="text-[10px] text-gray-500">
                {EXPORT_PRESETS[preset].width}x{EXPORT_PRESETS[preset].height}
              </p>
            )}
          </div>

          {/* Codec */}
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Codec</label>
            <div className="flex gap-1">
              {(['h264', 'h265', 'prores', 'vp9'] as const).map((c) => (
                <button
                  key={c}
                  className={`btn flex-1 text-xs ${codec === c ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCodec(c)}
                >
                  {c === 'h264' ? 'H.264' : c === 'h265' ? 'H.265' : c === 'prores' ? 'ProRes' : 'VP9'}
                </button>
              ))}
            </div>
          </div>

          {/* Quality */}
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Quality</label>
            <div className="flex gap-1">
              <button
                className={`btn flex-1 text-xs ${qualityPreset === 'fast' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setQualityPreset('fast')}
              >
                Fast (Social)
              </button>
              <button
                className={`btn flex-1 text-xs ${qualityPreset === 'slow' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setQualityPreset('slow')}
              >
                High Quality
              </button>
            </div>
          </div>

          {/* Upscale */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={upscaleEnabled}
                onChange={(e) => setUpscaleEnabled(e.target.checked)}
                className="accent-accent"
              />
              <label className="text-xs text-gray-300">4K Upscale (lanczos, CPU-only)</label>
            </div>
            {upscaleEnabled && (
              <div className="flex gap-1 ml-6">
                <button
                  className={`btn text-xs ${upscaleAlgorithm === 'lanczos' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setUpscaleAlgorithm('lanczos')}
                >
                  Lanczos
                </button>
                <button
                  className={`btn text-xs ${upscaleAlgorithm === 'bicubic' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setUpscaleAlgorithm('bicubic')}
                >
                  Bicubic
                </button>
              </div>
            )}
          </div>

          {/* Bitrate */}
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Bitrate</label>
            <div className="flex gap-1">
              {(['auto', 'cbr', 'vbr'] as const).map((m) => (
                <button
                  key={m}
                  className={`btn flex-1 text-xs ${bitrateMode === m ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setBitrateMode(m)}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            {bitrateMode !== 'auto' && (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  value={bitrateKbps ?? 8000}
                  onChange={(e) => setBitrate(Math.max(500, Number(e.target.value)))}
                  className="w-24 bg-editor-surface border border-editor-border rounded px-2 py-1 text-xs text-white"
                  min={500}
                  step={500}
                />
                <span className="text-[10px] text-gray-500">kbps</span>
              </div>
            )}
          </div>

          {/* FPS */}
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Frame Rate</label>
            <div className="flex gap-1">
              {([24, 30, 60] as const).map((f) => (
                <button
                  key={f}
                  className={`btn flex-1 text-xs ${fps === f ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setFps(f)}
                >
                  {f} fps
                </button>
              ))}
            </div>
          </div>

          {/* Audio Only */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={audioOnly}
                onChange={(e) => setAudioOnly(e.target.checked)}
                className="accent-accent"
              />
              <label className="text-xs text-gray-300">Audio Only (no video)</label>
            </div>
          </div>

          {/* Frame Range */}
          <div className="space-y-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Frame Range</label>
            <div className="flex gap-1">
              <button
                className={`btn flex-1 text-xs ${!exportFrameRange ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setExportFrameRange(null)}
              >
                Full Timeline
              </button>
              <button
                className={`btn flex-1 text-xs ${exportFrameRange ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setExportFrameRange({ startMs: 0, endMs: totalDurationMs })}
              >
                Custom Range
              </button>
            </div>
            {exportFrameRange && (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  value={Math.round(exportFrameRange.startMs / 1000 * 100) / 100}
                  onChange={(e) => setExportFrameRange({ ...exportFrameRange, startMs: Math.max(0, Number(e.target.value) * 1000) })}
                  className="w-20 bg-editor-surface border border-editor-border rounded px-2 py-1 text-xs text-white"
                  min={0}
                  step={0.1}
                />
                <span className="text-[10px] text-gray-500">to</span>
                <input
                  type="number"
                  value={Math.round(exportFrameRange.endMs / 1000 * 100) / 100}
                  onChange={(e) => setExportFrameRange({ ...exportFrameRange, endMs: Math.min(totalDurationMs, Number(e.target.value) * 1000) })}
                  className="w-20 bg-editor-surface border border-editor-border rounded px-2 py-1 text-xs text-white"
                  min={0}
                  step={0.1}
                />
                <span className="text-[10px] text-gray-500">sec</span>
              </div>
            )}
          </div>

          {/* Hardware Acceleration */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hardwareAccel}
                onChange={(e) => setHardwareAccel(e.target.checked)}
                className="accent-accent"
              />
              <label className="text-xs text-gray-300">Hardware Acceleration (NVENC/QSV)</label>
            </div>
          </div>

          {/* Info */}
          <div className="p-2 bg-editor-surface rounded text-xs text-gray-400 space-y-1">
            <p>Clips: {clips.length} | Audio: {audioTracks.length} | Captions: {textClips.length}</p>
            <p>Duration: {formatDuration(totalDurationMs)}</p>
          </div>

          {/* Export Button */}
          <button
            className="btn btn-primary w-full py-2"
            onClick={handleExport}
            disabled={isExporting || clips.length === 0}
          >
            {isExporting ? 'Exporting...' : 'Start Export'}
          </button>

          {/* Queue */}
          {queue.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-gray-300">Queue</h4>
                <button className="text-[10px] text-gray-500 hover:text-gray-300" onClick={clearQueue}>
                  Clear completed
                </button>
              </div>
              {queue.map((job) => (
                <div key={job.id} className="p-2 bg-editor-surface rounded border border-editor-border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-400 truncate">{job.outputPath}</span>
                    <span className={`text-[10px] capitalize ${
                      job.status === 'completed' ? 'text-success' :
                      job.status === 'error' ? 'text-danger' :
                      job.status === 'running' ? 'text-accent' : 'text-gray-500'
                    }`}>
                      {job.status}
                    </span>
                  </div>
                  {job.status === 'running' && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-editor-bg rounded overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500">{Math.round(job.progress)}%</span>
                      <button
                        className="text-[10px] text-danger hover:text-danger-hover"
                        onClick={() => cancelExport(job.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
    </div>
  )
}

export default ExportDialog
