import { ipcMain, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'
import { normalizeNFC } from '../../shared/utils/encoding'
import { FFmpegService } from '../services/FFmpegService'

/**
 * Proxy workflow IPC handlers.
 *
 * On import of video files > 720p, the renderer requests a proxy generation.
 * FFmpeg creates a 720p H.264 copy stored in appData/Clipzu Desktop Beta/proxies/.
 * The timeline preview uses the proxy path; export swaps back to original.
 *
 * File naming: SHA-256 of source path → {hash}.mp4
 *
 * SSOT: All proxy management goes through this module.
 */

function getProxyDir(): string {
  const base = app.getPath('userData')
  return join(base, 'proxies')
}

function ensureProxyDir(): string {
  const dir = getProxyDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function sourceHash(filePath: string): string {
  // UTF-8 policy (Phase 9): NFC-normalize before hashing so the same file
  // hashes identically on macOS (NFD) and Windows (NFC).
  return createHash('sha256').update(normalizeNFC(filePath)).digest('hex').slice(0, 16)
}

function proxyPathForSource(filePath: string): string {
  return join(ensureProxyDir(), `${sourceHash(filePath)}.mp4`)
}

export function registerProxyHandler(getFFmpeg: () => FFmpegService): void {
  /**
   * Get the proxy path for a source file. Does NOT generate — just returns
   * the expected path so the caller can check if it exists.
   */
  ipcMain.handle('proxy:getPath', async (_event, sourcePath: string): Promise<string> => {
    return proxyPathForSource(sourcePath)
  })

  /**
   * Check if a proxy already exists for a source file.
   */
  ipcMain.handle('proxy:exists', async (_event, sourcePath: string): Promise<boolean> => {
    return existsSync(proxyPathForSource(sourcePath))
  })

  /**
   * Generate a proxy file for the given source.
   * Returns the proxy file path on success.
   * If the proxy already exists, returns immediately without regenerating.
   */
  ipcMain.handle('proxy:generate', async (event, sourcePath: string, durationMs?: number): Promise<string> => {
    const proxyPath = proxyPathForSource(sourcePath)

    // Skip if proxy already exists
    if (existsSync(proxyPath)) {
      return proxyPath
    }

    const ffmpeg = getFFmpeg()
    const { promise } = ffmpeg.generateProxy(sourcePath, proxyPath, durationMs ?? 0, (progress) => {
      // Forward progress to renderer
      event.sender.send('proxy:progress', { sourcePath, ...progress })
    })

    await promise
    return proxyPath
  })

  /**
   * Get the proxy directory path (for diagnostics).
   */
  ipcMain.handle('proxy:getDir', async (): Promise<string> => {
    return ensureProxyDir()
  })
}
