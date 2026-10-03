import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { CaptionStyle } from '../../shared/types/caption'
import type { CanonicalExportConfig } from '../../shared/project/projectSchema'

const EXPORT_PRESETS = {
  'tiktok-reels': { label: '9:16 — TikTok / Reels', width: 1080, height: 1920 },
  'youtube': { label: '16:9 — YouTube', width: 1920, height: 1080 },
  'instagram-post': { label: '1:1 — Instagram post', width: 1080, height: 1080 },
  'instagram-port': { label: '4:5 — IG portrait', width: 1080, height: 1350 },
  '4k-vertical': { label: '9:16 4K (upscale)', width: 2160, height: 3840, requiresUpscale: true },
  '4k-horizontal': { label: '16:9 4K (upscale)', width: 3840, height: 2160, requiresUpscale: true },
  'prores': { label: 'ProRes 422 master', width: 1920, height: 1080, codec: 'prores' },
  'webm': { label: 'WebM / VP9', width: 1920, height: 1080, codec: 'vp9' },
  'custom': { label: 'Custom', width: 0, height: 0 }
} as const

type PresetKey = keyof typeof EXPORT_PRESETS

interface ExportJob {
  id: string
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'error'
  progress: number
  outputPath: string
  error?: string
  createdAt: number
  completedAt?: number
}

export interface ExportState {
  preset: PresetKey
  customWidth: number
  customHeight: number
  queue: ExportJob[]
  upscaleEnabled: boolean
  upscaleAlgorithm: 'lanczos' | 'bicubic'
  codec: 'h264' | 'h265' | 'prores' | 'vp9'
  qualityPreset: 'fast' | 'slow'
  isExporting: boolean
  /** Bitrate in kbps. null = auto (codec default). */
  bitrateKbps: number | null
  /** Bitrate mode: auto lets codec decide, cbr = constant, vbr = variable. */
  bitrateMode: 'auto' | 'cbr' | 'vbr'
  /** Custom frame range for export. null = full timeline. */
  exportFrameRange: { startMs: number; endMs: number } | null
  /** When true, export audio only (no video stream). */
  audioOnly: boolean
  /** Output frame rate. */
  fps: 24 | 30 | 60
  /** Enable hardware-accelerated encoding when available. */
  hardwareAccel: boolean
}

interface ExportActions {
  setPreset: (preset: PresetKey) => void
  setCustomResolution: (width: number, height: number) => void
  setUpscaleEnabled: (enabled: boolean) => void
  setUpscaleAlgorithm: (algorithm: 'lanczos' | 'bicubic') => void
  setCodec: (codec: 'h264' | 'h265' | 'prores' | 'vp9') => void
  setQualityPreset: (preset: 'fast' | 'slow') => void
  setBitrate: (kbps: number | null) => void
  setBitrateMode: (mode: 'auto' | 'cbr' | 'vbr') => void
  setExportFrameRange: (range: { startMs: number; endMs: number } | null) => void
  setAudioOnly: (enabled: boolean) => void
  setFps: (fps: 24 | 30 | 60) => void
  setHardwareAccel: (enabled: boolean) => void
  startExport: (params: {
    clipPaths: string[]
    clipTrackIndices: number[]
    clipHasAudio?: boolean[]
    /** P4.4 still-image loop flags parallel to clipPaths. */
    clipIsStill?: boolean[]
    clipHidden?: boolean[]
    clipVideoMuted?: boolean[]
    clipFadeInMs?: number[]
    clipFadeOutMs?: number[]
    clipTransforms: Array<{ x: number; y: number; scaleX: number; scaleY: number; rotation: number; opacity: number; cropTop: number; cropBottom: number; cropLeft: number; cropRight: number } | null>
    clipVolumes: Array<{ volume: number; muted: boolean }>
    clipStartMs?: number[]
    clipDurationMs?: number[]
    clipTrimStarts?: number[]
    clipSpeeds?: number[]
    // Phase 7: shared export graph output (buildExportGraph). Optional so
    // older/test callers keep compiling; always sent by ExportDialog.
    clipVideoFilters?: string[][]
    clipVideoAnimated?: Array<Array<{ filter: string; startMs: number; endMs: number }>>
    clipAnimatedOpacity?: Array<Array<{ startMs: number; endMs: number; value: number }>>
    clipAnimatedVolume?: Array<Array<{ startMs: number; endMs: number; value: number }>>
    clipBlends?: (string | null)[]
    clipTransitionFadeInMs?: number[]
    clipTransitionFadeOutMs?: number[]
    clipSlideOut?: Array<{ axis: 'x' | 'y'; fromFrac: number; toFrac: number; startMs: number; endMs: number } | null>
    clipSlideIn?: Array<{ axis: 'x' | 'y'; fromFrac: number; toFrac: number; startMs: number; endMs: number } | null>
    clipZoomOut?: Array<{ fromScale: number; toScale: number; startMs: number; endMs: number } | null>
    clipZoomIn?: Array<{ fromScale: number; toScale: number; startMs: number; endMs: number } | null>
    audioAnimatedVolume?: Array<Array<{ startMs: number; endMs: number; value: number }>>
    useNvenc?: boolean
    audioTracks: Array<{ path: string; startMs: number; volume: number; trimStart?: number; durationMs?: number; fadeInMs?: number; fadeOutMs?: number }>
    srtPath: string | null
    captionStyle: CaptionStyle | null
    outputPath: string
    totalDurationMs: number
    projectWidth: number
    projectHeight: number
    fps: 24 | 30 | 60
  }) => Promise<void>
  cancelExport: (jobId: string) => Promise<void>
  clearQueue: () => void
  /**
   * Reset transient export session (project load boundary): drops queued jobs
   * and any stuck exporting flag. Queue entries reference the previous
   * project's outputs — carrying them over would be stale state.
   */
  resetExportSession: () => void
  /**
   * Restore full export configuration from a validated .clipzu document.
   * Config only — queue/isExporting are session state, never restored.
   */
  loadExportConfig: (config: CanonicalExportConfig) => void
  updateProgress: (jobId: string, progress: number) => void
  setJobStatus: (jobId: string, status: ExportJob['status'], error?: string) => void
  getOutputDimensions: () => { width: number; height: number }
}

const initialState: ExportState = {
  preset: 'tiktok-reels',
  customWidth: 1920,
  customHeight: 1080,
  queue: [],
  upscaleEnabled: false,
  upscaleAlgorithm: 'lanczos',
  codec: 'h264',
  qualityPreset: 'slow',
  isExporting: false,
  bitrateKbps: null,
  bitrateMode: 'auto',
  exportFrameRange: null,
  audioOnly: false,
  fps: 30,
  hardwareAccel: false,
}

export const useExport = create<ExportState & ExportActions>()(
  immer((set, get) => ({
    ...initialState,

    setPreset: (preset) =>
      set((state) => {
        state.preset = preset
      }),

    setCustomResolution: (width, height) =>
      set((state) => {
        state.customWidth = width
        state.customHeight = height
      }),

    setUpscaleEnabled: (enabled) =>
      set((state) => {
        state.upscaleEnabled = enabled
      }),

    setUpscaleAlgorithm: (algorithm) =>
      set((state) => {
        state.upscaleAlgorithm = algorithm
      }),

    setCodec: (codec) =>
      set((state) => {
        state.codec = codec
      }),

    setQualityPreset: (preset) =>
      set((state) => {
        state.qualityPreset = preset
      }),

    setBitrate: (kbps) =>
      set((state) => {
        state.bitrateKbps = kbps
      }),

    setBitrateMode: (mode) =>
      set((state) => {
        state.bitrateMode = mode
      }),

    setExportFrameRange: (range) =>
      set((state) => {
        state.exportFrameRange = range
      }),

    setAudioOnly: (enabled) =>
      set((state) => {
        state.audioOnly = enabled
      }),

    setFps: (fps) =>
      set((state) => {
        state.fps = fps
      }),

    setHardwareAccel: (enabled) =>
      set((state) => {
        state.hardwareAccel = enabled
      }),

    startExport: async (params) => {
      const state = get()
      const dims = state.getOutputDimensions()

      try {
        set((s) => {
          s.isExporting = true
        })

        const job = await window.electron.ipcRenderer.invoke('export:start', {
          ...params,
          outputWidth: dims.width,
          outputHeight: dims.height,
          codec: state.codec,
          qualityPreset: state.qualityPreset,
          upscaleEnabled: state.upscaleEnabled,
          upscaleAlgorithm: state.upscaleAlgorithm,
          bitrateKbps: state.bitrateKbps,
          bitrateMode: state.bitrateMode,
          exportFrameRange: state.exportFrameRange,
          audioOnly: state.audioOnly,
          fps: state.fps,
          hardwareAccel: state.hardwareAccel
        })

        set((s) => {
          s.queue.push(job)
        })
      } catch (err) {
        set((s) => {
          s.isExporting = false
        })
        throw err
      }
    },

    cancelExport: async (jobId) => {
      await window.electron.ipcRenderer.invoke('export:cancel', jobId)
    },

    clearQueue: () =>
      set((state) => {
        state.queue = state.queue.filter((j) => j.status === 'running' || j.status === 'pending')
      }),

    resetExportSession: () =>
      set((state) => {
        state.queue = []
        state.isExporting = false
      }),

    loadExportConfig: (config) =>
      set((state) => {
        state.preset = config.preset
        state.customWidth = config.customWidth
        state.customHeight = config.customHeight
        state.upscaleEnabled = config.upscaleEnabled
        state.upscaleAlgorithm = config.upscaleAlgorithm
        state.codec = config.codec
        state.qualityPreset = config.qualityPreset
        state.bitrateKbps = config.bitrateKbps
        state.bitrateMode = config.bitrateMode
        state.exportFrameRange = config.exportFrameRange
          ? { ...config.exportFrameRange }
          : null
        state.audioOnly = config.audioOnly
        state.fps = config.fps
        state.hardwareAccel = config.hardwareAccel
      }),

    updateProgress: (jobId, progress) =>
      set((state) => {
        const job = state.queue.find((j) => j.id === jobId)
        if (job) {
          job.progress = progress
        }
      }),

    setJobStatus: (jobId, status, error) =>
      set((state) => {
        const job = state.queue.find((j) => j.id === jobId)
        if (job) {
          job.status = status
          if (error) job.error = error
          if (status === 'completed' || status === 'cancelled' || status === 'error') {
            state.isExporting = false
          }
        }
      }),

    getOutputDimensions: () => {
      const state = get()
      if (state.preset === 'custom') {
        return { width: state.customWidth, height: state.customHeight }
      }
      const preset = EXPORT_PRESETS[state.preset]
      return { width: preset.width, height: preset.height }
    }
  }))
)

export { EXPORT_PRESETS }
export type { PresetKey, ExportJob }
