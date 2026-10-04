import { ipcMain, type BrowserWindow } from 'electron'
import { join } from 'path'
import { MODEL_CANCEL_CHANNEL, MODEL_DOWNLOAD_CHANNEL, MODEL_GET_STATUS_CHANNEL, MODEL_PROGRESS_CHANNEL } from '../../shared/ipc/channels'
import { BUNDLED_MODEL, type ModelDeliveryResult, type ModelDeliveryStatus } from '../../shared/modelCatalog'
import { downloadModel } from '../services/ModelDownloader'
import { WhisperService } from '../services/WhisperService'
import { writeDiagnostic } from '../services/DiagnosticLog'

function modelPathForUserData(userDataPath: string): string {
  return join(userDataPath, 'models')
}

export function registerModelHandler(
  getWindow: () => BrowserWindow | null,
  whisper: WhisperService,
  userDataPath: string,
): void {
  let controller: AbortController | null = null
  let status: ModelDeliveryStatus = {
    phase: whisper.isModelAvailable() ? 'ready' : 'missing',
    receivedBytes: 0,
    totalBytes: BUNDLED_MODEL.sizeBytes,
    percent: whisper.isModelAvailable() ? 100 : 0,
  }

  const publish = (next: ModelDeliveryStatus): void => {
    status = next
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(MODEL_PROGRESS_CHANNEL, status)
  }

  ipcMain.handle(MODEL_GET_STATUS_CHANNEL, () => status)
  ipcMain.handle(MODEL_CANCEL_CHANNEL, () => {
    if (!controller) return { cancelled: false }
    controller.abort()
    return { cancelled: true }
  })
  ipcMain.handle(MODEL_DOWNLOAD_CHANNEL, async (): Promise<ModelDeliveryResult> => {
    if (controller) {
      return { ok: false, status: { ...status, error: 'A model download is already running.' } }
    }
    controller = new AbortController()
    publish({ phase: 'downloading', receivedBytes: 0, totalBytes: BUNDLED_MODEL.sizeBytes, percent: 0 })
    try {
      const downloaded = await downloadModel({
        spec: BUNDLED_MODEL,
        destDir: modelPathForUserData(userDataPath),
        signal: controller.signal,
        onProgress: (p) => publish({ ...p }),
      })
      whisper.setModelPath(downloaded.path)
      whisper.invalidateModelCache()
      await whisper.resolveModelPathAsync()
      const validation = whisper.getLastValidation()
      if (validation && validation.fallbackLevel < 0) {
        throw new Error('Downloaded model failed Whisper compatibility validation.')
      }
      const ready: ModelDeliveryStatus = {
        phase: 'ready',
        receivedBytes: downloaded.bytes,
        totalBytes: BUNDLED_MODEL.sizeBytes,
        percent: 100,
      }
      publish(ready)
      return { ok: true, status: ready }
    } catch (err) {
      const cancelled = controller.signal.aborted
      const message = err instanceof Error ? err.message : 'Unknown model download failure.'
      writeDiagnostic('ERROR', 'model.download.failed', message)
      const failed: ModelDeliveryStatus = {
        phase: cancelled ? 'missing' : 'error',
        receivedBytes: status.receivedBytes,
        totalBytes: BUNDLED_MODEL.sizeBytes,
        percent: null,
        error: cancelled ? 'Download cancelled. You can resume it later.' : message,
      }
      publish(failed)
      return { ok: false, status: failed }
    } finally {
      controller = null
    }
  })
}
