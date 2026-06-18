/**
 * WaveformService — Extracts peak amplitude data from audio files for
 * timeline waveform rendering. Uses Web Audio API decodeAudioData.
 *
 * Caches results in memory by file path. Idempotent — calling extract()
 * multiple times for the same path returns the cached data.
 */

const PEAK_RESOLUTION = 512 // number of peak samples per track

const cache = new Map<string, Float32Array>()

/** Pending extractions to avoid duplicate in-flight requests */
const pending = new Map<string, Promise<Float32Array>>()

/** Singleton AudioContext shared across all waveform extractions (avoids browser cap of ~6) */
let _sharedCtx: AudioContext | null = null
function getSharedCtx(): AudioContext {
  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    _sharedCtx = new AudioContext()
  }
  return _sharedCtx
}

/**
 * Ensure a file path is a valid file:// URL that fetch() can load.
 * Handles Windows backslashes and absolute paths.
 */
function toFileUrl(filePath: string): string {
  if (filePath.startsWith('file://')) return filePath
  // Normalize slashes and encode for URL
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return `file://${normalized}`
  return `file:///${normalized}`
}

/**
 * Compute peak samples from raw PCM float data.
 * Divides the audio into numPeaks windows and takes the max absolute
 * amplitude in each window.
 */
function computePeaks(channelData: Float32Array, numPeaks: number): Float32Array {
  const peaks = new Float32Array(numPeaks)
  const samplesPerPeak = Math.max(1, Math.floor(channelData.length / numPeaks))

  for (let i = 0; i < numPeaks; i++) {
    let max = 0
    const start = i * samplesPerPeak
    const end = Math.min(start + samplesPerPeak, channelData.length)
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j])
      if (abs > max) max = abs
    }
    peaks[i] = max
  }

  return peaks
}

/**
 * Extract waveform peak data for an audio file.
 * Returns a Float32Array of length PEAK_RESOLUTION with values in [0, 1].
 * Results are cached — subsequent calls return instantly.
 */
export async function extractWaveform(filePath: string): Promise<Float32Array> {
  // Check cache
  const cached = cache.get(filePath)
  if (cached) return cached

  // Check in-flight
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
    // Cache failure silently — draw will fall back to synthetic bars
    console.warn('Waveform extraction failed for', filePath, err)
    return new Float32Array(PEAK_RESOLUTION)
  }
}

async function doExtract(filePath: string): Promise<Float32Array> {
  try {
    const url = toFileUrl(filePath)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()
    const audioCtx = getSharedCtx()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

    const channelData = audioBuffer.getChannelData(0)
    return computePeaks(channelData, PEAK_RESOLUTION)
  } catch (_err) {
    // Return empty — renderer will draw synthetic bars as fallback
    return new Float32Array(PEAK_RESOLUTION)
  }
}

/**
 * Check if waveform data is cached for a given file path.
 */
export function hasWaveform(filePath: string): boolean {
  return cache.has(filePath)
}

/**
 * Get cached waveform data. Returns null if not cached.
 */
export function getWaveform(filePath: string): Float32Array | null {
  return cache.get(filePath) ?? null
}

/**
 * Clear waveform cache (e.g., when project is closed).
 */
export function clearWaveformCache(): void {
  cache.clear()
  pending.clear()
  if (_sharedCtx) {
    _sharedCtx.close().catch(() => {})
    _sharedCtx = null
  }
}
