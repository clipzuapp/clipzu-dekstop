/**
 * utils.inttest.ts — Phase 8/9 shared utility regression tests.
 *
 * Covers: UTF-8 policy helpers (encoding.ts), canonical file URLs
 * (fileUrl.ts), bounded parallelism (concurrency.ts), SRT import hardening
 * (BOM/CR), and ffmpeg text helpers (ffmpegText.ts).
 *
 * Zero dependencies: node:test + node:assert only.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripBOM,
  normalizeLineEndings,
  normalizeImportedText,
  normalizeNFC,
  utf8ByteLength,
  isCleanUtf8,
} from './encoding'
import { toFileUrl, fromFileUrl, isFileUrl } from './fileUrl'
import { createLimiter, mapWithLimit, MEDIA_FANOUT_LIMIT } from './concurrency'
import { parseSRT } from './srt'
import {
  escapeFilterPath,
  formatStderrMessage,
  classifyFfmpegError,
  buildFfmpegError,
  withEnableWindow,
} from '../export/ffmpegText'

describe('encoding policy helpers', () => {
  it('strips a leading BOM exactly once', () => {
    assert.equal(stripBOM('﻿hello'), 'hello')
    assert.equal(stripBOM('hello'), 'hello')
    assert.equal(stripBOM(''), '')
  })

  it('normalizes CRLF and lone CR to LF', () => {
    assert.equal(normalizeLineEndings('a\r\nb\rc\nd'), 'a\nb\nc\nd')
  })

  it('normalizeImportedText strips BOM and CRLF together', () => {
    assert.equal(normalizeImportedText('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n'), '1\n00:00:01,000 --> 00:00:02,000\nHi\n')
  })

  it('utf8ByteLength counts bytes, not UTF-16 units (CJK 3x, emoji 4x)', () => {
    assert.equal(utf8ByteLength('hello'), 5)
    assert.equal(utf8ByteLength('你好'), 6)
    assert.equal(utf8ByteLength('🎬'), 4)
    assert.ok(utf8ByteLength('你好'.repeat(1000)) > '你好'.repeat(1000).length)
  })

  it('isCleanUtf8 detects replacement characters from bad decodes', () => {
    const good = new TextEncoder().encode('Hello 你好 🎬')
    assert.equal(isCleanUtf8(good), true)
    // 0xE4 0xB8 0xAD is 你; truncating mid-sequence decodes to U+FFFD.
    assert.equal(isCleanUtf8(Uint8Array.of(0xe4, 0xb8)), false)
  })

  it('normalizeNFC unifies macOS NFD and Windows NFC spellings', () => {
    const nfd = 'é'.normalize('NFD')
    const nfc = 'é'.normalize('NFC')
    assert.notEqual(nfd, nfc)
    assert.equal(normalizeNFC(nfd), normalizeNFC(nfc))
  })
})

describe('canonical file URLs', () => {
  it('round-trips POSIX, Windows, and special-character paths', () => {
    const cases = [
      '/home/user/My Video/file one.mp4',
      'E:\\Media\\你好\\clip #1 & more 🎬.mp4',
      '/tmp/a?b#c[d].mp4',
      'C:\\100%\\done.mp4',
    ]
    for (const p of cases) {
      const url = toFileUrl(p)
      assert.ok(url.startsWith('file://'), url)
      // No raw spaces, '#', '?', or backslashes may survive.
      assert.ok(!url.includes(' ') && !url.includes('#') && !url.includes('?') && !url.includes('\\'), url)
      const back = fromFileUrl(url)
      assert.ok(back !== null)
      assert.equal(back!.replace(/\//g, '/'), p.replace(/\\/g, '/'))
    }
  })

  it('passes http(s) URLs through and rejects them on decode', () => {
    assert.equal(toFileUrl('https://cdn.example/x.mp4'), 'https://cdn.example/x.mp4')
    assert.equal(fromFileUrl('https://cdn.example/x.mp4'), null)
    assert.equal(isFileUrl('file:///x'), true)
    assert.equal(isFileUrl('https://x'), false)
  })

  it('encodes # ? & that encodeURI would leave raw (old MediaPanel bug)', () => {
    const url = toFileUrl('/v/a #1 & b?.mp4')
    assert.ok(url.includes('%23') && url.includes('%3F') && url.includes('%26'), url)
  })
})

describe('bounded parallelism', () => {
  it('never exceeds the ceiling and preserves order', async () => {
    let inFlight = 0
    let maxSeen = 0
    const results = await mapWithLimit(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (n) => {
        inFlight += 1
        maxSeen = Math.max(maxSeen, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight -= 1
        return n * 2
      }
    )
    assert.equal(maxSeen, 4)
    assert.deepEqual(results, Array.from({ length: 20 }, (_, i) => i * 2))
  })

  it('a rejection propagates but the limiter keeps serving later tasks', async () => {
    const limit = createLimiter(2)
    await assert.rejects(limit(() => Promise.reject(new Error('boom'))), /boom/)
    assert.equal(await limit(() => Promise.resolve('alive')), 'alive')
    assert.equal(await limit(() => Promise.resolve('alive2')), 'alive2')
  })

  it('default media fan-out ceiling is sane', () => {
    assert.ok(MEDIA_FANOUT_LIMIT >= 2 && MEDIA_FANOUT_LIMIT <= 8)
  })
})

describe('SRT import hardening', () => {
  it('parses BOM + CRLF files without mangling text or timing', () => {
    const entries = parseSRT('﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello 你好 🎬\r\n\r\n2\r\n00:00:03.000 --> 00:00:04.000\r\nSecond\r\n')
    assert.equal(entries.length, 2)
    assert.equal(entries[0].startMs, 1000)
    assert.equal(entries[0].endMs, 2500)
    assert.equal(entries[0].text, 'Hello 你好 🎬')
    assert.equal(entries[1].startMs, 3000)
  })

  it('ignores stray carriage returns inside multi-line text', () => {
    const entries = parseSRT('1\n00:00:01,000 --> 00:00:02,000\nline one\r\nline two\n')
    assert.equal(entries.length, 1)
    assert.ok(!entries[0].text.includes('\r'))
  })
})

describe('ffmpeg text helpers', () => {
  it('escapes Windows paths, colons, and quotes; passes CJK/emoji through', () => {
    assert.equal(
      escapeFilterPath("E:\\Media\\你好\\it's 🎬.ass"),
      "E\\:/Media/你好/it\\'s 🎬.ass"
    )
    assert.equal(escapeFilterPath('/home/u/a b.mp4'), '/home/u/a b.mp4')
  })

  it('bounds long stderr to head+tail', () => {
    const long = `START-${'x'.repeat(2000)}-END`
    const msg = formatStderrMessage(long)
    assert.ok(msg.length < long.length)
    assert.ok(msg.startsWith('START-'))
    assert.ok(msg.endsWith('-END'))
    assert.equal(formatStderrMessage('short'), 'short')
  })

  it('classifies known failures and builds prefixed errors', () => {
    assert.match(classifyFfmpegError('foo\nNo such file or directory\nbar')!, /No such file/)
    assert.equal(classifyFfmpegError('total mystery'), null)
    assert.match(buildFfmpegError(1, 'moov atom not found').message, /moov atom not found/)
  })

  it('appends absolute-timeline enable windows deterministically', () => {
    assert.equal(
      withEnableWindow('eq=brightness=0.25', 1500, 2500),
      "eq=brightness=0.25:enable='between(t,1.500,2.500)'"
    )
  })
})
