/**
 * fuzz.inttest.ts — adversarial-input hardening tests (Phase 6, P6.4).
 *
 * Threat model: fully offline app — the attacker is a MALICIOUS FILE
 * (foreign .srt, oversized project, corrupt .clipzu bytes), not a remote
 * peer. Every case asserts the same contract: LOUD typed rejection (ok:false
 * with structured errors) or graceful degradation — never a throw, never a
 * hang. Each case carries an explicit wall-clock budget.
 *
 * Pure schema/parser level (the exact gate project.handler loads through).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseSRT } from '../../utils/srt'
import {
  validateProjectFile,
  validateClipzuFile,
} from '../projectSchema'

/** Wall-clock budget guard: returns elapsed ms, asserting under budget. */
function budget<T>(label: string, maxMs: number, fn: () => T): { result: T; elapsedMs: number } {
  const t0 = performance.now()
  const result = fn()
  const elapsedMs = performance.now() - t0
  assert.ok(elapsedMs < maxMs, `${label} took ${elapsedMs.toFixed(0)}ms (budget ${maxMs}ms)`)
  return { result, elapsedMs }
}

function clip(i: number): Record<string, unknown> {
  return {
    id: `clip_${i}`, path: `/media/shot${i % 7}.mp4`, startMs: i * 100,
    sourceDurationMs: 5000, durationMs: 3000, trackIndex: 0,
    trimStart: 0, trimEnd: 2000, name: `Clip ${i}`, hasAudio: true,
    transform: {
      x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1,
      cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0,
    },
    speed: 1, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0,
  }
}

function payloadWithClips(n: number): Record<string, unknown> {
  const clips = Array.from({ length: n }, (_, i) => clip(i))
  return {
    version: '1.0', name: 'Fuzz', fps: 30,
    resolution: { width: 1920, height: 1080 }, aspectRatio: '16:9', backgroundColor: '#000000',
    clips, audioTracks: [], textClips: [],
    tracks: [
      { id: 'track_v0', index: 0, name: 'Video 1', kind: 'video', muted: false, locked: false, hidden: false, solo: false },
    ],
    markers: [], exportPreset: 'youtube',
    captions: {
      entries: [], style: {
        fontFamily: 'Inter', fontSize: 48, fontWeight: 700, color: '#ffffff',
        strokeColor: '#000000', strokeWidth: 1, bgColor: '#000000', bgOpacity: 0.5,
        alignment: 'center', position: 'bottom', x: 50, y: 75, rotation: 0, scale: 1,
        animation: 'pop', captionMode: 'full-phrase', revealFadeMs: 0,
      }, language: 'en',
    },
    playheadMs: 0, zoom: 1, masterVolume: 1, loopEnabled: false,
    exportConfig: {
      preset: 'youtube', customWidth: 1920, customHeight: 1080,
      upscaleEnabled: false, upscaleAlgorithm: 'lanczos', codec: 'h264', qualityPreset: 'slow',
      bitrateKbps: 8000, bitrateMode: 'cbr', exportFrameRange: null,
      audioOnly: false, fps: 30, hardwareAccel: false,
    },
  }
}

describe('phase 6 — adversarial input hardening (fuzz gate)', () => {
  describe('malformed SRT (story-39 class)', () => {
    it('drops malformed blocks, keeps apostrophes, zero negative durations', () => {
      const { result: entries } = budget('malformed SRT parse', 1000, () => parseSRT(
        '1\n00:00:01,000 --> 00:00:02,000\nIt\'s fine\n\n' +
        '2\nnot-a-timestamp\nshouting.\n\n' +
        '3\n00:00:05,000 --> 00:00:03,000\nbackwards\n\n' +
        '4\n00:00:06.500 --> 00:00:07,000\nVTT separator ok\n\n' +
        '5\n00:00:08,000 --> 00:00:08,000\nzero length\n\n' +
        '6\n Enterprise --> nonsense \nno timing at all\n'
      ))
      const texts = entries.map((e) => e.text)
      assert.ok(texts.includes("It's fine"))
      assert.ok(texts.includes('VTT separator ok'))
      assert.ok(!texts.includes('shouting.'))
      assert.ok(!texts.includes('no timing at all'))
      // Backwards entry dropped at parse time (P6.4); zero-length kept.
      assert.ok(!texts.includes('backwards'))
      assert.ok(texts.includes('zero length'))
      assert.equal(entries.filter((e) => e.endMs < e.startMs).length, 0)
    })

    it('10k-entry SRT parses in budget without growth blowup', () => {
      const blocks: string[] = []
      for (let i = 0; i < 10000; i++) {
        const s = i * 2
        const h = String(Math.floor(s / 3600)).padStart(2, '0')
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
        const sec = String(s % 60).padStart(2, '0')
        blocks.push(`${i + 1}\n${h}:${m}:${sec},000 --> ${h}:${m}:${String((s + 1) % 60).padStart(2, '0')},000\nword ${i}\n`)
      }
      const { result: entries, elapsedMs } = budget('10k SRT parse', 5000, () => parseSRT(blocks.join('\n')))
      assert.equal(entries.length, 10000)
      assert.ok(elapsedMs < 5000)
    })
  })

  describe('oversized projects', () => {
    it('2000-clip payload validates in budget (no hangs, no OOM-shaped blowup)', () => {
      const payload = payloadWithClips(2000)
      const { result } = budget('2000-clip validate', 10000, () => validateProjectFile(payload))
      assert.equal(result.ok, true, JSON.stringify((result as { errors?: unknown }).errors))
    })
  })

  describe('corrupt .clipzu bytes', () => {
    function corruptDoc(): Record<string, unknown> {
      return {
        version: '2.0',
        metadata: { name: 'X', fps: 30, resolution: { width: 1920, height: 1080 }, aspectRatio: '16:9', backgroundColor: '#000000' },
        timeline: { clips: [], audioTracks: [], textClips: [], markers: [] },
        assets: [],
        tracks: [],
        captions: { entries: [], language: 'en' },
        settings: { playheadMs: 0, zoom: 1, masterVolume: 1, loopEnabled: false },
        exportConfig: {
          preset: 'youtube', customWidth: 1920, customHeight: 1080,
          upscaleEnabled: false, upscaleAlgorithm: 'lanczos', codec: 'h264', qualityPreset: 'slow',
          bitrateKbps: 8000, bitrateMode: 'cbr', exportFrameRange: null,
          audioOnly: false, fps: 30, hardwareAccel: false,
        },
      }
    }

    it('every corruption class rejects loudly with structured errors (never throws)', () => {
      const cases: Array<[string, unknown]> = [
        ['empty file', ''],
        ['whitespace', '   \n  '],
        ['truncated JSON', '{"version": "2.0", "meta'],
        ['valid JSON, wrong shape', { hello: 'world' }],
        ['wrong version', { ...corruptDoc(), version: '9.9' }],
        ['null document', null],
        ['array document', []],
        ['BOM + garbage', '﻿{nope'],
        ['clips not an array', { ...corruptDoc(), timeline: { clips: 'x' } }],
      ]
      for (const [label, doc] of cases) {
        const parsed: unknown = typeof doc === 'string'
          ? (() => { try { return JSON.parse(doc) as unknown } catch { return { __parseFailed: true } } })()
          : doc
        const { result } = budget(`corrupt case: ${label}`, 2000, () =>
          validateClipzuFile(parsed === undefined ? null : parsed)
        )
        assert.equal(result.ok, false, label)
        assert.ok(
          Array.isArray((result as { errors?: unknown }).errors) &&
          ((result as { errors?: unknown[] }).errors as unknown[]).length > 0,
          `${label} must carry structured errors`
        )
      }
    })
  })
})
