import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerFFmpegHandler } from './ipc/ffmpeg.handler'
import { registerWhisperHandler } from './ipc/whisper.handler'
import { registerExportHandler } from './ipc/export.handler'
import { registerProjectHandler } from './ipc/project.handler'
import { registerSFXHandler } from './ipc/sfx.handler'
import { FFmpegService } from './services/FFmpegService'
import { WhisperService, type ModelCompatibilityInfo } from './services/WhisperService'
import { ThumbnailService } from './services/ThumbnailService'
import { ExportQueueManager } from './services/ExportQueue'

interface StartupValidation {
  ffmpeg: boolean
  ffprobe: boolean
  whisperCli: boolean
  model: boolean
  vcRuntime: boolean
  /** Human-readable warning when the model is incompatible */
  modelWarning?: string
  /** Detailed model compatibility info for diagnostics */
  modelCompatibility?: ModelCompatibilityInfo
}

/** Validate all required binaries and assets before the renderer renders */
function validateStartupDeps(ffmpegPath: string, ffprobePath: string, modelPath: string): StartupValidation {
  const binDir = app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin')
  const whisperCliPath = join(binDir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')

  return {
    ffmpeg: existsSync(ffmpegPath),
    ffprobe: existsSync(ffprobePath),
    whisperCli: existsSync(whisperCliPath),
    model: existsSync(modelPath),
    vcRuntime: process.platform === 'win32'
      ? existsSync('C:\\Windows\\System32\\msvcp140.dll')
      : true
  }
}

let mainWindow: BrowserWindow | null = null

/** Resolve FFmpeg binary path based on build mode */
function resolveFFmpegPath(): string {
  const platform = process.platform
  const isPackaged = app.isPackaged

  if (isPackaged) {
    const resourcesPath = join(process.resourcesPath, 'bin')
    return platform === 'win32' ? join(resourcesPath, 'ffmpeg.exe') : join(resourcesPath, 'ffmpeg')
  }

  // Development: use npm-installed ffmpeg-static
  try {
    return require('ffmpeg-static')
  } catch {
    return platform === 'win32'
      ? join(app.getAppPath(), 'resources', 'bin', 'ffmpeg.exe')
      : join(app.getAppPath(), 'resources', 'bin', 'ffmpeg')
  }
}

/** Resolve ffprobe binary path */
function resolveFFprobePath(): string {
  const ffmpegPath = resolveFFmpegPath()

  if (!app.isPackaged) {
    try {
      const ffprobeStatic = require('ffprobe-static')
      return ffprobeStatic.path
    } catch {
      // Fallback to sibling of ffmpeg
    }
  }

  return ffmpegPath.replace('ffmpeg', 'ffprobe')
}

/** Resolve Whisper model path */
function resolveModelPath(): string {
  const isPackaged = app.isPackaged
  if (isPackaged) {
    return join(process.resourcesPath, 'models', 'ggml-small.bin')
  }
  return join(app.getAppPath(), 'models', 'ggml-small.bin')
}

let thumbnailService: ThumbnailService | null = null
let whisperService: WhisperService | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0d0d10',
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? false : true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !is.dev
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // In dev mode, clear accumulated cookies to prevent Vite 431 errors
  // (request header fields too large from persistent cookie jar)
  if (is.dev) {
    mainWindow.webContents.session.clearStorageData({ storages: ['cookies'] })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.capcraft.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // Resolve tool paths
  const ffmpegPath = resolveFFmpegPath()
  const ffprobePath = resolveFFprobePath()
  const modelPath = resolveModelPath()

  // Create service instances (OOP DI)
  const ffmpeg = new FFmpegService(ffmpegPath, ffprobePath)
  const whisper = new WhisperService(modelPath, ffmpeg)
  whisperService = whisper
  const thumbnails = new ThumbnailService(
    join(app.getPath('userData'), 'thumbnails.db'),
    ffmpeg
  )
  thumbnailService = thumbnails

  const getWindow = (): BrowserWindow | null => mainWindow
  const exportQueue = new ExportQueueManager(getWindow, ffmpeg)

  // Register all IPC handlers with service instances
  registerFFmpegHandler(getWindow, ffmpeg, thumbnails)
  registerWhisperHandler(getWindow, whisper, ffmpeg)
  registerExportHandler(exportQueue)
  registerProjectHandler(getWindow)
  registerSFXHandler()

  // Push startup validation result to renderer after it loads
  const validation = validateStartupDeps(ffmpegPath, ffprobePath, modelPath)

  // Fast model check: file-existence + GGML header read (instant, no spawn).
  // Wrapped in try/catch so a validation failure can NEVER abort startup.
  // NOTE: _startupValidated is NOT set here â€” async validation below is the
  // single source of truth, unless persistent cache says we can skip it.
  try {
    whisper.resolveModelPath(true)
  } catch (err) {
    console.error('[startup] Model fast-resolution threw (continuing):', (err as Error).message)
  }
  const modelInfo = whisper.getLastValidation()
  if (modelInfo) {
    validation.modelCompatibility = modelInfo
    validation.model = modelInfo.fallbackLevel >= 0 || modelInfo.primaryOk
    if (modelInfo.fallbackLevel < 0 && modelInfo.triedModels.length > 0) {
      validation.modelWarning = 'Installed model is incompatible with this whisper build.'
    } else if (!modelInfo.primaryOk && modelInfo.fallbackLevel >= 0) {
      validation.modelWarning = `Using fallback model: ${modelInfo.activeModel}`
    }
  }

  // Send initial validation immediately (fast-check results)
  mainWindow?.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.send('startup:validation', validation)

    // ---- Persistent cache gate: skip async validation if cache is valid ----
    const cliPath = join(
      app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'resources', 'bin'),
      process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
    )
    const pkg = require(join(app.getAppPath(), 'package.json'))
    const appVersion = pkg.version || '1.0.0'

    if (WhisperService.isPersistentCacheValid(cliPath, modelPath, appVersion)) {
      // Cache is valid â€” skip all validation, mark immediately
      console.log('[startup] Persistent cache valid â€” skipping async model validation')
      whisper.markStartupValidated()
    } else {
      // Fire async full model validation (non-blocking)
      whisper.resolveModelPathAsync().then(() => {
        whisper.markStartupValidated()
        const updatedInfo = whisper.getLastValidation()
        if (updatedInfo && mainWindow && !mainWindow.isDestroyed()) {
          validation.modelCompatibility = updatedInfo
          validation.model = updatedInfo.fallbackLevel >= 0 || updatedInfo.primaryOk
          if (updatedInfo.fallbackLevel < 0 && updatedInfo.triedModels.length > 0) {
            validation.modelWarning = 'Installed model is incompatible with this whisper build.'
          } else if (!updatedInfo.primaryOk && updatedInfo.fallbackLevel >= 0) {
            validation.modelWarning = `Using fallback model: ${updatedInfo.activeModel}`
          } else {
            validation.modelWarning = undefined
          }
          mainWindow.webContents.send('startup:validation', validation)
        }
      }).catch((err) => {
        console.error('[startup] Async model validation failed:', (err as Error).message)
      })
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Kill any active transcription/extraction processes to prevent zombies
  if (whisperService) {
    whisperService.cancel()
  }
  if (thumbnailService) {
    thumbnailService.close()
  }
})

// Defensive second pass - child_process.kill() is idempotent, safe to call twice
app.on('will-quit', () => {
  whisperService?.cancel()
  whisperService = null
  thumbnailService?.close()
  thumbnailService = null
  mainWindow = null
})

export { mainWindow }
