/**
 * modelCatalog.ts — first-run model delivery SSOT (Phase 5, P5.2 / audit B4).
 *
 * The installer stays model-free; the app fetches the model on first use
 * into userData (writable post-install — resources/ is not). The catalog
 * pins EXACT bytes: URL (README §3, ggerganov/whisper.cpp), size + sha256
 * measured 2026-10-03 from the dev copy this app is proven to transcribe
 * with (P2 V2.1 QA: 37s voiceover → 6 entries). A download that does not
 * match fails CLOSED (bytes deleted, typed error) — a corrupt local copy
 * can therefore never poison future installs.
 *
 * Pure data module: no fs, no network — safe for node:test and the renderer.
 */

export interface ModelSpec {
  /** Installed filename (all three model dirs use this name). */
  fileName: string
  /** Canonical download URL (HTTPS only — enforced by the downloader). */
  url: string
  /** Expected lowercase hex sha256 of the complete file. */
  sha256: string
  /** Expected exact byte size (early mismatch signal before hashing). */
  sizeBytes: number
  /** Human label for the download banner. */
  label: string
}

/** Generic archive consumed by the shared HTTPS/checksum downloader. */
export interface DownloadArchiveSpec {
  fileName: string
  url: string
  sha256: string
  /** Optional when a publisher supplies a hard maximum but no byte count. */
  sizeBytes?: number
  /** Hard bound even when Content-Length is missing or untrusted. */
  maxSizeBytes: number
  label: string
}

export type ModelDeliveryPhase = 'missing' | 'downloading' | 'verifying' | 'ready' | 'error'

export interface ModelDeliveryStatus {
  phase: ModelDeliveryPhase
  receivedBytes: number
  totalBytes: number
  percent: number | null
  error?: string
}

export type ModelDeliveryResult =
  | { ok: true; status: ModelDeliveryStatus }
  | { ok: false; status: ModelDeliveryStatus }

export const BUNDLED_MODEL: ModelSpec = {
  fileName: 'ggml-small-q8_0.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin',
  sha256: '49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f',
  sizeBytes: 264464607,
  label: 'AI transcription model (~252 MB)',
}

/** Pinned Gyan essentials build matching the repository's shipped FFmpeg 8.1.2. */
export const WINDOWS_MEDIA_RUNTIME: DownloadArchiveSpec = {
  fileName: 'ffmpeg-8.1.2-essentials_build.zip',
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip',
  sha256: 'db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec',
  sizeBytes: 109_728_040,
  maxSizeBytes: 120 * 1024 * 1024,
  label: 'FFmpeg media runtime (~104 MB download)',
}

export const MEDIA_RUNTIME_VERSION = '8.1.2'

/** Resolve which candidate model path to use (first existing wins). */
export function pickModelPath(candidates: Array<{ path: string; exists: boolean }>): string | null {
  for (const c of candidates) {
    if (c.exists) return c.path
  }
  return null
}
