import { ipcMain, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { normalizeNFC } from '../../shared/utils/encoding'

/**
 * Waveform disk cache IPC handlers.
 *
 * Stores pre-computed waveform peak data as binary .pek files on disk so the
 * renderer never needs to re-decode audio just to show waveforms.
 *
 * .pek format (all little-endian):
 *   [0..3]   Magic: "PEK1" (4 bytes ASCII)
 *   [4..7]   peakCount: uint32
 *   [8..8+peakCount*4]   max peaks: Float32Array[peakCount]
 *   [8+peakCount*4..end] min peaks: Float32Array[peakCount]
 *
 * File naming: SHA-256 of the source file path → {hash}.pek
 * Directory:   appData/Clipzu Desktop Beta/cache/waveforms/
 *
 * SSOT: All waveform disk cache goes through this module.
 */

const MAGIC = 'PEK1'
const HEADER_SIZE = 8 // 4 magic + 4 peakCount

function getCacheDir(): string {
  const base = app.getPath('userData')
  return join(base, 'cache', 'waveforms')
}

function ensureCacheDir(): string {
  const dir = getCacheDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function sourceHash(filePath: string): string {
  // UTF-8 policy (Phase 9): NFC-normalize before hashing (macOS NFD vs
  // Windows NFC would otherwise fork the cache for the same file).
  return createHash('sha256').update(normalizeNFC(filePath)).digest('hex').slice(0, 16)
}

function pekPath(filePath: string): string {
  return join(ensureCacheDir(), `${sourceHash(filePath)}.pek`)
}

/** Serialize peaks to binary buffer */
function serializePeaks(max: Float32Array, min: Float32Array): Buffer {
  const peakCount = max.length
  const byteLen = HEADER_SIZE + peakCount * 4 * 2
  const buf = Buffer.alloc(byteLen)
  buf.write(MAGIC, 0, 4, 'ascii')
  buf.writeUInt32LE(peakCount, 4)
  Buffer.from(max.buffer, max.byteOffset, max.byteLength).copy(buf, HEADER_SIZE)
  Buffer.from(min.buffer, min.byteOffset, min.byteLength).copy(buf, HEADER_SIZE + peakCount * 4)
  return buf
}

/** Deserialize binary buffer to { max, min } Float32Arrays */
function deserializePeaks(buf: Buffer): { max: Float32Array; min: Float32Array } | null {
  if (buf.length < HEADER_SIZE) return null
  const magic = buf.toString('ascii', 0, 4)
  if (magic !== MAGIC) return null
  const peakCount = buf.readUInt32LE(4)
  const expectedLen = HEADER_SIZE + peakCount * 4 * 2
  if (buf.length < expectedLen) return null
  const max = new Float32Array(buf.buffer.slice(buf.byteOffset + HEADER_SIZE, buf.byteOffset + HEADER_SIZE + peakCount * 4))
  const min = new Float32Array(buf.buffer.slice(buf.byteOffset + HEADER_SIZE + peakCount * 4, buf.byteOffset + expectedLen))
  return { max, min }
}

export function registerWaveformCacheHandler(): void {
  /**
   * Read cached waveform peaks from disk.
   * Returns { max, min } as plain number arrays (JSON-safe for IPC), or null if not cached.
   */
  ipcMain.handle('waveform:readPeaks', async (_event, filePath: string): Promise<{ max: number[]; min: number[]; peakCount: number } | null> => {
    const path = pekPath(filePath)
    if (!existsSync(path)) return null
    try {
      const buf = readFileSync(path)
      const peaks = deserializePeaks(buf)
      if (!peaks) return null
      return {
        max: Array.from(peaks.max),
        min: Array.from(peaks.min),
        peakCount: peaks.max.length
      }
    } catch {
      return null
    }
  })

  /**
   * Write waveform peaks to disk cache.
   * Accepts plain number arrays (JSON-safe for IPC).
   */
  ipcMain.handle('waveform:writePeaks', async (_event, filePath: string, max: number[], min: number[]): Promise<void> => {
    try {
      const maxF32 = Float32Array.from(max)
      const minF32 = Float32Array.from(min)
      const buf = serializePeaks(maxF32, minF32)
      const path = pekPath(filePath)
      writeFileSync(path, buf)
    } catch (err) {
      console.warn('[WaveformCache] Failed to write peaks:', err)
    }
  })

  /**
   * Get the cache directory path (for diagnostics / cleanup).
   */
  ipcMain.handle('waveform:getCacheDir', async (): Promise<string> => {
    return ensureCacheDir()
  })
}
