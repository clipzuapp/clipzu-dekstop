/**
 * WaveformService — Extracts peak amplitude data from audio files for
 * timeline waveform rendering.
 *
 * THREE-TIER CACHE (RAM-last principle):
 *   1. RAM cache — Map<string, WaveformEntry> with LRU eviction (max 2000)
 *   2. Disk cache — Binary .pek files in appData/cache/waveforms/
 *   3. Compute — Decode audio via Web Audio API (expensive, last resort)
 *
 * On cache miss at tier 1, checks tier 2 (disk). Only if both miss does
 * the expensive decode happen. After decode, result is written to BOTH
 * tier 1 (RAM) and tier 2 (disk).
 *
 * PERFORMANCE: Reuses AudioEngine's decoded buffer when available to avoid
 * duplicate full-file decode. Only decodes independently if AudioEngine
 * doesn't have the buffer cached.
 *
 * ADAPTIVE RESOLUTION: Peak count scales with source duration so waveforms
 * stay detailed regardless of file length:
 *   < 5 min  → 2048 peaks (~16 KB)
 *   < 30 min → 4096 peaks (~32 KB)
 *   < 2 hr   → 8192 peaks (~64 KB)
 *   ≥ 2 hr   → 16384 peaks (~128 KB)
 */

import { getBuffer, getAudioContext } from './AudioEngine'
// Canonical shared file:// encoder (Phase 9) — replaces the local copy.
import { toFileUrl } from '../../shared/utils/fileUrl'

/** Base peak resolution for short files (< 5 min) */
const BASE_PEAKS = 2048

/** Max cached waveforms in RAM. Each entry ≈ 16-128 KB, so 2000 = ~32 MB ceiling. */
const MAX_RAM_CACHE = 2000

export interface WaveformPeaks {
  /** Positive envelope — max amplitude in each window [0…1] */
  max: Float32Array
  /** Negative envelope — min amplitude in each window [-1…0] */
  min: Float32Array
}

interface WaveformEntry {
  peaks: WaveformPeaks
  lastAccess: number
}

const ramCache = new Map<string, WaveformEntry>()
const pending = new Map<string, Promise<WaveformPeaks>>()

/**
 * Determine adaptive peak resolution based on audio duration.
 * Longer files get more peaks so waveforms stay detailed.
 */
function adaptivePeakCount(durationSec: number): number {
  if (durationSec < 300) return BASE_PEAKS        // < 5 min → 2048
  if (durationSec < 1800) return BASE_PEAKS * 2   // < 30 min → 4096
  if (durationSec < 7200) return BASE_PEAKS * 4   // < 2 hr → 8192
  return BASE_PEAKS * 8                            // ≥ 2 hr → 16384
}

/**
 * Compute dual peak samples from raw PCM float data.
 * Each window produces { max: highest positive, min: lowest negative }.
 */
function computeDualPeaks(channelData: Float32Array, numPeaks: number): WaveformPeaks {
  const maxPeaks = new Float32Array(numPeaks)
  const minPeaks = new Float32Array(numPeaks)
  const samplesPerPeak = Math.max(1, Math.floor(channelData.length / numPeaks))

  for (let i = 0; i < numPeaks; i++) {
    let max = 0
    let min = 0
    const start = i * samplesPerPeak
    const end = Math.min(start + samplesPerPeak, channelData.length)
    for (let j = start; j < end; j++) {
      const v = channelData[j]
      if (v > max) max = v
      if (v < min) min = v
    }
    maxPeaks[i] = max
    minPeaks[i] = min
  }

  return { max: maxPeaks, min: minPeaks }
}

// ---- Disk cache helpers (async, via IPC) ----

async function readDiskCache(filePath: string): Promise<WaveformPeaks | null> {
  try {
    const result = await window.electron.ipcRenderer.invoke('waveform:readPeaks', filePath) as {
      max: number[]; min: number[]; peakCount: number
    } | null
    if (!result) return null
    return {
      max: Float32Array.from(result.max),
      min: Float32Array.from(result.min)
    }
  } catch {
    return null
  }
}

/** Fire-and-forget: write peaks to disk cache. Never blocks caller. */
function writeDiskCache(filePath: string, peaks: WaveformPeaks): void {
  // Non-blocking: invoke but don't await
  window.electron.ipcRenderer.invoke(
    'waveform:writePeaks',
    filePath,
    Array.from(peaks.max),
    Array.from(peaks.min)
  ).catch(() => { /* best-effort */ })
}

// ---- RAM cache helpers ----

function ramGet(filePath: string): WaveformPeaks | null {
  const entry = ramCache.get(filePath)
  if (entry) {
    entry.lastAccess = Date.now()
    return entry.peaks
  }
  return null
}

function ramPut(filePath: string, peaks: WaveformPeaks): void {
  // LRU eviction
  if (ramCache.size >= MAX_RAM_CACHE && !ramCache.has(filePath)) {
    let oldestKey: string | null = null
    let oldestAccess = Infinity
    for (const [key, entry] of ramCache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess
        oldestKey = key
      }
    }
    if (oldestKey) ramCache.delete(oldestKey)
  }
  ramCache.set(filePath, { peaks, lastAccess: Date.now() })
}

// ---- Main extraction ----

/**
 * Extract waveform dual-peak data for an audio file.
 * Three-tier lookup: RAM → Disk → Compute.
 * Results are cached in both RAM and disk.
 */
export async function extractWaveform(filePath: string): Promise<WaveformPeaks> {
  // Tier 1: RAM cache
  const ramHit = ramGet(filePath)
  if (ramHit) return ramHit

  // Dedup: if already computing, return the same promise
  const inFlight = pending.get(filePath)
  if (inFlight) return inFlight

  const promise = (async (): Promise<WaveformPeaks> => {
    // Tier 2: Disk cache
    const diskHit = await readDiskCache(filePath)
    if (diskHit) {
      ramPut(filePath, diskHit)
      return diskHit
    }

    // Tier 3: Compute (expensive decode)
    try {
      const peaks = await doExtract(filePath)
      ramPut(filePath, peaks)
      writeDiskCache(filePath, peaks) // fire-and-forget
      return peaks
    } catch (err) {
      console.warn('Waveform extraction failed for', filePath, err)
      const empty = new Float32Array(BASE_PEAKS)
      return { max: empty, min: empty }
    }
  })()

  pending.set(filePath, promise)
  try {
    return await promise
  } finally {
    pending.delete(filePath)
  }
}

async function doExtract(filePath: string): Promise<WaveformPeaks> {
  // PERFORMANCE: Reuse AudioEngine's decoded buffer if available.
  let channelData: Float32Array
  let durationSec: number

  const cachedBuf = getBuffer(filePath)
  if (cachedBuf) {
    channelData = cachedBuf.getChannelData(0)
    durationSec = cachedBuf.duration
  } else {
    const url = toFileUrl(filePath)
    let ab: ArrayBuffer
    if (url.startsWith('file://')) {
      ab = await window.electron.ipcRenderer.invoke('file:readBuffer', filePath)
    } else {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      ab = await response.arrayBuffer()
    }
    const audioCtx = getAudioContext()
    const audioBuffer = await audioCtx.decodeAudioData(ab)
    channelData = audioBuffer.getChannelData(0)
    durationSec = audioBuffer.duration
  }

  const peakCount = adaptivePeakCount(durationSec)
  return computeDualPeaks(channelData, peakCount)
}

/** Check if waveform data is cached (RAM only — disk check is async). */
export function hasWaveform(filePath: string): boolean {
  return ramCache.has(filePath)
}

/** Get cached waveform dual-peak data from RAM. Returns null if not in RAM. */
export function getWaveform(filePath: string): WaveformPeaks | null {
  return ramGet(filePath)
}

/** Clear RAM waveform cache (disk cache persists across sessions). */
export function clearWaveformCache(): void {
  ramCache.clear()
  pending.clear()
}
