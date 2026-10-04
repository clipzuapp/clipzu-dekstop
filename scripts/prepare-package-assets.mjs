import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const platform = process.env.CLIPZU_TARGET_PLATFORM || process.platform
const arch = process.env.CLIPZU_TARGET_ARCH || (platform === 'darwin' && process.platform === 'darwin' ? 'universal' : process.arch)
const runtimeRoot = platform === 'win32'
  ? join(root, 'resources', 'bin')
  : join(root, 'resources', 'bin', `${platform}-${arch}`)
const ffmpeg = join(runtimeRoot, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffprobe = join(runtimeRoot, platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const sourceAssets = join(root, 'assets')
const destination = resolve(root, 'build', 'package-assets')
const buildRoot = resolve(root, 'build') + sep
if (!destination.startsWith(buildRoot)) throw new Error(`Refusing to write package assets outside build/: ${destination}`)
for (const required of [ffmpeg, ffprobe, join(sourceAssets, 'icon_logo.png'), join(sourceAssets, 'sfx'), join(sourceAssets, 'fonts')]) {
  if (!existsSync(required)) throw new Error(`Required package asset input is missing: ${relative(root, required)}`)
}

function run(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', windowsHide: true, timeout: 300_000, maxBuffer: 4 * 1024 * 1024 })
  if (result.error) throw new Error(`${relative(root, program)} failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${relative(root, program)} exited ${result.status}: ${(result.stderr || '').trim()}`)
  return result.stdout.trim()
}

function durationSeconds(path) {
  const raw = run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path])
  const duration = Number(raw)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine audio duration: ${relative(root, path)}`)
  return duration
}

rmSync(destination, { recursive: true, force: true })
const sfxOut = join(destination, 'sfx')
const fontsOut = join(destination, 'fonts')
mkdirSync(sfxOut, { recursive: true })
mkdirSync(fontsOut, { recursive: true })
copyFileSync(join(sourceAssets, 'icon_logo.png'), join(destination, 'icon_logo.png'))

const soundFiles = readdirSync(join(sourceAssets, 'sfx'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.mp3')
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b))
if (soundFiles.length === 0) throw new Error('The packaged SFX library cannot be empty')

let sourceBytes = 0
let packageBytes = 0
for (const name of soundFiles) {
  const input = join(sourceAssets, 'sfx', name)
  const output = join(sfxOut, name)
  const sourceDuration = durationSeconds(input)
  run(ffmpeg, ['-y', '-v', 'error', '-i', input, '-map', '0:a:0', '-map_metadata', '-1', '-codec:a', 'libmp3lame', '-b:a', '80k', output])
  const outputBytes = statSync(output).size
  if (outputBytes === 0) throw new Error(`SFX conversion produced an empty file: ${name}`)
  const outputDuration = durationSeconds(output)
  if (Math.abs(sourceDuration - outputDuration) > Math.max(0.1, sourceDuration * 0.001)) {
    throw new Error(`SFX conversion changed duration for ${name}: ${sourceDuration}s -> ${outputDuration}s`)
  }
  sourceBytes += statSync(input).size
  packageBytes += outputBytes
}

const fontFiles = readdirSync(join(sourceAssets, 'fonts'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.ttf')
for (const entry of fontFiles) copyFileSync(join(sourceAssets, 'fonts', entry.name), join(fontsOut, entry.name))

console.log(`Prepared ${soundFiles.length} packaged SFX files (${sourceBytes} -> ${packageBytes} bytes at 80 kbps), ${fontFiles.length} fonts for ${platform}-${arch} in ${relative(root, destination)}`)
