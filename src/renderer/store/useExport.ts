import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

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

interface ExportState {
  preset: PresetKey
  customWidth: number
  customHeight: number
  queue: ExportJob[]
  upscaleEnabled: boolean
  upscaleAlgorithm: 'lanczos' | 'bicubic'
  codec: 'h264' | 'h265' | 'prores' | 'vp9'
  qualityPreset: 'fast' | 'slow'
  isExporting: boolean
}

interface ExportActions {
  setPreset: (preset: PresetKey) => void
  setCustomResolution: (width: number, height: number) => void
  setUpscaleEnabled: (enabled: boolean) => void
  setUpscaleAlgorithm: (algorithm: 'lanczos' | 'bicubic') => void
  setCodec: (codec: 'h264' | 'h265' | 'prores' | 'vp9') => void
  setQualityPreset: (preset: 'fast' | 'slow') => void
  startExport: (params: {
    clipPaths: string[]
    clipTrackIndices: number[]
    clipHasAudio?: boolean[]
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
    audioTracks: Array<{ path: string; startMs: number; volume: number; trimStart?: number; durationMs?: number; fadeInMs?: number; fadeOutMs?: number }>
    srtPath: string | null
    captionStyle: {
      fontFamily: string
      fontSize: number
      fontWeight: number
      fontColor: string
      bgColor: string
      bgOpacity: number
      strokeColor: string
      strokeWidth: number
      x: number
      y: number
      alignment: 'left' | 'center' | 'right'
      position: 'top' | 'center' | 'bottom'
      scale?: number
      captionMode?: 'full-phrase' | 'word-reveal' | 'karaoke' | 'single-word'
      animation?: 'none' | 'pop' | 'fade' | 'slide-up' | 'karaoke' | 'typewriter'
      revealFadeMs?: number
    } | null
    outputPath: string
    totalDurationMs: number
    projectWidth: number
    projectHeight: number
    fps: 24 | 30 | 60
  }) => Promise<void>
  cancelExport: (jobId: string) => Promise<void>
  clearQueue: () => void
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
  isExporting: false
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
          upscaleAlgorithm: state.upscaleAlgorithm
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
