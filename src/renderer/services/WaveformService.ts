/**
 * WaveformService — Extracts peak amplitude data from audio files for
 * timeline waveform rendering. Uses Web Audio API decodeAudioData.
 *
 * Stores dual peaks (positive max + negative min per window) at high
 * base resolution (2048 points) so the renderer can produce a filled
 * waveform silhouette that stays crisp at any zoom level.
 *
 * Caches results in memory by file path. Idempotent.
 */

const PEAK_RESOLUTION = 2048

export interface WaveformPeaks {
  /** Positive envelope — max amplitude in each window [0…1] */
  max: Float32Array
  /** Negative envelope — min amplitude in each window [-1…0] */
  min: Float32Array
}

const cache = new Map<string, WaveformPeaks>()
const pending = new Map<string, Promise<WaveformPeaks>>()

/** Singleton AudioContext shared across all waveform extractions (avoids browser cap of ~6) */
let _sharedCtx: AudioContext | null = null
function getSharedCtx(): AudioContext {
  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    _sharedCtx = new AudioContext()
  }
  return _sharedCtx
}

/**
 * Ensure a file path is a valid file:// URL. Handles Windows backslashes.
 */
function toFileUrl(filePath: string): string {
  if (filePath.startsWith('file://')) return filePath
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return `file://${normalized}`
  return `file:///${normalized}`
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

/**
 * Extract waveform dual-peak data for an audio file.
 * Returns { max, min } Float32Arrays of length PEAK_RESOLUTION.
 * Results are cached — subsequent calls return instantly.
 */
export async function extractWaveform(filePath: string): Promise<WaveformPeaks> {
  const cached = cache.get(filePath)
  if (cached) return cached

  const inFlight = pending.get(filePath)
  if (inFlight) return inFlight

  const promise = doExtract(filePath)
  pending.set(filePath, promise)

  try {
    const peaks = await promise
    cache.set(filePath, peaks)
    pending.delete(filePath)
    return peaks
  } catch (err) {
    pending.delete(filePath)
    console.warn('Waveform extraction failed for', filePath, err)
    const empty = new Float32Array(PEAK_RESOLUTION)
    return { max: empty, min: empty }
  }
}

async function doExtract(filePath: string): Promise<WaveformPeaks> {
  try {
    const url = toFileUrl(filePath)
    // Local files read via IPC (file:// fetch blocked in Electron renderer)
    let ab: ArrayBuffer
    if (url.startsWith('file://')) {
      ab = await window.electron.ipcRenderer.invoke('file:readBuffer', filePath)
    } else {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      ab = await response.arrayBuffer()
    }
    const audioCtx = getSharedCtx()
    const audioBuffer = await audioCtx.decodeAudioData(ab)
    const channelData = audioBuffer.getChannelData(0)
    return computeDualPeaks(channelData, PEAK_RESOLUTION)
  } catch (_err) {
    const empty = new Float32Array(PEAK_RESOLUTION)
    return { max: empty, min: empty }
  }
}

/** Check if waveform data is cached for a given file path. */
export function hasWaveform(filePath: string): boolean {
  return cache.has(filePath)
}

/** Get cached waveform dual-peak data. Returns null if not cached. */
export function getWaveform(filePath: string): WaveformPeaks | null {
  return cache.get(filePath) ?? null
}

/** Clear waveform cache (e.g., when project is closed). */
export function clearWaveformCache(): void {
  cache.clear()
  pending.clear()
  if (_sharedCtx) {
    _sharedCtx.close().catch(() => {})
    _sharedCtx = null
  }
}
