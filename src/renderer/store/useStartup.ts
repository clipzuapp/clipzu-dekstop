import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export interface StartupValidation {
  ffmpeg: boolean
  ffprobe: boolean
  whisperCli: boolean
  model: boolean
  vcRuntime: boolean
  modelWarning?: string
  modelCompatibility?: {
    activeModel: string
    primaryOk: boolean
    fallbackLevel: number
    triedModels: Array<{ file: string; ok: boolean; exitCode: number | null; error?: string; errorType?: string }>
  }
}

interface StartupState {
  validation: StartupValidation | null
  showBanner: boolean
}

interface StartupActions {
  setValidation: (v: StartupValidation) => void
  dismissBanner: () => void
}

export const useStartup = create<StartupState & StartupActions>()(
  immer((set) => ({
    validation: null,
    showBanner: true,

    setValidation: (v) =>
      set((state) => {
        state.validation = v
        // Show banner when something is missing or there's a model warning
        const allGood = v.ffmpeg && v.ffprobe && v.whisperCli && v.model && v.vcRuntime
        state.showBanner = !allGood || !!v.modelWarning
      }),

    dismissBanner: () =>
      set((state) => {
        state.showBanner = false
      })
  }))
)
