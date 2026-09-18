/**
 * lifecycle.inttest.ts — Electron-runtime save→close→reopen→load regression test.
 *
 * Task.txt Step 3 items 3-5. Drives the REAL compiled zustand stores
 * (useTimeline/useProject/useCaption/useExport) through the EXACT lifecycle
 * the app performs — the only parts not executed are the Electron IPC
 * transport itself (dialog/app/ipcMain, no display available) and React
 * rendering. The save-payload construction and the load reset/restore order
 * replicate HotkeyManager.saveProjectToDisk/loadProjectFromDialog
 * field-for-field (verified against HotkeyManager.tsx:39-175).
 *
 * Scenario: seed Project A via real store actions (3 media imports, timeline
 * clips, audio track, text clip, caption entries, effect, keyframe, marker,
 * modified export settings) → contaminate session state (selection,
 * clipboards, in/out points, playback, caption status, export queue) → save
 * through the REAL main pipeline (validate→manifest→migrate→serialize→disk)
 * → CLOSE (drop all modules = process exit) → REOPEN (fresh module state =
 * app restart) → load from disk bytes → compare snapshot.
 */

import './testSetup'
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  validateProjectFile,
  validateClipzuFile,
  validateExportConfig,
  migrateV1ToClipzuStrict,
  type NormalizedProjectFile,
  type CanonicalExportConfig,
  type ClipzuDocument,
  type LoadedProjectFile,
} from '../projectSchema'
import {
  buildAssetManifest,
  resolveAssetManifest,
} from '../../../main/project/projectAssets'
import { recalcTimelineDuration } from '../../utils/timeline'

// First-generation store handles (seed + save side).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stores1 = {
  timeline: require('../../../renderer/store/useTimeline.js'),
  project: require('../../../renderer/store/useProject.js'),
  caption: require('../../../renderer/store/useCaption.js'),
  exp: require('../../../renderer/store/useExport.js'),
}

const TRANSFORM = {
  x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
  cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
}
const STYLE = {
  fontFamily: 'Inter', fontSize: 48, fontWeight: 700,
  color: '#ffffff', strokeColor: '#000000', strokeWidth: 1,
  bgColor: '#000000', bgOpacity: 0.5,
  alignment: 'center', position: 'bottom',
  x: 50, y: 75, rotation: 0, scale: 1,
  animation: 'pop', captionMode: 'full-phrase', revealFadeMs: 0,
}

let workDir = ''
let projDir = ''
let clipzuPath = ''
let clipFiles: string[] = []
let audioFile = ''
let audioFile2 = ''
let expected: {
  durationMs: number
  clips: unknown[]
  audioTracks: unknown[]
  textClips: unknown[]
  tracks: unknown[]
  markers: unknown[]
  style: unknown
  language: string
  exportConfig: CanonicalExportConfig
  meta: Record<string, unknown>
  session: Record<string, unknown>
} | null = null

/** Drop every renderer module = process exit. Next require = app restart. */
function freshRenderer(): typeof stores1 {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${sep}renderer${sep}`)) delete require.cache[key]
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return {
    timeline: require('../../../renderer/store/useTimeline.js'),
    project: require('../../../renderer/store/useProject.js'),
    caption: require('../../../renderer/store/useCaption.js'),
    exp: require('../../../renderer/store/useExport.js'),
  }
}

describe('electron-runtime save→close→reopen→load (task.txt Step 3)', () => {
  before(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-lifecycle-'))
    projDir = join(workDir, 'project')
    const mediaDir = join(projDir, 'media')
    await fs.mkdir(mediaDir, { recursive: true })
    clipFiles = []
    for (let i = 0; i < 3; i++) {
      const file = join(mediaDir, `import${i + 1}.mp4`)
      await fs.writeFile(file, Buffer.from(`lifecycle-video-${i}-${Date.now()}`))
      clipFiles.push(file)
    }
    audioFile = join(mediaDir, 'voice.mp3')
    await fs.writeFile(audioFile, Buffer.from(`lifecycle-audio-${Date.now()}`))
    audioFile2 = join(mediaDir, 'ambience.mp3')
    await fs.writeFile(audioFile2, Buffer.from(`lifecycle-ambience-${Date.now()}`))
    clipzuPath = join(projDir, 'project-a.clipzu')
  })

  after(async () => {
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('seeds Project A through real store actions', () => {
    const { timeline, project, caption, exp } = stores1
    project.useProject.getState().loadProject({
      name: 'Project A',
      fps: 30,
      resolution: { width: 1920, height: 1080 },
      aspectRatio: '16:9',
      backgroundColor: '#101010',
      projectFilePath: null,
    })
    clipFiles.forEach((file, i) => {
      timeline.useTimeline.getState().addClip({
        id: `clip_${i + 1}`,
        path: file,
        startMs: i * 3000,
        sourceDurationMs: 5000,
        durationMs: 3000,
        trackIndex: 0,
        trimStart: 0,
        trimEnd: 2000,
        name: `Clip ${i + 1}`,
        hasAudio: true,
        transform: { ...TRANSFORM },
        speed: 1,
        volume: 1,
        muted: false,
        // Keyframe (clip 1) + effect modifier (clip 2). Clips without them
        // carry no keys at all — exactly like real media imports.
        ...(i === 0
          ? { keyframes: [{ property: 'opacity', frames: [{ time: 0, value: 0.5, easing: 'linear' }, { time: 3000, value: 1, easing: 'easeOut' }] }] }
          : {}),
        ...(i === 1
          ? { modifiers: [{ id: 'mod_1', type: 'effect', presetId: 'fx-vivid', enabled: true, parameters: { intensity: 0.8 }, keyframes: [], version: 1 }] }
          : {}),
      })
    })
    timeline.useTimeline.getState().addAudioTrack({
      id: 'audio_1', path: audioFile, startMs: 0, sourceDurationMs: 9000,
      durationMs: 9000, volume: 0.9, muted: false, name: 'Voice',
      role: 'voice', trimStart: 0, trimEnd: 0, trackIndex: 0,
    })
    timeline.useTimeline.getState().addAudioTrack({
      id: 'audio_2', path: audioFile2, startMs: 2000, sourceDurationMs: 7000,
      durationMs: 7000, volume: 0.5, muted: false, name: 'Ambience',
      role: 'ambient', trimStart: 0, trimEnd: 0, trackIndex: 1,
    })
    // Real edit operations: trim, split at playhead, transition.
    timeline.useTimeline.getState().trimClip('clip_1', 500, 1000)
    timeline.useTimeline.getState().setPlayhead(4500)
    timeline.useTimeline.getState().splitClipAtPlayhead()
    timeline.useTimeline.getState().setClipOutTransition('clip_1', { type: 'crossfade', durationMs: 400 })
    timeline.useTimeline.getState().addTextClip({
      id: 'text_1', startMs: 1000, durationMs: 2000, endMs: 3000, trackIndex: 0,
      text: 'hello world',
      style: { fontFamily: 'Inter', fontSize: 64 },
      words: [
        { word: 'hello', startMs: 1000, endMs: 1800 },
        { word: 'world', startMs: 1800, endMs: 3000 },
      ],
      wordTimestampsSource: 'whisper',
    })
    timeline.useTimeline.getState().addMarker({ timeMs: 4500, label: 'beat', color: '#00ff00' })
    timeline.useTimeline.getState().setPlayhead(4500)
    caption.useCaption.getState().loadCaptions({ entries: [], style: STYLE, language: 'en' })
    exp.useExport.getState().setPreset('youtube')
    exp.useExport.getState().setBitrate(8000)
    exp.useExport.getState().setBitrateMode('cbr')
    exp.useExport.getState().setAudioOnly(false)
    exp.useExport.getState().setHardwareAccel(true)
    exp.useExport.getState().setExportFrameRange({ startMs: 0, endMs: 9000 })

    // Contaminate session state the way a real editing session does.
    timeline.useTimeline.getState().selectClip('clip_1')
    timeline.useTimeline.getState().copySelection()
    timeline.useTimeline.getState().copyStyle()
    timeline.useTimeline.getState().setInPoint(1000)
    timeline.useTimeline.getState().setOutPoint(8000)
    timeline.useTimeline.getState().setPlaying(true)
    caption.useCaption.setState({ status: 'error', progress: 0.5, error: 'boom' })
    exp.useExport.setState({
      queue: [{ id: 'job_old', status: 'completed', progress: 100, outputPath: '/tmp/old.mp4', createdAt: 1 }],
      isExporting: false,
    })

    assert.equal(timeline.useTimeline.getState().clips.length, 4)
    assert.equal(timeline.useTimeline.getState().audioTracks.length, 2)
    const splitClip = timeline.useTimeline.getState().clips.find((c) => c.id.startsWith('clip_2_split_'))
    assert.ok(splitClip, 'split produced a derived clip')
    assert.equal(splitClip.startMs, 4500)
    const trimmed = timeline.useTimeline.getState().clips.find((c) => c.id === 'clip_1')
    assert.equal(trimmed?.trimStart, 500)
    assert.equal(trimmed?.trimEnd, 1000)
    assert.deepEqual(trimmed?.outTransition, { type: 'crossfade', durationMs: 400 })
    assert.deepEqual(timeline.useTimeline.getState().selectedIds, ['clip_1'])
    assert.ok(timeline.getClipboard() !== null)
    assert.ok(timeline.getStyleClipboard() !== null)
  })

  it('saves through the real main pipeline to disk bytes', async () => {
    const { timeline, project, caption, exp } = stores1
    // Payload replicates HotkeyManager.saveProjectToDisk field-for-field.
    const p = project.useProject.getState()
    const c = caption.useCaption.getState()
    const e = exp.useExport.getState()
    const t = timeline.useTimeline.getState()
    const payload = {
      version: '1.0',
      name: p.name, fps: p.fps, resolution: p.resolution,
      aspectRatio: p.aspectRatio, backgroundColor: p.backgroundColor,
      clips: t.clips, audioTracks: t.audioTracks, textClips: t.textClips,
      tracks: t.tracks, markers: t.markers,
      playheadMs: t.playheadMs, zoom: t.zoom,
      masterVolume: t.masterVolume, loopEnabled: t.loopEnabled,
      captions: { entries: t.textClips, style: c.activeStyle, language: c.language },
      exportPreset: e.preset,
      exportConfig: {
        preset: e.preset, customWidth: e.customWidth, customHeight: e.customHeight,
        upscaleEnabled: e.upscaleEnabled, upscaleAlgorithm: e.upscaleAlgorithm,
        codec: e.codec, qualityPreset: e.qualityPreset,
        bitrateKbps: e.bitrateKbps, bitrateMode: e.bitrateMode,
        exportFrameRange: e.exportFrameRange, audioOnly: e.audioOnly,
        fps: e.fps, hardwareAccel: e.hardwareAccel,
      },
    }
    const v1 = validateProjectFile(payload)
    assert.equal(v1.ok, true, JSON.stringify(v1.errors))
    const normalized = v1.data as NormalizedProjectFile
    const cfg = validateExportConfig((payload as Record<string, unknown>)['exportConfig'])
    assert.equal(cfg.ok, true)
    const usages = [
      ...normalized.clips.map((clip) => ({ path: clip.path, sourceDurationMs: clip.sourceDurationMs })),
      ...normalized.audioTracks.map((track) => ({ path: track.path, sourceDurationMs: track.sourceDurationMs })),
    ]
    const { assets, pathToAssetId } = await buildAssetManifest(usages, projDir)
    const mig = migrateV1ToClipzuStrict(
      normalized, assets, pathToAssetId, 'test-app-1.0', cfg.data as CanonicalExportConfig, []
    )
    assert.equal(mig.ok, true, JSON.stringify(mig.errors))
    const doc = JSON.parse(JSON.stringify(mig.document)) as ClipzuDocument
    assert.equal(validateClipzuFile(doc).ok, true)
    await fs.writeFile(clipzuPath, JSON.stringify(doc, null, 2), 'utf-8')

    // Snapshot expectations captured from LIVE stores (pre-close truth).
    expected = {
      durationMs: recalcTimelineDuration({ clips: t.clips, audioTracks: t.audioTracks, textClips: t.textClips }),
      clips: JSON.parse(JSON.stringify(t.clips)),
      audioTracks: JSON.parse(JSON.stringify(t.audioTracks)),
      textClips: JSON.parse(JSON.stringify(t.textClips)),
      tracks: JSON.parse(JSON.stringify(t.tracks)),
      markers: JSON.parse(JSON.stringify(t.markers)),
      style: structuredClone(c.activeStyle),
      language: c.language,
      exportConfig: JSON.parse(JSON.stringify(cfg.data)),
      meta: { name: p.name, fps: p.fps, resolution: p.resolution, aspectRatio: p.aspectRatio, backgroundColor: p.backgroundColor },
      session: { playheadMs: t.playheadMs, zoom: t.zoom, masterVolume: t.masterVolume, loopEnabled: t.loopEnabled },
    }
    assert.equal(expected.durationMs, 9000)
  })

  it('close→reopen→load restores identical state with zero contamination', async () => {
    assert.ok(expected !== null)
    // CLOSE: drop all modules (process exit). REOPEN: pristine module state.
    const stores2 = freshRenderer()
    assert.equal(stores2.timeline.useTimeline.getState().clips.length, 0)
    assert.equal(stores2.project.useProject.getState().name, 'Untitled Project')

    // LOAD from disk bytes through the real pipeline (main side).
    const raw = JSON.parse(await fs.readFile(clipzuPath, 'utf-8')) as unknown
    const validation = validateClipzuFile(raw)
    assert.equal(validation.ok, true, JSON.stringify(validation.errors))
    const document = validation.data as ClipzuDocument
    const { resolved } = await resolveAssetManifest(document.assets, projDir)
    const data: LoadedProjectFile = {
      version: '2.0',
      name: document.metadata.name,
      fps: document.metadata.fps,
      resolution: { ...document.metadata.resolution },
      aspectRatio: document.metadata.aspectRatio,
      backgroundColor: document.metadata.backgroundColor,
      clips: document.timeline.clips.map((clip) => {
        const { assetId: _a, ...rest } = clip as unknown as Record<string, unknown> & { assetId: string }
        void _a
        return { ...(rest as object), path: resolved.get(clip.assetId) as string }
      }) as LoadedProjectFile['clips'],
      audioTracks: document.timeline.audioTracks.map((track) => {
        const { assetId: _a, ...rest } = track as unknown as Record<string, unknown> & { assetId: string }
        void _a
        return { ...(rest as object), path: resolved.get(track.assetId) as string }
      }) as LoadedProjectFile['audioTracks'],
      textClips: document.timeline.textClips.map((tc) => ({ ...tc })),
      tracks: document.tracks.map((t) => ({ ...t })),
      markers: document.timeline.markers.map((m) => ({ ...m })),
      captions: {
        entries: document.captions.entries.map((tc) => ({ ...tc })),
        style: { ...(document.captions.style as object) } as LoadedProjectFile['captions']['style'],
        language: document.captions.language,
      },
      playheadMs: document.settings.playheadMs,
      zoom: document.settings.zoom,
      masterVolume: document.settings.masterVolume,
      loopEnabled: document.settings.loopEnabled,
      exportConfig: { ...document.exportConfig },
    }

    // Hydration replicates HotkeyManager.loadProjectFromDialog order EXACTLY:
    // RESET first, then restore.
    stores2.timeline.useTimeline.getState().clearTimeline()
    stores2.timeline.clearStyleClipboard()
    stores2.caption.useCaption.getState().resetCaptionSession()
    stores2.exp.useExport.getState().resetExportSession()
    stores2.project.useProject.getState().loadProject({
      name: data.name, fps: data.fps, resolution: data.resolution,
      aspectRatio: data.aspectRatio, backgroundColor: data.backgroundColor,
      projectFilePath: clipzuPath,
    })
    stores2.timeline.useTimeline.getState().loadTimeline({
      clips: data.clips, audioTracks: data.audioTracks, textClips: data.textClips,
      tracks: data.tracks, markers: data.markers,
      playheadMs: data.playheadMs, zoom: data.zoom,
      masterVolume: data.masterVolume, loopEnabled: data.loopEnabled,
    })
    stores2.caption.useCaption.getState().loadCaptions({
      entries: [], style: data.captions.style, language: data.captions.language,
    })
    stores2.exp.useExport.getState().loadExportConfig(data.exportConfig)

    // COMPARE snapshot (task.txt Phase 6 validation list).
    const t2 = stores2.timeline.useTimeline.getState()
    const p2 = stores2.project.useProject.getState()
    const c2 = stores2.caption.useCaption.getState()
    const e2 = stores2.exp.useExport.getState()
    const expct = expected as NonNullable<typeof expected>
    assert.deepEqual(
      t2.clips.map((c) => c.id),
      (expct.clips as Array<{ id: string }>).map((c) => c.id)
    )
    // Timeline ordering: non-decreasing startMs, split clip exactly at 4500.
    const starts = t2.clips.map((c) => c.startMs)
    assert.deepEqual([...starts].sort((a, b) => a - b), starts)
    assert.ok(t2.clips.some((c) => c.id.startsWith('clip_2_split_') && c.startMs === 4500))
    assert.deepEqual(t2.clips.find((c) => c.id === 'clip_1')?.outTransition, { type: 'crossfade', durationMs: 400 })
    assert.deepEqual(t2.clips, expct.clips)
    assert.deepEqual(t2.audioTracks, expct.audioTracks)
    assert.deepEqual(t2.textClips, expct.textClips)
    assert.deepEqual(t2.tracks, expct.tracks)
    assert.deepEqual(t2.markers, expct.markers)
    assert.equal(
      recalcTimelineDuration({ clips: t2.clips, audioTracks: t2.audioTracks, textClips: t2.textClips }),
      expct.durationMs
    )
    assert.deepEqual(t2.clips[1].modifiers, (expct.clips as Array<{ modifiers: unknown }>)[1].modifiers)
    assert.deepEqual(t2.clips[0].keyframes, (expct.clips as Array<{ keyframes: unknown }>)[0].keyframes)
    assert.deepEqual(c2.activeStyle, expct.style)
    assert.equal(c2.language, expct.language)
    assert.deepEqual(
      {
        preset: e2.preset, customWidth: e2.customWidth, customHeight: e2.customHeight,
        upscaleEnabled: e2.upscaleEnabled, upscaleAlgorithm: e2.upscaleAlgorithm,
        codec: e2.codec, qualityPreset: e2.qualityPreset,
        bitrateKbps: e2.bitrateKbps, bitrateMode: e2.bitrateMode,
        exportFrameRange: e2.exportFrameRange, audioOnly: e2.audioOnly,
        fps: e2.fps, hardwareAccel: e2.hardwareAccel,
      },
      expct.exportConfig
    )
    assert.equal(p2.name, (expct.meta as { name: string }).name)
    assert.equal(p2.projectFilePath, clipzuPath)

    // ZERO CONTAMINATION from the pre-close session (fresh modules start
    // clean AND the reset path clears): selection, clipboards, in/out,
    // playback, caption transient, export queue.
    assert.deepEqual(t2.selectedIds, [])
    assert.equal(t2.focusedId, null)
    assert.equal(stores2.timeline.getClipboard(), null)
    assert.equal(stores2.timeline.getStyleClipboard(), null)
    assert.equal(stores2.timeline.getInPoint(), null)
    assert.equal(stores2.timeline.getOutPoint(), null)
    assert.equal(t2.isPlaying, false)
    assert.equal(c2.status, 'idle')
    assert.equal(c2.progress, 0)
    assert.equal(c2.error, null)
    assert.deepEqual(e2.queue, [])
    assert.equal(e2.isExporting, false)
  })
})
