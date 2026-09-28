import { app, BrowserWindow, shell, Menu, dialog } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerFFmpegHandler } from './ipc/ffmpeg.handler'
import { registerWhisperHandler } from './ipc/whisper.handler'
import { registerExportHandler } from './ipc/export.handler'
import { registerProjectHandler } from './ipc/project.handler'
import { registerSFXHandler } from './ipc/sfx.handler'
import { registerWaveformCacheHandler } from './ipc/waveform-cache.handler'
import { registerProxyHandler } from './ipc/proxy.handler'
import { FFmpegService } from './services/FFmpegService'
import { WhisperService, type ModelCompatibilityInfo } from './services/WhisperService'
import { ThumbnailService } from './services/ThumbnailService'
import { ExportQueueManager } from './services/ExportQueue'
import { MENU } from '../shared/ipc/channels'

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
    return join(process.resourcesPath, 'models', 'ggml-small-q8_0.bin')
  }
  return join(app.getAppPath(), 'models', 'ggml-small-q8_0.bin')
}

let thumbnailService: ThumbnailService | null = null
let whisperService: WhisperService | null = null
let ffmpegService: FFmpegService | null = null
let exportQueue: ExportQueueManager | null = null

/**
 * Copy the Capcraft-era userData directory into the new Clipzu location on
 * first run after the rename (thumbnails.db, whisper-cache.json, proxies/,
 * cache/waveforms/). Copy (never move): the old install keeps working and a
 * failed copy loses nothing. Skips when the new dir already has content or
 * the old dir does not exist.
 */
function migrateLegacyUserData(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    const newDir = app.getPath('userData')
    const oldDir = path.join(path.dirname(newDir), 'Capcraft')
    if (newDir === oldDir) return
    if (!fs.existsSync(oldDir)) return
    const isEmptyDir = (dir: string): boolean => {
      try {
        return fs.readdirSync(dir).length === 0
      } catch {
        return true
      }
    }
    if (fs.existsSync(newDir) && !isEmptyDir(newDir)) return
    fs.mkdirSync(newDir, { recursive: true })
    fs.cpSync(oldDir, newDir, { recursive: true, force: false, errorOnExist: false })
    console.log(`[startup] Migrated legacy userData Capcraft -> ${newDir}`)
  } catch (err) {
    console.error('[startup] Legacy userData migration failed (continuing with fresh dir):', (err as Error).message)
  }
}

/** Resolve the Clipzu brand icon (assets/icon_logo.png) for dev + packaged builds */
function resolveAppIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'assets', 'icon_logo.png')]
    : [join(app.getAppPath(), 'assets', 'icon_logo.png')]
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch {
      // ignore FS errors — window simply falls back to the default icon
    }
  }
  return undefined
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0d0d10',
    titleBarStyle: 'hiddenInset',
    icon: resolveAppIcon(),
    frame: process.platform === 'darwin' ? false : true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !is.dev
    }
  })

  // Build native application menu (File → New, Open, Save, Save As)
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send(MENU.newProject)
        },
        { type: 'separator' },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send(MENU.openProject)
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send(MENU.save)
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send(MENU.saveAs)
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle DevTools', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

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

  // Intercept close to show "Save / Don't Save / Cancel" dialog when project is dirty
  let pendingClose = false
  mainWindow.on('close', (e) => {
    if (pendingClose) return // Already confirmed — let it close
    if (!mainWindow) return

    e.preventDefault()

    // Query renderer for dirty state. The sentinel distinguishes three
    // cases: false = explicitly clean (close now); true = dirty (prompt);
    // null = bridge not mounted yet (pre-mount close — PROMPT, never assume
    // clean: closing blind here used to discard work without asking).
    mainWindow.webContents.executeJavaScript(
      'window.__clipzu_isDirty === undefined ? null : window.__clipzu_isDirty()'
    ).then((isDirty) => {
      if (isDirty === false || !mainWindow) {
        // Explicitly clean or window gone — just close
        pendingClose = true
        mainWindow?.close()
        return
      }
      if (isDirty !== true && isDirty !== null) {
        // Foreign value (preload tampering / version skew): fail safe,
        // treat as dirty and prompt.
        isDirty = true
      }

      // Show native OS dialog (like VS Code / Word)
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Save', 'Don\'t Save', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Do you want to save before closing?'
      })

      if (choice === 0) {
        // Save → then close
        mainWindow.webContents.executeJavaScript(
          'window.__clipzu_saveNow === undefined ? null : window.__clipzu_saveNow()'
        ).then((saved) => {
          // Close ONLY on a real saved path. null = user cancelled the save
          // dialog (abort the close, keep working); false = save failed
          // (stay open so the user can retry). Closing on null used to
          // discard work the user never agreed to drop.
          if (typeof saved === 'string' && saved.length > 0) {
            pendingClose = true
            mainWindow?.close()
          }
          // Otherwise stay open.
        })
      } else if (choice === 1) {
        // Don't Save → close without saving
        pendingClose = true
        mainWindow.close()
      }
      // choice === 2 (Cancel) → do nothing, window stays open
    })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.clipzu.desktop-beta')

  // Phase 10: one-time userData migration Capcraft -> Clipzu Desktop Beta.
  // Best-effort, never fatal: a failed copy leaves the new (empty) dir and
  // logs loudly. Runs before any service opens thumbnails.db / caches.
  migrateLegacyUserData()

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
  ffmpegService = ffmpeg
  const whisper = new WhisperService(modelPath, ffmpeg)
  whisperService = whisper
  const thumbnails = new ThumbnailService(
    join(app.getPath('userData'), 'thumbnails.db'),
    ffmpeg
  )
  thumbnailService = thumbnails

  const getWindow = (): BrowserWindow | null => mainWindow
  const exportQ = new ExportQueueManager(getWindow, ffmpeg)
  exportQueue = exportQ

  // Register all IPC handlers with service instances
  registerFFmpegHandler(getWindow, ffmpeg, thumbnails)
  registerWhisperHandler(getWindow, whisper, ffmpeg)
  registerExportHandler(exportQ, ffmpeg)
  registerProjectHandler(getWindow)
  registerSFXHandler()
  registerWaveformCacheHandler()
  registerProxyHandler(() => ffmpeg)

  // Push startup validation result to renderer after it loads
  const validation = validateStartupDeps(ffmpegPath, ffprobePath, modelPath)

  // Fast model check: file-existence + GGML header read (instant, no spawn).
  // Wrapped in try/catch so a validation failure can NEVER abort startup.
  // NOTE: _startupValidated is NOT set here — async validation below is the
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
      // Cache is valid — skip all validation, mark immediately
      console.log('[startup] Persistent cache valid — skipping async model validation')
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
  // Kill all child processes to prevent zombies from blocking exit
  exportQueue?.destroy()
  exportQueue = null
  ffmpegService?.killAll()
  ffmpegService = null
  if (whisperService) {
    whisperService.cancel()
  }
  if (thumbnailService) {
    thumbnailService.close()
  }
})

// Defensive second pass - child_process.kill() is idempotent, safe to call twice
app.on('will-quit', () => {
  exportQueue?.destroy()
  exportQueue = null
  ffmpegService?.killAll()
  ffmpegService = null
  whisperService?.cancel()
  whisperService = null
  thumbnailService?.close()
  thumbnailService = null
  mainWindow = null
})

export { mainWindow }
