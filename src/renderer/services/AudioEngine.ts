/**
 * AudioEngine — Web Audio API mixing engine for multi-track audio playback.
 * Singleton AudioContext with per-track AudioBufferSourceNode + GainNode graph.
 * All overlapping audio tracks mix simultaneously via the shared destination.
 */

let _ctx: AudioContext | null = null
const _buffers = new Map<string, AudioBuffer>()
const _preloading = new Set<string>()

interface ActiveTrack {
  source: AudioBufferSourceNode
  gain: GainNode
  trackId: string
  startMs: number
  durationMs: number
  trimStartMs: number
  /** Base target volume (0–1) before mute/fade, for real-time volume updates */
  baseVolume: number
  fadeInMs: number
  fadeOutMs: number
}

interface OverlayAudio {
  source: MediaElementAudioSourceNode
  gain: GainNode
  clipId: string
}

let _activeTracks: ActiveTrack[] = []
let _masterGain: GainNode | null = null
let _overlayAudios: Map<string, OverlayAudio> = new Map()
let _overlayIdCounter = 0

// Scrub state — short-lived audio bursts during playhead drag
let _scrubSources: AudioBufferSourceNode[] = []
let _scrubTimeout: ReturnType<typeof setTimeout> | null = null

function getCtx(): AudioContext {
  if (!_ctx) {
    _ctx = new AudioContext()
    _masterGain = _ctx.createGain()
    _masterGain.connect(_ctx.destination)
  }
  return _ctx
}

/** Resume AudioContext if suspended (required by autoplay policy) */
export async function resumeAudio(): Promise<void> {
  const ctx = getCtx()
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
}

/** Pre-decode an audio file into the buffer cache. Idempotent.
 *  Uses Electron IPC for local file:// paths (fetch to file:// is blocked
 *  in Electron renderer) and fetch for http:// / https:// URLs. */
export async function preloadBuffer(path: string): Promise<void> {
  if (_buffers.has(path)) return
  if (_preloading.has(path)) return
  _preloading.add(path)
  try {
    const url = toFileUrl(path)
    let ab: ArrayBuffer
    if (url.startsWith('file://')) {
      // Electron renderer: fetch to file:// is blocked.
      // Read via IPC (main process fs.readFile).
      ab = await window.electron.ipcRenderer.invoke('file:readBuffer', path)
    } else {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      ab = await res.arrayBuffer()
    }
    const ctx = getCtx()
    const buf = await ctx.decodeAudioData(ab)
    _buffers.set(path, buf)
  } catch (err) {
    console.warn('AudioEngine: preload failed for', path, err)
  } finally {
    _preloading.delete(path)
  }
}

/** Check if a buffer is preloaded for the given path */
export function hasBuffer(path: string): boolean {
  return _buffers.has(path)
}

/**
 * Start audio playback for a set of tracks at the given timeline position.
 * Each track gets its own AudioBufferSourceNode + GainNode, all routed
 * through a shared master gain → AudioContext destination.
 * Supports per-track fade-in and fade-out via AudioParam scheduling.
 */
export function playTracks(
  tracks: Array<{
    id: string; path: string; startMs: number; durationMs: number
    volume: number; muted: boolean; trimStart: number; speed?: number
    fadeInMs?: number; fadeOutMs?: number
  }>,
  timelineMs: number,
  masterVol: number
): void {
  stopAll()
  const ctx = getCtx()
  if (!ctx || !_masterGain) return

  _masterGain.gain.value = masterVol

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }

  for (const t of tracks) {
    const buf = _buffers.get(t.path)
    if (!buf) continue

    const source = ctx.createBufferSource()
    source.buffer = buf
    const speed = t.speed ?? 1
    if (speed !== 1) {
      source.playbackRate.value = speed
    }

    const gain = ctx.createGain()
    const targetGain = t.muted ? 0 : t.volume
    const fadeInMs = t.fadeInMs ?? 0
    const fadeOutMs = t.fadeOutMs ?? 0

    // Calculate offset into the audio buffer
    const offsetSec = Math.max(0, (timelineMs - t.startMs + t.trimStart) / 1000)
    if (offsetSec >= buf.duration) continue // already past this track

    // Calculate how much of the track remains
    const effectiveDurSec = (t.durationMs + t.trimStart) / 1000
    const remainingDur = effectiveDurSec - offsetSec
    if (remainingDur <= 0) continue

    const startTime = ctx.currentTime
    const remainingDurScaled = remainingDur / speed

    // Set initial gain (with fade-in start if applicable)
    if (fadeInMs > 0 && !t.muted) {
      const fadeInSec = fadeInMs / 1000
      if (offsetSec < fadeInSec) {
        // Playback starts within the fade-in region
        const startGain = targetGain * (offsetSec / fadeInSec)
        gain.gain.setValueAtTime(startGain, startTime)
        gain.gain.linearRampToValueAtTime(targetGain, startTime + (fadeInSec - offsetSec))
      } else {
        // Past the fade-in region — full volume
        gain.gain.setValueAtTime(targetGain, startTime)
      }
    } else {
      gain.gain.setValueAtTime(targetGain, startTime)
    }

    // Schedule fade-out
    if (fadeOutMs > 0 && !t.muted) {
      const fadeOutSec = fadeOutMs / 1000
      // In context time, accounting for playback rate
      const fadeOutStartOffset = Math.max(0, remainingDurScaled - fadeOutSec / speed)
      const fadeOutAbsTime = startTime + fadeOutStartOffset

      // Only schedule if fade-out hasn't already passed
      if (fadeOutAbsTime > startTime) {
        // Ensure we have a set-value anchor at fade start
        if (fadeInMs > 0 && offsetSec < fadeInMs / 1000) {
          // The fade-in ramp may still be active — insert anchor after fade-in completes
          const fadeInEnd = startTime + (fadeInMs / 1000 - offsetSec)
          if (fadeInEnd <= fadeOutAbsTime) {
            gain.gain.setValueAtTime(targetGain, fadeInEnd)
          }
        } else {
          gain.gain.setValueAtTime(targetGain, fadeOutAbsTime)
        }
        gain.gain.linearRampToValueAtTime(0, fadeOutAbsTime + fadeOutSec / speed)
      }
    }

    source.connect(gain)
    gain.connect(_masterGain)

    try {
      source.start(0, offsetSec, remainingDur)
    } catch (err) {
      console.warn('AudioEngine: start failed for track', t.id, err)
      continue
    }

    _activeTracks.push({
      source, gain, trackId: t.id,
      startMs: t.startMs, durationMs: t.durationMs, trimStartMs: t.trimStart,
      baseVolume: t.volume, fadeInMs, fadeOutMs
    })
  }
}

/** Stop all active audio tracks and release source nodes */
export function stopAll(): void {
  for (const t of _activeTracks) {
    try { t.source.stop() } catch { /* already stopped */ }
    try { t.source.disconnect() } catch { /* ok */ }
    try { t.gain.disconnect() } catch { /* ok */ }
  }
  _activeTracks = []
}

/** Set master volume (0–1) */
export function setMasterVol(vol: number): void {
  if (_masterGain) _masterGain.gain.value = vol
}

/**
 * Update per-track volume in real-time (for mute/volume slider).
 * Cancels any scheduled fade ramps and sets the gain immediately.
 */
export function setTrackVol(trackId: string, vol: number, muted: boolean): void {
  const t = _activeTracks.find((a) => a.trackId === trackId)
  if (t) {
    t.baseVolume = vol
    t.gain.gain.cancelScheduledValues(getCtx().currentTime)
    t.gain.gain.value = muted ? 0 : vol
  }
}

// ---------------------------------------------------------------------------
// Audio Scrub — short burst preview when dragging playhead while paused
// ---------------------------------------------------------------------------

/**
 * Play a short audio burst from cached buffers at the given timeline position.
 * Used during playhead scrubbing to give audible feedback.
 */
export function playScrub(
  tracks: Array<{
    id: string; path: string; startMs: number; durationMs: number
    volume: number; muted: boolean; trimStart: number
  }>,
  timelineMs: number,
  masterVol: number,
  scrubDurationMs = 100
): void {
  clearScrub()
  const ctx = getCtx()
  if (!ctx || !_masterGain) return

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }

  const scrubDurSec = scrubDurationMs / 1000
  const fadeDurSec = 0.005 // 5ms anti-click envelope

  for (const t of tracks) {
    if (t.muted) continue
    const buf = _buffers.get(t.path)
    if (!buf) continue

    const offsetSec = Math.max(0, (timelineMs - t.startMs + t.trimStart) / 1000)
    if (offsetSec >= buf.duration) continue

    const remaining = buf.duration - offsetSec
    const playDur = Math.min(scrubDurSec, remaining)
    if (playDur <= 0) continue

    const source = ctx.createBufferSource()
    source.buffer = buf

    const gain = ctx.createGain()
    const now = ctx.currentTime
    const targetGain = t.volume * masterVol

    // Anti-click envelope: quick fade in/out
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(targetGain, now + fadeDurSec)
    gain.gain.setValueAtTime(targetGain, now + playDur - fadeDurSec)
    gain.gain.linearRampToValueAtTime(0, now + playDur)

    source.connect(gain)
    gain.connect(_masterGain)

    try {
      source.start(0, offsetSec, playDur)
    } catch {
      continue
    }

    source.onended = (): void => {
      try { source.disconnect() } catch { /* ok */ }
      try { gain.disconnect() } catch { /* ok */ }
    }

    _scrubSources.push(source)
  }

  // Cleanup references after scrub duration + margin
  _scrubTimeout = setTimeout(() => {
    _scrubSources = []
    _scrubTimeout = null
  }, scrubDurationMs + 50)
}

/** Stop any active scrub audio immediately */
export function clearScrub(): void {
  for (const s of _scrubSources) {
    try { s.stop() } catch { /* ok */ }
    try { s.disconnect() } catch { /* ok */ }
  }
  _scrubSources = []
  if (_scrubTimeout) {
    clearTimeout(_scrubTimeout)
    _scrubTimeout = null
  }
}

// ---------------------------------------------------------------------------
// Overlay Video Audio — route <video> element audio through the engine
// ---------------------------------------------------------------------------

/**
 * Connect an overlay video element's audio to the AudioEngine graph.
 * IMPORTANT: createMediaElementSource can only be called ONCE per element.
 * Returns a unique overlay audio ID for later volume/disconnect calls.
 */
export function connectOverlayAudio(
  clipId: string,
  videoElement: HTMLVideoElement,
  volume: number,
  muted: boolean
): string {
  const ctx = getCtx()
  if (!_masterGain) return ''

  const id = `overlay_${_overlayIdCounter++}`
  const source = ctx.createMediaElementSource(videoElement)
  const gain = ctx.createGain()
  gain.gain.value = muted ? 0 : volume

  source.connect(gain)
  gain.connect(_masterGain)

  _overlayAudios.set(id, { source, gain, clipId })
  return id
}

/** Disconnect and clean up an overlay's audio routing */
export function disconnectOverlayAudio(id: string): void {
  const overlay = _overlayAudios.get(id)
  if (overlay) {
    try { overlay.source.disconnect() } catch { /* ok */ }
    try { overlay.gain.disconnect() } catch { /* ok */ }
    _overlayAudios.delete(id)
  }
}

/** Update an overlay's volume/mute in real-time */
export function updateOverlayAudioVol(id: string, volume: number, muted: boolean): void {
  const overlay = _overlayAudios.get(id)
  if (overlay) {
    overlay.gain.gain.value = muted ? 0 : volume
  }
}

/** Find the overlay audio ID for a given clip ID (if connected) */
export function findOverlayAudioId(clipId: string): string | null {
  for (const [id, overlay] of _overlayAudios) {
    if (overlay.clipId === clipId) return id
  }
  return null
}

/** Clean up AudioContext and all resources */
export function dispose(): void {
  stopAll()
  clearScrub()

  // Disconnect all overlay audio sources
  for (const [id] of _overlayAudios) {
    disconnectOverlayAudio(id)
  }
  _overlayAudios.clear()

  _buffers.clear()
  _preloading.clear()
  if (_ctx) {
    _ctx.close().catch(() => {})
    _ctx = null
    _masterGain = null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFileUrl(filePath: string): string {
  if (filePath.startsWith('file://') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath
  }
  const normalized = filePath.replace(/\\/g, '/')
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///'
  return prefix + normalized.split('/').map(encodeURIComponent).join('/')
}
