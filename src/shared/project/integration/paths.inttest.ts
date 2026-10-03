/**
 * paths.inttest.ts — file-read allowlist tests (Phase 6, P6.2 / audit S2).
 *
 * Pure shared predicate (no Electron, no fs): normalization, directory
 * containment, audio-only serving, and the full gate matrix — including
 * traversal (`..\\..`), UNC, and NUL attacks, which must fail CLOSED with
 * the typed FILE_ACCESS_DENIED code (never an exception, never a buffer).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeAccessPath,
  isPathWithinDir,
  isServableAudioPath,
  checkFileReadAccess,
  FILE_ACCESS_DENIED,
  type FileAccessContext,
} from '../../security/paths'

const CTX: FileAccessContext = {
  allowedFiles: ['D:\\work\\media\\voice.mp3', 'D:\\work\\media\\MUSIC.MP3'],
  allowedDirs: ['C:\\app\\assets', 'C:\\app\\data'],
}

describe('phase 6 — file-read allowlist (S2)', () => {
  describe('normalization', () => {
    it('folds slashes, drops dots, resolves inner .., lowercases drives', () => {
      assert.equal(normalizeAccessPath('D:/work//media/./voice.mp3'), 'd:\\work\\media\\voice.mp3')
      assert.equal(normalizeAccessPath('D:\\work\\sub\\..\\media\\a.mp3'), 'd:\\work\\media\\a.mp3')
      assert.equal(normalizeAccessPath('C:'), 'c:\\')
    })

    it('rejects unusable paths with null (never throws)', () => {
      assert.equal(normalizeAccessPath(''), null)
      assert.equal(normalizeAccessPath('   '), null)
      assert.equal(normalizeAccessPath(null), null)
      assert.equal(normalizeAccessPath(42), null)
      assert.equal(normalizeAccessPath('D:\\ok.mp3\0evil'), null)
      // Escapes past the anchor — all rejected.
      assert.equal(normalizeAccessPath('..\\secret.mp3'), null)
      assert.equal(normalizeAccessPath('D:\\..\\secret.mp3'), null)
      assert.equal(normalizeAccessPath('D:\\a\\..\\..\\secret.mp3'), null)
      assert.equal(normalizeAccessPath('\\\\srv\\share\\..\\secret.mp3'), null)
    })

    it('preserves UNC anchors and resolves within the share', () => {
      assert.equal(
        normalizeAccessPath('\\\\srv\\share\\media\\a.mp3'),
        '\\\\srv\\share\\media\\a.mp3'
      )
      assert.equal(
        normalizeAccessPath('\\\\srv\\share\\media\\..\\b.mp3'),
        '\\\\srv\\share\\b.mp3'
      )
    })
  })

  describe('containment', () => {
    it('matches inside-or-equal, case-insensitively, with boundary care', () => {
      assert.equal(isPathWithinDir('C:\\app\\assets\\sfx\\a.mp3', 'C:\\app\\assets'), true)
      assert.equal(isPathWithinDir('c:\\APP\\ASSETS', 'C:\\app\\assets'), true)
      assert.equal(isPathWithinDir('C:\\app\\assets2\\a.mp3', 'C:\\app\\assets'), false)
      assert.equal(isPathWithinDir('C:\\app\\asset\\a.mp3', 'C:\\app\\assets'), false)
      assert.equal(isPathWithinDir('C:\\other\\a.mp3', 'C:\\app\\assets'), false)
    })
  })

  describe('audio-only serving', () => {
    it('serves audio extensions (case-insensitive), nothing else', () => {
      for (const ext of ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a']) {
        assert.equal(isServableAudioPath(`D:\\m\\a.${ext}`), true, ext)
        assert.equal(isServableAudioPath(`D:\\m\\a.${ext.toUpperCase()}`), true, ext)
      }
      for (const f of ['D:\\m\\a.mp4', 'D:\\m\\a.png', 'D:\\m\\a.srt', 'D:\\m\\a']) {
        assert.equal(isServableAudioPath(f), false, f)
      }
      assert.equal(isServableAudioPath(''), false)
    })
  })

  describe('gate matrix', () => {
    it('allows vouched files (case-insensitive) and voucher dirs', () => {
      const a = checkFileReadAccess('D:\\work\\media\\voice.mp3', CTX)
      assert.equal(a.ok, true)
      const b = checkFileReadAccess('d:\\WORK\\MEDIA\\music.mp3', CTX)
      assert.equal(b.ok, true)
      const c = checkFileReadAccess('C:\\app\\assets\\sfx\\pop-1.mp3', CTX)
      assert.equal(c.ok, true)
      const d = checkFileReadAccess('C:\\app\\data\\waveforms\\x.peaks.mp3', CTX)
      assert.equal(d.ok, true)
      // Any audio kind inside a voucher dir is servable (caches, sfx).
      const e = checkFileReadAccess('C:\\app\\assets\\sfx\\pop-1.wav', CTX)
      assert.equal(e.ok, true)
    })

    it('fails closed with the typed code: traversal, UNC escape, NUL, wrong kind, unknown', () => {
      const cases: Array<[unknown, string]> = [
        ['D:\\work\\media\\..\\..\\secret.mp3', 'escapes past the anchor'],
        ['D:\\work\\media\\voice.mp3\\..\\..\\secret.mp3', 'escapes past the anchor'],
        ['\\\\srv\\share\\..\\secret.mp3', 'escapes past the anchor'],
        ['D:\\work\\media\\voice.mp3\0', 'NUL'],
        ['', 'empty'],
        ['D:\\elsewhere\\track.wav', 'audio but unknown file and dir'],
        ['D:\\work\\media\\voice.mp4', 'video is not servable'],
        ['C:\\Windows\\System32\\evil.mp3', 'audio but outside allowlist'],
        ['\\\\evil\\share\\x.mp3', 'UNC outside allowlist'],
      ]
      for (const [input, why] of cases) {
        const verdict = checkFileReadAccess(input, CTX)
        assert.equal(verdict.ok, false, why)
        if (!verdict.ok) {
          assert.equal(verdict.code, FILE_ACCESS_DENIED, why)
          assert.ok(verdict.reason.length > 0, why)
        }
      }
      // A vouched VIDEO path is still not servable (kind gate is independent).
      const videoCtx: FileAccessContext = { allowedFiles: ['D:\\v\\a.mp4'], allowedDirs: [] }
      const v = checkFileReadAccess('D:\\v\\a.mp4', videoCtx)
      assert.equal(v.ok, false)
      if (!v.ok) assert.equal(v.code, FILE_ACCESS_DENIED)
    })
  })
})
