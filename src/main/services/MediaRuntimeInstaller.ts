import { createHash } from 'crypto'
import { createReadStream, promises as fs } from 'fs'
import { createWriteStream } from 'fs'
import { spawn } from 'child_process'
import { join, resolve, sep } from 'path'
import type { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import * as yauzl from 'yauzl'
import { MEDIA_RUNTIME_VERSION, WINDOWS_MEDIA_RUNTIME } from '../../shared/modelCatalog'
import { downloadModel, type ModelDownloadProgress } from './ModelDownloader'

const WINDOWS_RUNTIME_ROOT = 'ffmpeg-8.1.2-essentials_build'
const REQUIRED_RUNTIME_FILES = ['ffmpeg.exe', 'ffprobe.exe'] as const
const ARCHIVE_FILES = new Map([
  [`${WINDOWS_RUNTIME_ROOT}/bin/ffmpeg.exe`, 'ffmpeg.exe'],
  [`${WINDOWS_RUNTIME_ROOT}/bin/ffprobe.exe`, 'ffprobe.exe'],
])
const REQUIRED_ENCODERS = ['libx264', 'libx265', 'aac', 'libmp3lame']
const REQUIRED_DECODERS = ['hevc', 'mjpeg', 'png', 'webp']
const REQUIRED_FILTERS = ['ass', 'subtitles', 'scale', 'crop', 'overlay', 'xfade', 'concat', 'trim']

export interface MediaRuntimeProgress extends ModelDownloadProgress {}

export interface InstallMediaRuntimeOptions {
  userDataPath: string
  archivePath: string
  signal?: AbortSignal
  onProgress?: (progress: MediaRuntimeProgress) => void
}

export function mediaRuntimeDirectory(userDataPath: string): string {
  return join(userDataPath, 'media-runtime', MEDIA_RUNTIME_VERSION)
}

export function hasMediaRuntime(userDataPath: string): boolean {
  const directory = mediaRuntimeDirectory(userDataPath)
  return REQUIRED_RUNTIME_FILES.every((name) => {
    try { return require('fs').statSync(join(directory, name)).isFile() } catch { return false }
  })
}

export async function validateInstalledMediaRuntime(userDataPath: string): Promise<void> {
  await validateExtractedRuntime(mediaRuntimeDirectory(userDataPath))
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function runProcess(executable: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(new Error('FFmpeg runtime installation cancelled.'))
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let outputBytes = 0
    const collect = (chunk: Buffer): void => {
      outputBytes += chunk.length
      if (outputBytes <= 256 * 1024) chunks.push(chunk)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const abort = (): void => { child.kill() }
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort)
      const output = Buffer.concat(chunks).toString('utf8')
      if (signal?.aborted) return reject(new Error('FFmpeg runtime installation cancelled.'))
      if (code !== 0) return reject(new Error(`Runtime tool failed (${code}): ${output.slice(-3000)}`))
      resolvePromise(output)
    })
  })
}

async function validateExtractedRuntime(directory: string, signal?: AbortSignal): Promise<void> {
  const ffmpeg = join(directory, 'ffmpeg.exe')
  const ffprobe = join(directory, 'ffprobe.exe')
  for (const [path, name] of [[ffmpeg, 'ffmpeg.exe'], [ffprobe, 'ffprobe.exe']] as const) {
    const stat = await fs.stat(path).catch(() => null)
    if (!stat?.isFile() || stat.size < 1024 * 1024) throw new Error(`The archive is missing a valid ${name}.`)
  }
  const versionOutput = await runProcess(ffmpeg, ['-version'], signal)
  const probeOutput = await runProcess(ffprobe, ['-version'], signal)
  if (!versionOutput.includes(`ffmpeg version ${MEDIA_RUNTIME_VERSION}-essentials_build-www.gyan.dev`) ||
    !probeOutput.includes(`ffprobe version ${MEDIA_RUNTIME_VERSION}-essentials_build-www.gyan.dev`)) {
    throw new Error(`This archive does not contain the pinned FFmpeg ${MEDIA_RUNTIME_VERSION} essentials build.`)
  }
  const [encoders, decoders, filters] = await Promise.all([
    runProcess(ffmpeg, ['-hide_banner', '-encoders'], signal),
    runProcess(ffmpeg, ['-hide_banner', '-decoders'], signal),
    runProcess(ffmpeg, ['-hide_banner', '-filters'], signal),
  ])
  const missing = [
    ...REQUIRED_ENCODERS.filter((name) => !new RegExp(`\\b${name}\\b`).test(encoders)),
    ...REQUIRED_DECODERS.filter((name) => !new RegExp(`\\b${name}\\b`).test(decoders)),
    ...REQUIRED_FILTERS.filter((name) => !new RegExp(`\\b${name}\\b`).test(filters)),
  ]
  if (missing.length) throw new Error(`The FFmpeg runtime is missing required codecs or filters: ${missing.join(', ')}.`)
}

/** Check archive provenance, extract only the two invoked tools, validate, then publish atomically. */
export async function installMediaRuntimeArchive(options: InstallMediaRuntimeOptions): Promise<string> {
  const { userDataPath, archivePath, signal, onProgress } = options
  const archiveStat = await fs.stat(archivePath)
  if (archiveStat.size === 0 || archiveStat.size > WINDOWS_MEDIA_RUNTIME.maxSizeBytes) {
    throw new Error('The FFmpeg archive size is outside the allowed range.')
  }
  if (await sha256File(archivePath) !== WINDOWS_MEDIA_RUNTIME.sha256) {
    throw new Error('FFmpeg archive checksum did not match the pinned Gyan build; it was not installed.')
  }
  if (signal?.aborted) throw new Error('FFmpeg runtime installation cancelled.')
  onProgress?.({ phase: 'verifying', receivedBytes: archiveStat.size, totalBytes: archiveStat.size, percent: 100 })

  const runtimeRoot = resolve(userDataPath, 'media-runtime')
  const expectedRoot = resolve(userDataPath) + sep
  if (!runtimeRoot.startsWith(expectedRoot)) throw new Error('Invalid FFmpeg runtime installation location.')
  await fs.mkdir(runtimeRoot, { recursive: true })
  const stage = join(runtimeRoot, `.staging-${process.pid}-${Date.now()}`)
  const ready = join(stage, 'ready')
  const destination = mediaRuntimeDirectory(userDataPath)
  try {
    await fs.mkdir(ready, { recursive: true })
    await extractPinnedRuntimeFiles(archivePath, ready, signal)
    await validateExtractedRuntime(ready, signal)
    if (signal?.aborted) throw new Error('FFmpeg runtime installation cancelled.')

    // This path is exclusively owned by this pinned runtime version. The new
    // directory is fully validated before replacing it, so interrupted installs
    // never leave a half-published runtime.
    await fs.rm(destination, { recursive: true, force: true })
    await fs.rename(ready, destination)
    return destination
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function downloadAndInstallMediaRuntime(options: Omit<InstallMediaRuntimeOptions, 'archivePath'> & {
  onProgress?: (progress: MediaRuntimeProgress) => void
}): Promise<string> {
  const downloadDirectory = join(options.userDataPath, 'media-runtime-downloads')
  const archive = await downloadModel({
    spec: WINDOWS_MEDIA_RUNTIME,
    destDir: downloadDirectory,
    signal: options.signal,
    onProgress: options.onProgress,
  })
  try {
    return await installMediaRuntimeArchive({ ...options, archivePath: archive.path })
  } finally {
    await fs.rm(archive.path, { force: true }).catch(() => undefined)
  }
}

/** Stream only the exact two archive members into fixed destination paths. */
async function extractPinnedRuntimeFiles(archivePath: string, destination: string, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError ?? new Error('Could not open the FFmpeg archive.'))
      const found = new Set<string>()
      let activeStream: Readable | null = null
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        if (error) zip.close()
        error ? reject(error) : resolvePromise()
      }
      const abort = (): void => {
        activeStream?.destroy(new Error('FFmpeg runtime installation cancelled.'))
        finish(new Error('FFmpeg runtime installation cancelled.'))
      }
      zip.once('error', (err) => finish(err))
      zip.once('end', () => {
        if (found.size !== REQUIRED_RUNTIME_FILES.length) {
          finish(new Error('The pinned FFmpeg archive did not contain both required executables.'))
        } else finish()
      })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) return abort()
      zip.on('entry', (entry) => {
        const outputName = ARCHIVE_FILES.get(entry.fileName)
        if (!outputName) return zip.readEntry()
        if (found.has(outputName) || entry.uncompressedSize > 125 * 1024 * 1024) {
          return finish(new Error(`The FFmpeg archive contains an invalid duplicate or oversized ${outputName}.`))
        }
        zip.openReadStream(entry, (readError, stream) => {
          if (readError || !stream) return finish(readError ?? new Error(`Could not extract ${outputName}.`))
          activeStream = stream
          const output = createWriteStream(join(destination, outputName), { flags: 'wx' })
          let bytes = 0
          stream.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > 125 * 1024 * 1024) stream.destroy(new Error(`The ${outputName} archive member exceeded its size limit.`))
          })
          void pipeline(stream, output).then(() => {
            if (bytes !== entry.uncompressedSize) return finish(new Error(`The ${outputName} archive member was truncated.`))
            found.add(outputName)
            activeStream = null
            zip.readEntry()
          }).catch((err: unknown) => finish(err instanceof Error ? err : new Error(`Could not extract ${outputName}.`)))
        })
      })
      zip.readEntry()
    })
  })
}
