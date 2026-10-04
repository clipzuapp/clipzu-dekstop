import { createWriteStream, promises as fs } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { get as httpsGet, type RequestOptions } from 'https'
import { get as httpGet, type IncomingMessage } from 'http'
import type { DownloadArchiveSpec, ModelSpec } from '../../shared/modelCatalog'

/**
 * ModelDownloader — first-run model fetch (Phase 5, P5.2).
 *
 * - HTTPS only (plain http rejected — model bytes are trust-critical).
 * - Resume via Range from a `.part` file; servers without Range support
 *   restart cleanly (200 → truncate and re-fetch).
 * - sha256 streamed during write; size pre-checked; mismatch deletes the
 *   partial and throws a typed error (fail closed, never a half model).
 * - Atomic publish: `.part` → final rename only after verification.
 * - Abort keeps `.part` so the next run resumes instead of restarting.
 * - No Electron imports (paths injected) — fully headless-testable.
 */

export interface ModelDownloadProgress {
  phase: 'downloading' | 'verifying'
  receivedBytes: number
  totalBytes: number
  /** 0-100 when totalBytes is known, else null (indeterminate). */
  percent: number | null
}

const MAX_REDIRECTS = 5
const MAX_RETRIES = 2

async function requestModel(url: URL, headers: RequestOptions['headers'], signal?: AbortSignal, redirects = 0): Promise<IncomingMessage> {
  if (signal?.aborted) throw new ModelDownloadError('ABORTED', 'model download aborted before request')
  const getter = url.protocol === 'https:' ? httpsGet : url.protocol === 'http:' ? httpGet : null
  if (!getter) throw new ModelDownloadError('INSECURE_URL', `unsupported model URL protocol: ${url.protocol}`)
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) {
    throw new ModelDownloadError('INSECURE_URL', 'model downloads require HTTPS outside localhost')
  }
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = getter(url, { headers, timeout: 30_000 })
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
    const onAbort = (): void => { req.destroy(new ModelDownloadError('ABORTED', 'model download aborted')) }
    req.once('response', (res) => { cleanup(); resolve(res) })
    req.once('error', (err) => { cleanup(); reject(err) })
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    req.on('timeout', () => req.destroy(new Error('model request timed out')))
  }).catch((err: unknown) => {
    if (signal?.aborted) throw new ModelDownloadError('ABORTED', 'model download aborted')
    throw err
  })
  const status = response.statusCode ?? 0
  if ([301, 302, 303, 307, 308].includes(status)) {
    const location = response.headers.location
    response.resume()
    if (!location) throw new ModelDownloadError('HTTP_ERROR', `redirect HTTP ${status} has no Location`)
    if (redirects >= MAX_REDIRECTS) throw new ModelDownloadError('HTTP_ERROR', 'model download exceeded redirect limit')
    let next: URL
    try { next = new URL(location, url) } catch { throw new ModelDownloadError('HTTP_ERROR', 'model download received an invalid redirect URL') }
    if (url.protocol === 'https:' && next.protocol !== 'https:') {
      throw new ModelDownloadError('INSECURE_URL', 'model redirect cannot downgrade HTTPS')
    }
    return requestModel(next, headers, signal, redirects + 1)
  }
  return response
}

export class ModelDownloadError extends Error {
  readonly code: 'CHECKSUM_MISMATCH' | 'SIZE_MISMATCH' | 'HTTP_ERROR' | 'ABORTED' | 'INSECURE_URL'
  constructor(code: ModelDownloadError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export interface DownloadModelOptions {
  spec: ModelSpec | DownloadArchiveSpec
  /** Writable destination directory (userData/models in production). */
  destDir: string
  onProgress?: (p: ModelDownloadProgress) => void
  signal?: AbortSignal
}

function failTemporary(path: string): Promise<void> {
  return fs.unlink(path).catch(() => undefined).then(() => undefined)
}

export async function downloadModel(opts: DownloadModelOptions): Promise<{ path: string; bytes: number }> {
  const { spec, destDir, onProgress, signal } = opts
  const maxBytes = spec.sizeBytes ?? ('maxSizeBytes' in spec ? spec.maxSizeBytes : spec.sizeBytes)
  let url: URL
  try { url = new URL(spec.url) } catch { throw new ModelDownloadError('INSECURE_URL', 'invalid model URL') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ModelDownloadError('INSECURE_URL', `refusing non-HTTP(S) model URL: ${spec.url}`)
  }
  if (url.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) {
    throw new ModelDownloadError('INSECURE_URL', 'model downloads require HTTPS outside localhost')
  }

  await fs.mkdir(destDir, { recursive: true })
  const finalPath = join(destDir, spec.fileName)
  const partPath = `${finalPath}.part`

  // Fast path: a complete, verified model is already installed.
  try {
    const st = await fs.stat(finalPath)
    if ((spec.sizeBytes === undefined || st.size === spec.sizeBytes) && st.size <= maxBytes && (await sha256File(finalPath)) === spec.sha256) {
      return { path: finalPath, bytes: st.size }
    }
  } catch {
    // Missing or unreadable — (re)download below.
  }

  let resumeFrom = 0
  try {
    const st = await fs.stat(partPath)
    resumeFrom = st.size
  } catch {
    resumeFrom = 0
  }

  // If an interrupted download left exactly the expected number of bytes, it
  // may already be complete. Verify it locally before issuing an invalid Range.
  if (spec.sizeBytes !== undefined && resumeFrom === spec.sizeBytes) {
    if (await sha256File(partPath) === spec.sha256) {
      await fs.rename(partPath, finalPath)
      return { path: finalPath, bytes: spec.sizeBytes }
    }
    await failTemporary(partPath)
    resumeFrom = 0
  } else if (resumeFrom > maxBytes || (spec.sizeBytes !== undefined && resumeFrom > spec.sizeBytes)) {
    await failTemporary(partPath)
    resumeFrom = 0
  }

  let stream: IncomingMessage | null = null
  let responseStatus = 0
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      stream = await requestModel(url, resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {}, signal)
      responseStatus = stream.statusCode ?? 0
      if (responseStatus >= 500 && attempt < MAX_RETRIES) {
        stream.resume()
        stream = null
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
        continue
      }
      break
    } catch (err) {
      if (err instanceof ModelDownloadError && err.code !== 'HTTP_ERROR') throw err
      if (attempt === MAX_RETRIES) throw err
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
    }
  }
  if (!stream) throw new ModelDownloadError('HTTP_ERROR', 'model request returned no response')

  // A 416 can mean a complete candidate; verify before a single clean restart.
  // A stale partial gets one fresh request, never an unbounded retry loop.
  if (responseStatus === 416) {
    stream.resume()
    const unsatisfiedRangeSize = Number(/^bytes \*\/(\d+)$/.exec(stream.headers['content-range'] ?? '')?.[1])
    if (resumeFrom === unsatisfiedRangeSize && resumeFrom <= maxBytes && await sha256File(partPath) === spec.sha256) {
      await fs.rename(partPath, finalPath)
      return { path: finalPath, bytes: resumeFrom }
    }
    await failTemporary(partPath)
    resumeFrom = 0
    stream = await requestModel(url, {}, signal)
    responseStatus = stream.statusCode ?? 0
  }
  if (responseStatus === 200 && resumeFrom > 0) {
    // Server ignored Range. Discard the old bytes and consume this full body.
    await failTemporary(partPath)
    resumeFrom = 0
  }
  if (responseStatus === 206) {
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(stream.headers['content-range'] ?? '')
    if (!match || Number(match[1]) !== resumeFrom || Number(match[2]) < Number(match[1]) ||
      (spec.sizeBytes !== undefined && Number(match[3]) !== spec.sizeBytes) || Number(match[3]) > maxBytes) {
      stream.resume()
      await failTemporary(partPath)
      throw new ModelDownloadError('HTTP_ERROR', 'model server returned an invalid Content-Range')
    }
  }
  if (responseStatus !== 200 && responseStatus !== 206) {
    stream.resume()
    throw new ModelDownloadError('HTTP_ERROR', `model download failed: HTTP ${responseStatus || 'unknown'}`)
  }

  const rangeMatch = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(stream.headers['content-range'] ?? '')
  const contentLength = Number(stream.headers['content-length'])
  const responseTotal = rangeMatch && rangeMatch[3] !== '*'
    ? Number(rangeMatch[3])
    : Number.isFinite(contentLength) ? resumeFrom + contentLength : 0
  const totalBytes = spec.sizeBytes ?? (responseTotal > 0 ? responseTotal : 0)
  if (totalBytes > maxBytes || (spec.sizeBytes !== undefined && responseTotal > 0 && responseTotal !== spec.sizeBytes)) {
    stream.resume()
    await failTemporary(partPath)
    throw new ModelDownloadError('SIZE_MISMATCH', `download size ${responseTotal} exceeds the pinned archive limits`)
  }

  const hash = createHash('sha256')
  // Seed the hash with existing partial bytes when resuming (206).
  if (resumeFrom > 0) {
    const fd = await fs.open(partPath, 'r')
    try {
      const buf = Buffer.alloc(65536)
      let pos = 0
      for (;;) {
        const { bytesRead } = await fd.read(buf, 0, buf.length, pos)
        if (bytesRead === 0) break
        hash.update(buf.subarray(0, bytesRead))
        pos += bytesRead
        if (pos >= resumeFrom) break
      }
    } finally {
      await fd.close()
    }
  }

  let received = resumeFrom
  const report = (): void => {
    onProgress?.({
      phase: 'downloading',
      receivedBytes: received,
      totalBytes,
      percent: totalBytes ? Math.min(100, (received / totalBytes) * 100) : null,
    })
  }
  report()

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(partPath, { flags: resumeFrom > 0 ? 'a' : 'w' })
    let settled = false
    const done = (err?: Error): void => {
      if (settled) return
      settled = true
      if (err) {
        out.destroy()
        reject(err)
      } else {
        out.end(() => resolve())
      }
    }
    stream.on('data', (chunk: Buffer) => {
      if (received + chunk.length > maxBytes || (totalBytes > 0 && received + chunk.length > totalBytes)) {
        stream?.destroy(new ModelDownloadError('SIZE_MISMATCH', 'model response exceeds expected size'))
        done(new ModelDownloadError('SIZE_MISMATCH', 'model response exceeds expected size'))
        return
      }
      received += chunk.length
      hash.update(chunk)
      if (!out.write(chunk)) {
        stream?.pause()
        out.once('drain', () => stream?.resume())
      }
      report()
    })
    stream.on('end', () => done())
    stream.on('error', (err) => done(err as Error))
    out.on('error', (err) => {
      stream.destroy()
      done(err)
    })
    if (signal) {
      signal.addEventListener('abort', () => {
        stream.destroy()
        done(new ModelDownloadError('ABORTED', 'model download aborted'))
      }, { once: true })
    }
  }).catch(async (err) => {
    if (err instanceof ModelDownloadError && err.code === 'ABORTED') throw err
    await failTemporary(partPath)
    throw err
  })

  if (signal?.aborted) {
    throw new ModelDownloadError('ABORTED', 'model download aborted')
  }
  if (received > maxBytes || (spec.sizeBytes !== undefined && received !== spec.sizeBytes) || (totalBytes > 0 && received !== totalBytes)) {
    await failTemporary(partPath)
    const expected = spec.sizeBytes ?? (totalBytes || 'unknown')
    throw new ModelDownloadError(
      'SIZE_MISMATCH',
      `download size mismatch: got ${received} bytes, expected ${expected}`
    )
  }
  onProgress?.({ phase: 'verifying', receivedBytes: received, totalBytes: totalBytes || received, percent: 100 })
  const digest = hash.digest('hex')
  if (digest !== spec.sha256) {
    await failTemporary(partPath)
    throw new ModelDownloadError('CHECKSUM_MISMATCH', 'model checksum mismatch — partial deleted, retry downloads clean')
  }
  await failTemporary(finalPath)
  await fs.rename(partPath, finalPath)
  return { path: finalPath, bytes: received }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const fd = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(65536)
    for (;;) {
      const { bytesRead } = await fd.read(buf, 0, buf.length)
      if (bytesRead === 0) break
      hash.update(buf.subarray(0, bytesRead))
    }
  } finally {
    await fd.close()
  }
  return hash.digest('hex')
}
