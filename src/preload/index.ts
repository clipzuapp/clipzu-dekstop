import { contextBridge, ipcRenderer } from 'electron'
import { DIAGNOSTICS_EXPORT_CHANNEL, MEDIA_RUNTIME_INVOKE_CHANNELS, MEDIA_RUNTIME_PROGRESS_CHANNEL, MENU_CHANNELS, MODEL_INVOKE_CHANNELS, MODEL_PROGRESS_CHANNEL, PROJECT_CHANNELS } from '../shared/ipc/channels'

/**
 * Preload script - Exposes safe IPC bridge to renderer process
 * Context isolation is enabled - renderer cannot access Node.js directly
 */

/**
 * Renderer-subscribable channels (P6.3): shared by `on` (subscribe) and
 * `removeAllListeners` (unsubscribe) so the two can never drift apart.
 * Must stay in sync with main/index.ts sends — see MENU_CHANNELS.
 */
const SUBSCRIBE_CHANNELS: string[] = [
  ...MENU_CHANNELS,
  'export:progress',
  'whisper:progress',
  'startup:validation',
  'proxy:progress',
  MODEL_PROGRESS_CHANNEL,
  MEDIA_RUNTIME_PROGRESS_CHANNEL
]

const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
      const validChannels: string[] = [
        'ffmpeg:getMediaInfo',
        'ffmpeg:extractFrame',
        'ffmpeg:getThumbnail',
        'ffmpeg:getThumbnailStrip',
        'ffmpeg:clearThumbnailCache',
        'ffmpeg:getCacheStats',
        'ffmpeg:openMediaDialog',
        'ffmpeg:openSaveDialog',
        'ffmpeg:extractAudioFromClip',
        'ffmpeg:mixTimelineAudio',
        'sfx:getLibrary',
        'sfx:openFileLocation',
        'sfx:getNotificationSound',
        'file:readBuffer',
        'whisper:isModelAvailable',
        'whisper:transcribe',
        'whisper:transcribeFromTimeline',
        'whisper:cancel',
        'whisper:getDiagnostics',
        'whisper:runDiagnosticTests',
        'whisper:validateModel',
        DIAGNOSTICS_EXPORT_CHANNEL,
        'export:start',
        'export:cancel',
        'export:getJobs',
        'export:clearCompleted',
        ...PROJECT_CHANNELS,
        ...MODEL_INVOKE_CHANNELS,
        ...MEDIA_RUNTIME_INVOKE_CHANNELS,
        'waveform:readPeaks',
        'waveform:writePeaks',
        'waveform:getCacheDir',
        'proxy:getPath',
        'proxy:exists',
        'proxy:generate',
        'proxy:getDir'
      ]
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args)
      }
      return Promise.reject(new Error(`Invalid channel: ${channel}`))
    },
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void): (() => void) => {
      // Native menu events MUST stay in sync with main/index.ts sends and
      // HotkeyManager subscriptions — all three reference MENU_CHANNELS.
      if (SUBSCRIBE_CHANNELS.includes(channel)) {
        const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
          listener(_event, ...args)
        }
        ipcRenderer.on(channel, subscription)
        return () => {
          ipcRenderer.removeListener(channel, subscription)
        }
      }
      return () => {}
    },
    send: (channel: string, ..._args: unknown[]): void => {
      // No send channels needed currently
      console.warn(`IPC send not allowed for channel: ${channel}`)
    },
    removeAllListeners: (channel: string): void => {
      // P6.3 (audit S3): same allowlist as `on` — listener removal cannot be
      // abused to silence channels outside the bridge contract (self-DoS only
      // before; now not even that).
      if (SUBSCRIBE_CHANNELS.includes(channel)) {
        ipcRenderer.removeAllListeners(channel)
      }
    }
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
