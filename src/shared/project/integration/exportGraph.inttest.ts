/**
 * exportGraph.inttest.ts — Phase 7 shared export graph regression tests.
 *
 * Task.txt Phase 7 validate list: transforms (via FFmpegService application),
 * effects, keyframes, opacity, blend modes, audio settings. The pure graph
 * builder is covered here; FFmpegService applies nodes mechanically.
 *
 * Zero dependencies: node:test + node:assert only. Easing/keyframe/visibility
 * parity against the renderer implementations is asserted numerically so
 * neither side can drift silently.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateExportTrack,
  evaluateExportEasing,
  sampleTrackSegments,
  modifiersToFfmpegFilters,
  blendModeToFfmpeg,
  resolveVideoHidden,
  resolveVideoMuted,
  resolveAudioMuted,
  buildExportGraph,
  MAX_ANIMATED_SEGMENTS,
} from '../../export/exportGraph'
import { applyEasing } from '../../../renderer/effects/utils/easing'
import { evaluateKeyframeTrack } from '../../../renderer/services/KeyframeEvaluator'
import {
  computeEffectiveVideoHidden,
  computeEffectiveVideoMuted,
  computeEffectiveMuted,
} from '../../../renderer/store/useTimeline'
import type {
  CanonicalKeyframeTrack,
  CanonicalModifier,
} from '../projectSchema'

function track(property: string, frames: Array<{ time: number; value: number; easing?: string }>): CanonicalKeyframeTrack {
  return {
    property,
    frames: frames.map((f) => ({
      time: f.time,
      value: f.value,
      easing: (f.easing ?? 'linear') as CanonicalKeyframeTrack['frames'][number]['easing'],
    })),
  }
}

function mod(presetId: string, params: Record<string, number>, extra?: Partial<CanonicalModifier>): CanonicalModifier {
  return {
    id: `m_${presetId}`,
    type: 'effect',
    presetId,
    enabled: true,
    parameters: params,
    keyframes: [],
    version: 1,
    ...extra,
  }
}

describe('export graph — keyframe evaluation parity', () => {
  it('matches renderer easing curves across sample points', () => {
    const easings = [
      'linear', 'easeIn', 'easeOut', 'easeInOut',
      'easeOutBack', 'easeOutExpo', 'easeOutElastic', 'easeOutBounce',
    ]
    for (const easing of easings) {
      for (let i = 0; i <= 20; i++) {
        const t = i / 20
        const expected = applyEasing(easing as Parameters<typeof applyEasing>[0], t)
        const actual = evaluateExportEasing(easing, t)
        assert.ok(
          Math.abs(expected - actual) < 1e-9,
          `${easing}@${t}: renderer=${expected} shared=${actual}`
        )
      }
    }
  })

  it('matches KeyframeEvaluator numeric interpolation incl. hold/edge rules', () => {
    const cases: CanonicalKeyframeTrack[] = [
      track('opacity', [
        { time: 0, value: 0, easing: 'linear' },
        { time: 1000, value: 100, easing: 'easeOut' },
      ]),
      track('level', [
        { time: 200, value: -50, easing: 'easeInOut' },
        { time: 200, value: 25, easing: 'linear' },
        { time: 800, value: 75, easing: 'easeOutBounce' },
      ]),
    ]
    for (const tr of cases) {
      for (const t of [-100, 0, 1, 199, 200, 350, 799, 800, 801, 5000]) {
        const expected = evaluateKeyframeTrack(
          tr as unknown as Parameters<typeof evaluateKeyframeTrack>[0],
          t
        )
        const actual = evaluateExportTrack(tr, t, -999)
        assert.ok(
          Math.abs((expected as number) - actual) < 1e-9,
          `${tr.property}@${t}: renderer=${expected} shared=${actual}`
        )
      }
    }
  })

  it('static tracks collapse to one segment; animated tracks split on keyframes', () => {
    const flat = sampleTrackSegments(track('level', [{ time: 0, value: 10 }]), 3000, 0)
    assert.deepEqual(flat, [{ startMs: 0, endMs: 3000, value: 10 }])
    const anim = sampleTrackSegments(
      track('level', [
        { time: 0, value: 0 },
        { time: 1000, value: 100 },
        { time: 2000, value: 100 },
      ]),
      3000,
      0
    )
    assert.equal(anim.length, 2)
    assert.equal(anim[0].startMs, 0)
    assert.equal(anim[anim.length - 1].endMs, 3000)
    // Hold region merges: [1000,3000] constant 100 -> single segment.
    const tail = anim.filter((s) => s.startMs >= 1000)
    assert.equal(tail.length, 1)
    assert.equal(tail[0].value, 100)
  })

  it('caps segment count for dense tracks', () => {
    const frames = Array.from({ length: 200 }, (_, i) => ({ time: i * 10, value: i }))
    const segs = sampleTrackSegments(track('level', frames), 2000, 0)
    assert.ok(segs.length <= MAX_ANIMATED_SEGMENTS)
    assert.equal(segs[0].startMs, 0)
    assert.equal(segs[segs.length - 1].endMs, 2000)
  })
})

describe('export graph — modifier mapping', () => {
  const cases: Array<[string, Record<string, number>, RegExp]> = [
    ['blur', { amount: 10 }, /^gblur=sigma=5$/],
    ['brightness', { level: 25 }, /^colorchannelmixer=rr=1\.25:gg=1\.25:bb=1\.25$/],
    ['exposure', { level: -40 }, /^colorchannelmixer=rr=0\.6:gg=0\.6:bb=0\.6$/],
    ['contrast', { level: 50 }, /^eq=contrast=1\.5$/],
    ['saturation', { level: -100 }, /^eq=saturation=0$/],
    ['hue-rotate', { angle: 90 }, /^hue=h=90$/],
    ['sepia', { amount: 100 }, /^colorchannelmixer=rr=0\.393:rg=0\.769:rb=0\.189:gr=0\.349:gg=0\.686:gb=0\.168:br=0\.272:bg=0\.534:bb=0\.131$/],
    ['grayscale', { amount: 100 }, /^eq=saturation=0$/],
    ['invert', { amount: 100 }, /^negate$/],
    ['sharpen', { amount: 50 }, /^unsharp=5:5:0\.95:5:5:0\.0$/],
  ]
  for (const [presetId, params, re] of cases) {
    it(`maps static ${presetId} deterministically`, () => {
      const r = modifiersToFfmpegFilters([mod(presetId, params)], 'clip[0]', 3000)
      assert.equal(r.dropped.length, 0, JSON.stringify(r.dropped))
      assert.equal(r.staticFilters.length, 1)
      assert.match(r.staticFilters[0], re)
    })
  }

  it('preserves stack order; skips identity values silently; reports problems loudly', () => {
    const r = modifiersToFfmpegFilters(
      [
        mod('brightness', { level: 0 }),
        mod('contrast', { level: 20 }),
        { ...mod('blur', { amount: 4 }), enabled: false },
        mod('nope-fx', { amount: 1 }),
        mod('invert', { amount: 20 }),
      ],
      'clip[1]',
      1000
    )
    assert.deepEqual(r.staticFilters, ['eq=contrast=1.2'])
    assert.equal(r.dropped.length, 3)
    assert.ok(r.dropped.some((d) => d.includes('disabled')))
    assert.ok(r.dropped.some((d) => d.includes('unknown effect')))
    assert.ok(r.dropped.some((d) => d.includes('partial invert')))
  })

  it('bakes keyframed params into enable-gated segments', () => {
    const animated = mod('brightness', { level: 0 }, {
      keyframes: [track('level', [
        { time: 0, value: 0 },
        { time: 1000, value: 100 },
      ])],
    })
    const r = modifiersToFfmpegFilters([animated], 'clip[2]', 2000)
    assert.equal(r.staticFilters.length, 0)
    assert.ok(r.animatedFilters.length >= 2)
    assert.ok(r.animatedFilters.every((s) => s.filter.startsWith('colorchannelmixer=rr=')))
    assert.equal(r.animatedFilters[0].startMs, 0)
    assert.equal(r.animatedFilters[r.animatedFilters.length - 1].endMs, 2000)
  })

  it('drops animated invert (negate rejects timeline gating) but keeps static', () => {
    // Verified against the real ffmpeg graph parser: `negate:enable=...`
    // is a hard parse error, so baking would produce an un-runnable export.
    const animated = mod('invert', { amount: 100 }, {
      keyframes: [track('amount', [
        { time: 0, value: 100 },
        { time: 1000, value: 100 },
      ])],
    })
    const r = modifiersToFfmpegFilters([animated], 'clip[3]', 2000)
    assert.deepEqual(r.staticFilters, ['negate'])
    assert.deepEqual(r.animatedFilters, [])
    assert.ok(r.dropped.some((d) => d.includes('timeline gating')), JSON.stringify(r.dropped))
  })
})

describe('export graph — blend modes', () => {
  it('maps every timeline blend mode; normal -> null (overlay path)', () => {
    const expected: Record<string, string | null> = {
      normal: null,
      multiply: 'multiply',
      screen: 'screen',
      overlay: 'overlay',
      darken: 'darken',
      lighten: 'lighten',
      'color-dodge': 'addition',
      'color-burn': 'burn',
      'soft-light': 'softlight',
      difference: 'difference',
    }
    for (const [mode, ffmpeg] of Object.entries(expected)) {
      assert.equal(blendModeToFfmpeg(mode), ffmpeg, mode)
    }
    assert.equal(blendModeToFfmpeg('bogus'), null)
    assert.equal(blendModeToFfmpeg(undefined), null)
  })
})

describe('export graph — visibility/mute parity with useTimeline SSOT', () => {
  it('matches computeEffectiveVideoHidden/VideoMuted/Muted exactly', () => {
    const lanes = [
      { kind: 'video', index: 0, muted: false, hidden: false, solo: false },
      { kind: 'video', index: 1, muted: true, hidden: false, solo: false },
      { kind: 'audio', index: 0, muted: false, hidden: false, solo: true },
      { kind: 'audio', index: 1, muted: false, hidden: false, solo: false },
    ]
    for (const trackIndex of [0, 1, 5]) {
      assert.equal(
        resolveVideoHidden(trackIndex, lanes),
        computeEffectiveVideoHidden(trackIndex, lanes as never)
      )
      for (const muted of [false, true]) {
        assert.equal(
          resolveVideoMuted(muted, trackIndex, lanes),
          computeEffectiveVideoMuted(muted, trackIndex, lanes as never)
        )
        assert.equal(
          resolveAudioMuted(muted, trackIndex, lanes),
          computeEffectiveMuted(muted, trackIndex, lanes as never)
        )
      }
    }
    // Solo video lane suppresses the other lane.
    const soloVideo = [
      { kind: 'video', index: 0, muted: false, hidden: false, solo: false },
      { kind: 'video', index: 1, muted: false, hidden: false, solo: true },
    ]
    assert.equal(resolveVideoHidden(0, soloVideo), true)
    assert.equal(resolveVideoHidden(1, soloVideo), false)
  })
})

describe('export graph — buildExportGraph', () => {
  const lanes = [
    { kind: 'video', index: 0, muted: false, hidden: false, solo: false },
    { kind: 'video', index: 1, muted: false, hidden: false, solo: false },
    { kind: 'audio', index: 0, muted: false, hidden: false, solo: false },
  ]
  const baseClip = {
    path: 'a.mp4',
    startMs: 0,
    durationMs: 4000,
    trimStart: 0,
    speed: 1,
    volume: 1,
    muted: false,
    hasAudio: true,
    trackIndex: 0,
    transform: null,
  }

  it('resolves effects+blend+transition windows end to end', () => {
    const graph = buildExportGraph({
      lanes,
      clips: [
        {
          ...baseClip,
          modifiers: [mod('contrast', { level: 20 })],
          outTransition: { type: 'crossfade', durationMs: 500 },
        },
        {
          ...baseClip,
          path: 'b.mp4',
          startMs: 3600,
          durationMs: 2000,
          trackIndex: 0,
          blendMode: 'screen',
          modifiers: [mod('blur', { amount: 6 })],
        },
      ],
      audioTracks: [],
    })
    assert.equal(graph.clips.length, 2)
    assert.deepEqual(graph.clips[0].staticFilters, ['eq=contrast=1.2'])
    assert.deepEqual(graph.clips[1].staticFilters, ['gblur=sigma=3'])
    // Track 0 clips never take the blend path (matches Preview: blend only
    // effective above index 0).
    assert.equal(graph.clips[1].blend, null)
    assert.equal(graph.clips[0].transitionFadeOutMs, 500)
    assert.equal(graph.clips[1].transitionFadeInMs, 400)
    assert.deepEqual(graph.dropped, [])
  })

  it('applies blend substitution above track 0; warns on unmapped transitions', () => {
    const graph = buildExportGraph({
      lanes,
      clips: [
        {
          ...baseClip,
          trackIndex: 1,
          blendMode: 'multiply',
          outTransition: { type: 'bogus-transition', durationMs: 300 },
        },
      ],
      audioTracks: [],
    })
    assert.equal(graph.clips[0].blend, 'multiply')
    assert.equal(graph.clips[0].transitionFadeOutMs, 300)
    assert.ok(graph.warnings.some((w) => w.includes('bogus-transition')))
  })

  it('wipe-left is a plain opacity fade (Preview parity) — no warning', () => {
    const graph = buildExportGraph({
      lanes,
      clips: [
        { ...baseClip, outTransition: { type: 'wipe-left', durationMs: 300 } },
        { ...baseClip, path: 'b.mp4', startMs: 3800, durationMs: 2000, trackIndex: 0 },
      ],
      audioTracks: [],
    })
    assert.equal(graph.clips[0].transitionFadeOutMs, 300)
    assert.equal(graph.clips[1].transitionFadeInMs, 200)
    assert.equal(graph.clips[0].slideOut, null)
    assert.equal(graph.clips[0].zoomOut, null)
    assert.ok(!graph.warnings.some((w) => w.includes('wipe-left')))
  })

  it('resolves zoom transitions into scale geometry + full fade', () => {
    const graph = buildExportGraph({
      lanes,
      clips: [
        { ...baseClip, outTransition: { type: 'zoom-in', durationMs: 500 } },
        { ...baseClip, path: 'b.mp4', startMs: 3600, durationMs: 2000, trackIndex: 0 },
      ],
      audioTracks: [],
    })
    assert.deepEqual(graph.clips[0].zoomOut, {
      fromScale: 1, toScale: 1.5, startMs: 3500, endMs: 4000,
    })
    assert.equal(graph.clips[0].transitionFadeOutMs, 500)
    assert.deepEqual(graph.clips[1].zoomIn, {
      fromScale: 1.5, toScale: 1, startMs: 0, endMs: 400,
    })
    assert.equal(graph.clips[1].transitionFadeInMs, 400)
    assert.equal(graph.clips[0].slideOut, null)
  })

  it('zoom-out uses the Preview 0.7 scale endpoints', () => {
    const graph = buildExportGraph({
      lanes,
      clips: [
        { ...baseClip, outTransition: { type: 'zoom-out', durationMs: 500 } },
        { ...baseClip, path: 'b.mp4', startMs: 3800, durationMs: 2000, trackIndex: 0 },
      ],
      audioTracks: [],
    })
    assert.equal(graph.clips[0].zoomOut?.toScale, 0.7)
    assert.equal(graph.clips[1].zoomIn?.fromScale, 0.7)
  })

  it('resolves slide transitions into animated overlay geometry', () => {
    const graph = buildExportGraph({
      lanes,
      clips: [
        {
          ...baseClip,
          outTransition: { type: 'slide-left', durationMs: 500 },
        },
        { ...baseClip, path: 'b.mp4', startMs: 3600, durationMs: 2000, trackIndex: 0 },
      ],
      audioTracks: [],
    })
    // Outgoing: 0 -> -1 across the last 500ms of a 4000ms clip.
    assert.deepEqual(graph.clips[0].slideOut, {
      axis: 'x', fromFrac: 0, toFrac: -1, startMs: 3500, endMs: 4000,
    })
    // No alpha fade for slides.
    assert.equal(graph.clips[0].transitionFadeOutMs, 0)
    // Incoming: +1 -> 0 across the 400ms overlap (from 3600 to clip end 4000).
    assert.deepEqual(graph.clips[1].slideIn, {
      axis: 'x', fromFrac: 1, toFrac: 0, startMs: 0, endMs: 400,
    })
    assert.equal(graph.clips[1].transitionFadeInMs, 0)
    assert.ok(!graph.warnings.some((w) => w.includes('slide-left')))
  })

  it('resolves vertical slide axis (slide-up) correctly', () => {
    const graph = buildExportGraph({
      lanes,
      clips: [
        { ...baseClip, outTransition: { type: 'slide-up', durationMs: 400 } },
        { ...baseClip, path: 'b.mp4', startMs: 3800, durationMs: 2000, trackIndex: 0 },
      ],
      audioTracks: [],
    })
    assert.equal(graph.clips[0].slideOut?.axis, 'y')
    assert.equal(graph.clips[0].slideOut?.toFrac, -1)
    assert.equal(graph.clips[1].slideIn?.fromFrac, 1)
  })

  it('bakes clip opacity keyframes; excludes muted/hidden audio', () => {
    const mutedAudioLanes = lanes.map((l) =>
      l.kind === 'audio' && l.index === 0 ? { ...l, muted: true } : l
    )
    const graph = buildExportGraph({
      lanes: mutedAudioLanes,
      clips: [
        {
          ...baseClip,
          transform: {
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
            cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
          },
          keyframes: [track('opacity', [
            { time: 0, value: 0 },
            { time: 2000, value: 100 },
            { time: 4000, value: 100 },
          ])],
        },
      ],
      audioTracks: [
        { path: 'm.mp3', startMs: 0, volume: 0.8, muted: false, trackIndex: 0 },
      ],
    })
    // [0,2000] ramps 0->1 (midpoint 0.5); [2000,4000] holds 1.
    assert.deepEqual(graph.clips[0].animatedOpacity, [
      { startMs: 0, endMs: 2000, value: 0.5 },
      { startMs: 2000, endMs: 4000, value: 1 },
    ])
    assert.equal(graph.clips[0].includeNativeAudio, true)
    assert.equal(graph.audioTracks[0].audible, false)
  })

  it('volume automation keyframes bake into segments', () => {
    const graph = buildExportGraph({
      lanes,
      clips: [],
      audioTracks: [
        {
          path: 'm.mp3', startMs: 0, volume: 1, muted: false, trackIndex: 0,
          durationMs: 4000,
          keyframes: [track('volume', [
            { time: 0, value: 1 },
            { time: 2000, value: 0.5 },
            { time: 4000, value: 0 },
          ])],
        },
      ],
    })
    // 3 keyframes -> 2 segments; linear midpoint values 0.75 / 0.25.
    assert.deepEqual(graph.audioTracks[0].animatedVolume, [
      { startMs: 0, endMs: 2000, value: 0.75 },
      { startMs: 2000, endMs: 4000, value: 0.25 },
    ])
  })
})
