/**
 * model.inttest.ts — first-run model downloader tests (Phase 5, P5.2).
 *
 * The network surface is a localhost HTTP server (range-capable), so no
 * external traffic is needed: full download + hash verify, checksum-mismatch
 * fail-closed (partial deleted), resume from `.part` (single Range fetch),
 * no-Range server restart, abort semantics, insecure-URL refusal, and the
 * installed-model fast path. Catalog pins exact expected bytes.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUNDLED_MODEL, MEDIA_RUNTIME_VERSION, WINDOWS_MEDIA_RUNTIME, type ModelSpec } from '../../modelCatalog'
import { downloadModel, ModelDownloadError } from '../../../main/services/ModelDownloader'
import { hasMediaRuntime, installMediaRuntimeArchive, mediaRuntimeDirectory, validateInstalledMediaRuntime } from '../../../main/services/MediaRuntimeInstaller'

let workDir = ''
let server: Server | null = null
let serverUrl = ''
/** Bytes the test server serves (deterministic, hash-known). */
let served: Buffer = Buffer.alloc(0)
/** Range requests observed by the server. */
let seenRanges: Array<string | undefined> = []
/** When true the server ignores Range (always 200 full body). */
let ignoreRange = false
/** When > 0, the server drips this many bytes per 20ms tick (abort tests). */
let dripChunk = 0
let range416 = false
let badContentRange = false
let unavailableResponses = 0
let droppedConnections = 0

function sha(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex')
}

function specFor(bytes: Buffer, fileName: string): ModelSpec {
  return {
    fileName,
    url: `${serverUrl}/model.bin`,
    sha256: sha(bytes),
    sizeBytes: bytes.length,
    label: 'test model',
  }
}

function serve(req: IncomingMessage, res: ServerResponse): void {
  const range = req.headers.range as string | undefined
  seenRanges.push(range)
  if (req.url === '/redirect') {
    res.writeHead(302, { Location: 'model.bin' })
    res.end()
    return
  }
  if (unavailableResponses > 0) {
    unavailableResponses -= 1
    res.writeHead(503)
    res.end('try again')
    return
  }
  if (droppedConnections > 0) {
    droppedConnections -= 1
    req.socket.destroy()
    return
  }
  if (dripChunk > 0) {
    // Slow drip: deterministic mid-stream abort window.
    res.writeHead(200, { 'Content-Length': served.length, 'Accept-Ranges': 'bytes' })
    let pos = 0
    const tick = (): void => {
      if (pos >= served.length || res.destroyed) {
        res.end()
        return
      }
      const end = Math.min(pos + dripChunk, served.length)
      res.write(served.subarray(pos, end))
      pos = end
      setTimeout(tick, 20)
    }
    tick()
    return
  }
  if (range && range416) {
    res.writeHead(416, { 'Content-Range': `bytes */${served.length}` })
    res.end()
    return
  }
  if (!ignoreRange && range) {
    const m = range.match(/bytes=(\d+)-/)
    const start = m ? parseInt(m[1], 10) : 0
    if (start >= served.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${served.length}` })
      res.end()
      return
    }
    const slice = served.subarray(start)
    res.writeHead(206, {
      'Content-Range': badContentRange ? `bytes 0-${served.length - 1}/${served.length}` : `bytes ${start}-${served.length - 1}/${served.length}`,
      'Content-Length': slice.length,
      'Accept-Ranges': 'bytes',
    })
    res.end(slice)
    return
  }
  res.writeHead(200, { 'Content-Length': served.length, 'Accept-Ranges': 'bytes' })
  res.end(served)
}

describe('phase 5 — first-run model downloader (P5.2)', () => {
  before(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'clipzu-model-'))
    served = Buffer.from(Array.from({ length: 120_000 }, (_, i) => i % 251))
    server = createServer(serve)
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const addr = server?.address()
    const port = typeof addr === 'object' && addr !== null ? (addr as { port: number }).port : 0
    serverUrl = `http://127.0.0.1:${port}`
  })

  after(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    await fs.rm(workDir, { recursive: true, force: true })
  })

  it('catalog pins the exact proven bytes (url + size + sha256)', () => {
    assert.equal(BUNDLED_MODEL.fileName, 'ggml-small-q8_0.bin')
    assert.ok(BUNDLED_MODEL.url.startsWith('https://huggingface.co/ggerganov/whisper.cpp/'))
    assert.match(BUNDLED_MODEL.sha256, /^[0-9a-f]{64}$/)
    assert.ok(BUNDLED_MODEL.sizeBytes > 100_000_000)
  })

  it('pins the media runtime source, version, checksum, and bounded archive size', () => {
    assert.equal(MEDIA_RUNTIME_VERSION, '8.1.2')
    assert.match(WINDOWS_MEDIA_RUNTIME.url, /^https:\/\/github\.com\/GyanD\/codexffmpeg\/releases\/download\/8\.1\.2\//)
    assert.match(WINDOWS_MEDIA_RUNTIME.sha256, /^[0-9a-f]{64}$/)
    assert.ok(WINDOWS_MEDIA_RUNTIME.maxSizeBytes < 130_000_000)
  })

  it('refuses a non-pinned local FFmpeg archive before extraction', async () => {
    const archive = join(workDir, 'wrong-runtime.zip')
    const userData = join(workDir, 'runtime-user-data')
    await fs.writeFile(archive, 'not the pinned Gyan archive')
    await assert.rejects(
      installMediaRuntimeArchive({ userDataPath: userData, archivePath: archive }),
      /checksum did not match the pinned Gyan build/
    )
    assert.equal(await fs.stat(join(userData, 'media-runtime')).then(() => true, () => false), false)
  })

  it('detects a damaged offline runtime so the app can offer recovery', async () => {
    const userData = join(workDir, 'damaged-runtime')
    const runtimeDir = mediaRuntimeDirectory(userData)
    await fs.mkdir(runtimeDir, { recursive: true })
    await fs.writeFile(join(runtimeDir, 'ffmpeg.exe'), Buffer.alloc(1_048_576))
    await fs.writeFile(join(runtimeDir, 'ffprobe.exe'), Buffer.alloc(1_048_576))
    assert.equal(hasMediaRuntime(userData), true)
    await assert.rejects(validateInstalledMediaRuntime(userData))
  })

  it('supports a checksum-pinned archive when only a maximum size is known', async () => {
    const spec = { ...specFor(served, 'runtime.zip'), sizeBytes: undefined, maxSizeBytes: served.length + 1 }
    const progress: Array<{ totalBytes: number; percent: number | null }> = []
    const out = await downloadModel({ spec, destDir: join(workDir, 'unknown-size'), onProgress: (p) => progress.push(p) })
    assert.equal(out.bytes, served.length)
    assert.ok(progress.some((p) => p.totalBytes === served.length && p.percent === 100))
  })

  it('rejects a checksum-pinned archive that exceeds its configured maximum', async () => {
    const dest = join(workDir, 'over-limit')
    const spec = { ...specFor(served, 'oversize.zip'), sizeBytes: undefined, maxSizeBytes: served.length - 1 }
    await assert.rejects(downloadModel({ spec, destDir: dest }), (err: unknown) => {
      assert.ok(err instanceof ModelDownloadError)
      assert.equal(err.code, 'SIZE_MISMATCH')
      return true
    })
    assert.equal(await fs.stat(join(dest, 'oversize.zip.part')).then(() => true, () => false), false)
  })

  it('full download verifies hash, publishes atomically, reports progress', async () => {
    seenRanges = []
    const dest = join(workDir, 'full')
    const seen: number[] = []
    const out = await downloadModel({
      spec: specFor(served, 'model.bin'),
      destDir: dest,
      onProgress: (p) => { seen.push(p.receivedBytes) },
    })
    assert.equal(out.bytes, served.length)
    assert.deepEqual(await fs.readFile(out.path), served)
    assert.equal(seen[seen.length - 1], served.length)
    assert.ok(seen.length >= 2)
    // No Range needed on a clean fetch; no .part left behind.
    assert.deepEqual(seenRanges, [undefined])
    await assert.rejects(fs.stat(join(dest, 'model.bin.part')))
  })

  it('checksum mismatch fails closed and deletes the partial', async () => {
    const dest = join(workDir, 'badsum')
    const spec = { ...specFor(served, 'model.bin'), sha256: '0'.repeat(64) }
    await assert.rejects(downloadModel({ spec, destDir: dest }), (err: unknown) => {
      assert.ok(err instanceof ModelDownloadError)
      assert.equal((err as ModelDownloadError).code, 'CHECKSUM_MISMATCH')
      return true
    })
    await assert.rejects(fs.stat(join(dest, 'model.bin.part')))
    await assert.rejects(fs.stat(join(dest, 'model.bin')))
  })

  it('size mismatch fails closed before hashing', async () => {
    const dest = join(workDir, 'badsize')
    const spec = { ...specFor(served, 'model.bin'), sizeBytes: served.length + 10 }
    await assert.rejects(downloadModel({ spec, destDir: dest }), (err: unknown) => {
      assert.ok(err instanceof ModelDownloadError)
      assert.equal((err as ModelDownloadError).code, 'SIZE_MISMATCH')
      return true
    })
  })

  it('resumes from .part with a single Range fetch', async () => {
    const dest = join(workDir, 'resume')
    await fs.mkdir(dest, { recursive: true })
    const half = Math.floor(served.length / 2)
    await fs.writeFile(join(dest, 'model.bin.part'), served.subarray(0, half))
    seenRanges = []
    const out = await downloadModel({ spec: specFor(served, 'model.bin'), destDir: dest })
    assert.equal(out.bytes, served.length)
    assert.deepEqual(await fs.readFile(out.path), served)
    assert.deepEqual(seenRanges, [`bytes=${half}-`])
  })

  it('a server without Range support restarts cleanly', async () => {
    const dest = join(workDir, 'norange')
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(join(dest, 'model.bin.part'), served.subarray(0, 1000))
    ignoreRange = true
    try {
      const out = await downloadModel({ spec: specFor(served, 'model.bin'), destDir: dest })
      assert.deepEqual(await fs.readFile(out.path), served)
    } finally {
      ignoreRange = false
    }
  })

  it('follows a relative HTTPS/local redirect within the redirect limit', async () => {
    const out = await downloadModel({
      spec: { ...specFor(served, 'redirect.bin'), url: `${serverUrl}/redirect` },
      destDir: join(workDir, 'redirect'),
    })
    assert.deepEqual(await fs.readFile(out.path), served)
  })

  it('retries a transient server error and a dropped connection', async () => {
    const dest = join(workDir, 'retry')
    unavailableResponses = 1
    const out = await downloadModel({ spec: specFor(served, 'model.bin'), destDir: dest })
    assert.deepEqual(await fs.readFile(out.path), served)

    const retryAfterDrop = join(workDir, 'retry-drop')
    droppedConnections = 1
    const next = await downloadModel({ spec: specFor(served, 'model.bin'), destDir: retryAfterDrop })
    assert.deepEqual(await fs.readFile(next.path), served)
  })

  it('restarts once after a stale partial receives HTTP 416', async () => {
    const dest = join(workDir, 'range416')
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(join(dest, 'model.bin.part'), served.subarray(0, 20))
    seenRanges = []
    range416 = true
    try {
      const out = await downloadModel({ spec: specFor(served, 'model.bin'), destDir: dest })
      assert.deepEqual(await fs.readFile(out.path), served)
      assert.deepEqual(seenRanges, ['bytes=20-', undefined])
    } finally {
      range416 = false
    }
  })

  it('publishes an already-complete partial after local checksum verification', async () => {
    const dest = join(workDir, 'complete-part')
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(join(dest, 'model.bin.part'), served)
    seenRanges = []
    const out = await downloadModel({ spec: specFor(served, 'model.bin'), destDir: dest })
    assert.deepEqual(await fs.readFile(out.path), served)
    assert.deepEqual(seenRanges, [])
  })

  it('rejects malformed Content-Range and removes the partial', async () => {
    const dest = join(workDir, 'bad-range')
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(join(dest, 'model.bin.part'), served.subarray(0, 20))
    badContentRange = true
    try {
      await assert.rejects(downloadModel({ spec: specFor(served, 'model.bin'), destDir: dest }), (err: unknown) => {
        assert.ok(err instanceof ModelDownloadError)
        assert.equal((err as ModelDownloadError).code, 'HTTP_ERROR')
        return true
      })
      await assert.rejects(fs.stat(join(dest, 'model.bin.part')))
    } finally {
      badContentRange = false
    }
  })

  it('abort keeps .part for resume and reports ABORTED', async () => {
    const dest = join(workDir, 'abort')
    // Drip-feed (64KB/20ms over 2MB ≈ 640ms) so abort at 150ms lands mid-stream.
    const prev = served
    const slow = Buffer.from(Array.from({ length: 24_000 }, (_, i) => (i * 13) % 251))
    served = slow
    dripChunk = 512
    const controller = new AbortController()
    try {
      const pending = downloadModel({
        spec: specFor(slow, 'model.bin'),
        destDir: dest,
        signal: controller.signal,
      })
      await new Promise((r) => setTimeout(r, 150))
      controller.abort()
      await assert.rejects(pending, (err: unknown) => {
        assert.ok(err instanceof ModelDownloadError)
        assert.equal((err as ModelDownloadError).code, 'ABORTED')
        return true
      })
      const st = await fs.stat(join(dest, 'model.bin.part'))
      assert.ok(st.size < slow.length)
      // Resume after abort completes the file (proves .part reuse).
      dripChunk = 0
      const out = await downloadModel({ spec: specFor(slow, 'model.bin'), destDir: dest })
      assert.deepEqual(await fs.readFile(out.path), slow)
    } finally {
      dripChunk = 0
      served = prev
    }
  })

  it('refuses non-HTTP(S) and plain-HTTP off-localhost URLs', async () => {
    const dest = join(workDir, 'insecure')
    await assert.rejects(
      downloadModel({ spec: { ...specFor(served, 'm.bin'), url: 'ftp://x/y.bin' }, destDir: dest }),
      (err: unknown) => err instanceof ModelDownloadError && err.code === 'INSECURE_URL'
    )
    await assert.rejects(
      downloadModel({ spec: { ...specFor(served, 'm.bin'), url: 'http://example.com/y.bin' }, destDir: dest }),
      (err: unknown) => err instanceof ModelDownloadError && err.code === 'INSECURE_URL'
    )
  })

  it('installed + verified model short-circuits without network', async () => {
    const dest = join(workDir, 'present')
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(join(dest, 'model.bin'), served)
    seenRanges = []
    const out = await downloadModel({ spec: specFor(served, 'model.bin'), destDir: dest })
    assert.equal(out.bytes, served.length)
    assert.deepEqual(seenRanges, [])
  })
})
