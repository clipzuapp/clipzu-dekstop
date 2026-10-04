import { dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { existsSync } from 'fs'
import {
  MEDIA_RUNTIME_CANCEL_CHANNEL,
  MEDIA_RUNTIME_DOWNLOAD_CHANNEL,
  MEDIA_RUNTIME_GET_STATUS_CHANNEL,
  MEDIA_RUNTIME_INSTALL_LOCAL_CHANNEL,
  MEDIA_RUNTIME_PROGRESS_CHANNEL,
} from '../../shared/ipc/channels'
import { MEDIA_RUNTIME_VERSION } from '../../shared/modelCatalog'
import type { ModelDeliveryResult, ModelDeliveryStatus } from '../../shared/modelCatalog'
import { downloadAndInstallMediaRuntime, hasMediaRuntime, installMediaRuntimeArchive, validateInstalledMediaRuntime } from '../services/MediaRuntimeInstaller'
import { writeDiagnostic } from '../services/DiagnosticLog'

export function registerMediaRuntimeHandler(
  getWindow: () => BrowserWindow | null,
  userDataPath: string,
  isPackaged: boolean,
  onReady: () => void,
  onInvalid: () => void,
): void {
  let controller: AbortController | null = null
  const initialReady = isPackaged ? hasMediaRuntime(userDataPath) : false
  let status: ModelDeliveryStatus = {
    phase: initialReady ? 'ready' : 'missing',
    receivedBytes: 0,
    totalBytes: 0,
    percent: initialReady ? 100 : 0,
  }

  const publish = (next: ModelDeliveryStatus): void => {
    status = next
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(MEDIA_RUNTIME_PROGRESS_CHANNEL, status)
  }

  if (initialReady) {
    void validateInstalledMediaRuntime(userDataPath).catch((err: unknown) => {
      onInvalid()
      publish({
        phase: 'error',
        receivedBytes: 0,
        totalBytes: 0,
        percent: null,
        error: `The installed FFmpeg runtime is damaged or incomplete. Reinstall it. ${err instanceof Error ? err.message : ''}`.trim(),
      })
    })
  }

  const install = async (archivePath?: string): Promise<ModelDeliveryResult> => {
    if (controller) return { ok: false, status: { ...status, error: 'An FFmpeg runtime installation is already running.' } }
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      return { ok: false, status: { ...status, phase: 'error', error: 'The pinned media runtime is currently available for Windows x64.' } }
    }
    controller = new AbortController()
    publish({ phase: 'downloading', receivedBytes: 0, totalBytes: 0, percent: null })
    try {
      const progress = (value: { phase: 'downloading' | 'verifying'; receivedBytes: number; totalBytes: number; percent: number | null }): void => {
        publish({ ...value })
      }
      if (archivePath) {
        await installMediaRuntimeArchive({ userDataPath, archivePath, signal: controller.signal, onProgress: progress })
      } else {
        await downloadAndInstallMediaRuntime({ userDataPath, signal: controller.signal, onProgress: progress })
      }
      const ready: ModelDeliveryStatus = { phase: 'ready', receivedBytes: status.receivedBytes, totalBytes: status.totalBytes, percent: 100 }
      publish(ready)
      onReady()
      writeDiagnostic('INFO', 'media-runtime.installed', `Pinned FFmpeg ${MEDIA_RUNTIME_VERSION} installed to the per-user runtime directory.`)
      return { ok: true, status: ready }
    } catch (err) {
      const cancelled = controller.signal.aborted
      const message = err instanceof Error ? err.message : 'Unknown FFmpeg installation failure.'
      writeDiagnostic('ERROR', 'media-runtime.install.failed', message)
      const failed: ModelDeliveryStatus = {
        phase: cancelled ? 'missing' : 'error',
        receivedBytes: status.receivedBytes,
        totalBytes: status.totalBytes,
        percent: null,
        error: cancelled ? 'Installation cancelled. You can resume or install from a local archive.' : message,
      }
      publish(failed)
      return { ok: false, status: failed }
    } finally {
      controller = null
    }
  }

  ipcMain.handle(MEDIA_RUNTIME_GET_STATUS_CHANNEL, () => status)
  ipcMain.handle(MEDIA_RUNTIME_CANCEL_CHANNEL, () => {
    if (!controller) return { cancelled: false }
    controller.abort()
    return { cancelled: true }
  })
  ipcMain.handle(MEDIA_RUNTIME_DOWNLOAD_CHANNEL, () => install())
  ipcMain.handle(MEDIA_RUNTIME_INSTALL_LOCAL_CHANNEL, async (): Promise<ModelDeliveryResult> => {
    const win = getWindow()
    const options: OpenDialogOptions = {
      title: 'Install the pinned FFmpeg 8.1.2 archive',
      properties: ['openFile'],
      filters: [{ name: 'FFmpeg ZIP archive', extensions: ['zip'] }],
    }
    const selection = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths[0]) return { ok: false, status }
    const archivePath = selection.filePaths[0]
    if (!existsSync(archivePath)) {
      return { ok: false, status: { ...status, phase: 'error', error: 'The selected archive could not be read.' } }
    }
    // The archive path crosses an IPC boundary only via this native picker;
    // the installer still validates its exact pinned SHA-256 before extraction.
    return install(archivePath)
  })
}
