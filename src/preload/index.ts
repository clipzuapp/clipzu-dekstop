import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload script - Exposes safe IPC bridge to renderer process
 * Context isolation is enabled - renderer cannot access Node.js directly
 */

const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
      const validChannels = [
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
        'export:start',
        'export:cancel',
        'export:getJobs',
        'export:clearCompleted',
        'project:save',
        'project:load',
        'project:exportSRT',
        'project:createTempSRT',
        'project:createTempASS',
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
      const validChannels = [
        'export:progress',
        'whisper:progress',
        'startup:validation',
        'proxy:progress'
      ]
      if (validChannels.includes(channel)) {
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
      ipcRenderer.removeAllListeners(channel)
    }
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
