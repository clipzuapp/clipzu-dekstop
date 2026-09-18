/**
 * legacyEcp.ts — CapCraft-era `.ecp` (v1) read compatibility (Phase 10).
 *
 * Pure, zero-dependency. Importable from main and tests.
 *
 * Contract ("read if possible", never silent):
 * - Input is an ALREADY-STRICT-VALIDATED NormalizedProjectFile (validateProjectFile).
 * - Media existence is checked by the CALLER (main, fs) BEFORE calling here;
 *   this transform is pure data mapping and performs no I/O.
 * - v1 carries only an export PRESET string, not the full config: the preset
 *   is honored when known, otherwise 'custom' + a migration note. Every
 *   substitution is reported in `notes` — the renderer toasts them.
 * - Missing optional session fields default (playhead 0, zoom 1, volume 1,
 *   loop off) + note. Nothing is invented silently.
 */

import type {
  CanonicalExportConfig,
  LoadedProjectFile,
  NormalizedProjectFile,
} from './projectSchema'

const KNOWN_PRESETS: ReadonlySet<string> = new Set([
  'tiktok-reels',
  'youtube',
  'instagram-post',
  'instagram-port',
  '4k-vertical',
  '4k-horizontal',
  'prores',
  'webm',
  'custom',
])

export type ExportPresetKey = CanonicalExportConfig['preset']

/**
 * Default full export config honoring a v1 preset string when known.
 * Reports the substitution when the preset is unknown.
 */
export function defaultExportConfigForPreset(
  preset: string,
  fps: 24 | 30 | 60,
  notes: string[]
): CanonicalExportConfig {
  const known = KNOWN_PRESETS.has(preset)
  if (!known) {
    notes.push(
      `Legacy project preset '${preset}' is unknown — export preset reset to 'custom'`
    )
  }
  return {
    preset: (known ? preset : 'custom') as ExportPresetKey,
    customWidth: 1920,
    customHeight: 1080,
    upscaleEnabled: false,
    upscaleAlgorithm: 'lanczos',
    codec: 'h264',
    qualityPreset: 'slow',
    bitrateKbps: null,
    bitrateMode: 'auto',
    exportFrameRange: null,
    audioOnly: false,
    fps,
    hardwareAccel: false,
  }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Map a validated v1 project to the renderer-facing loaded shape.
 * Deep-copies every entity (caller-owned stores must never alias the
 * validated document). Paths stay absolute (v1 stored absolute paths —
 * THAT is the legacy limitation; saving re-roots them as .clipzu assets).
 */
export function v1ToLoadedProject(
  v1: NormalizedProjectFile,
  notes: string[]
): LoadedProjectFile {
  const session = (field: 'playheadMs' | 'zoom' | 'masterVolume', fallback: number): number => {
    const value = v1[field]
    if (value === undefined) {
      notes.push(`Legacy project has no '${field}' — defaulted to ${fallback}`)
      return fallback
    }
    return finiteOr(value, fallback)
  }
  const loopEnabled =
    typeof v1.loopEnabled === 'boolean' ? v1.loopEnabled : false
  if (v1.loopEnabled === undefined) {
    notes.push(`Legacy project has no 'loopEnabled' — defaulted to false`)
  }

  return {
    version: '2.0',
    name: v1.name,
    fps: v1.fps,
    resolution: { ...v1.resolution },
    aspectRatio: v1.aspectRatio,
    backgroundColor: v1.backgroundColor,
    clips: v1.clips.map((c) => ({ ...c })),
    audioTracks: v1.audioTracks.map((t) => ({ ...t })),
    textClips: v1.textClips.map((tc) => ({ ...tc })),
    tracks: v1.tracks.map((t) => ({ ...t })),
    markers: v1.markers.map((m) => ({ ...m })),
    captions: {
      entries: v1.captions.entries.map((tc) => ({ ...tc })),
      style: { ...(v1.captions.style as object) } as LoadedProjectFile['captions']['style'],
      language: v1.captions.language,
    },
    playheadMs: session('playheadMs', 0),
    zoom: session('zoom', 1),
    masterVolume: session('masterVolume', 1),
    loopEnabled,
    exportConfig: defaultExportConfigForPreset(v1.exportPreset, v1.fps, notes),
  }
}
