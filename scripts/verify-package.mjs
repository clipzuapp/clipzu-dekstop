import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getRawHeader } from '@electron/asar'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const appDir = resolve(process.argv[2] || join(root, 'dist', 'win-unpacked'))
const maxBytes = Number(process.env.CLIPZU_MAX_UNPACKED_BYTES || 250 * 1024 * 1024)
const appRoot = resolve(root, 'dist') + sep
if (!appDir.startsWith(appRoot)) throw new Error(`Package path must be inside dist/: ${appDir}`)
if (!existsSync(appDir)) throw new Error(`Unpacked package not found: ${appDir}`)

const platform = process.env.CLIPZU_TARGET_PLATFORM || process.platform
const binRoot = join(appDir, 'resources', 'bin')
const resourcesRoot = join(appDir, 'resources')
const appAsar = join(resourcesRoot, 'app.asar')
const appAsarUnpacked = join(resourcesRoot, 'app.asar.unpacked')
const executable = platform === 'win32' ? 'clipzu.exe' : platform === 'darwin' ? 'Clipzu' : 'clipzu'
const required = platform === 'win32' ? ['whisper-cli.exe'] : ['whisper-cli']

const files = []
function walk(dir, prefix = '') {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(full, rel)
    else if (entry.isFile()) files.push({ path: rel.replaceAll('\\', '/'), bytes: statSync(full).size })
  }
}
walk(appDir)

const problems = []
const actualExecutable = files.find((file) => file.path.toLowerCase() === executable.toLowerCase())
if (!actualExecutable || actualExecutable.bytes === 0) problems.push(`missing application executable: ${executable}`)
for (const name of required) {
  const full = join(binRoot, name)
  if (!existsSync(full) || statSync(full).size === 0) problems.push(`missing required runtime binary: resources/bin/${name}`)
}
if (!existsSync(appAsar)) problems.push('missing resources/app.asar')
for (const license of ['resources/licenses/GPL-3.0.txt', 'resources/licenses/FFmpeg-NOTICE.md']) {
  if (!files.some((file) => file.path === license)) problems.push(`missing third-party runtime notice: ${license}`)
}

const forbiddenPatterns = [
  /^(?:models?|models-test|test|tests|out-test|scripts|blueprint|\.qoder|\.vscode)(?:\/|$)/i,
  /(?:^|\/)(?:ffplay[^/]*|whisper-(?:server|stream|talk-llama|bench|quantize|command|lsp|vad)[^/]*|test-[^/]*\.exe|bench\.exe|wchess\.exe|main\.exe)$/i,
  /(?:^|\/)(?:coverage|__tests__|fixtures?)(?:\/|$)/i,
  /(?:^|\/)[^/]+\.(?:map|tsbuildinfo)$/i,
  /(?:^|\/)node_modules\/(?:typescript|electron-builder|electron-vite|vite|vitest|jest)(?:\/|$)/i,
  /(?:^|\/)node_modules\/better-sqlite3\/(?:deps|src)(?:\/|$)/i,
  /(?:^|\/)node_modules\/better-sqlite3\/build\/(?!Release\/better_sqlite3\.node(?:$|\/))/i,
]
const fixturePattern = /story.?39|uploaded.?stories|clipzu-fixtures|clipzu-whisper-qa/i
const modelPattern = /(?:^|\/)(?:ggml[^/]*\.(?:bin|gguf)|models?\/[^/]+\.(?:bin|gguf))$/i
function inspectEntry(entry, location) {
  if (forbiddenPatterns.some((pattern) => pattern.test(entry))) problems.push(`forbidden ${location} entry: ${entry}`)
  if (modelPattern.test(entry)) problems.push(`transcription model must not ship: ${entry}`)
  if (fixturePattern.test(entry)) problems.push(`Story-39/TEMP fixture must not ship: ${entry}`)
}
for (const file of files) inspectEntry(file.path, 'package')

let asarEntries = []
let asarPayloadBytes = 0
let packagedMainBundle = ''
if (existsSync(appAsar)) {
  try {
    const header = await getRawHeader(appAsar)
    const tree = JSON.parse(header.headerString).files
    const flatten = (children, prefix = '') => {
      for (const [name, item] of Object.entries(children)) {
        const path = prefix ? `${prefix}/${name}` : name
        if (item.files) flatten(item.files, path)
        else {
          asarEntries.push(path)
          asarPayloadBytes += item.size || 0
        }
      }
    }
    flatten(tree)
    const mainBundle = tree.out?.files?.main?.files?.['index.js']
    if (mainBundle && !mainBundle.unpacked) {
      const archiveBytes = readFileSync(appAsar)
      const start = 8 + header.headerSize + Number(mainBundle.offset)
      packagedMainBundle = archiveBytes.subarray(start, start + mainBundle.size).toString('utf8')
    }
  } catch (err) {
    problems.push(`could not inspect app.asar: ${err instanceof Error ? err.message : String(err)}`)
  }
  for (const entry of asarEntries) inspectEntry(entry, 'app.asar')
  for (const expected of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']) {
    if (!asarEntries.includes(expected)) problems.push(`missing app.asar runtime entry: ${expected}`)
  }
  for (const expected of [
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/better-sqlite3/package.json',
    'node_modules/yauzl/index.js',
  ]) {
    if (!asarEntries.includes(expected)) problems.push(`missing required app.asar entry: ${expected}`)
  }
  for (const marker of ['mediaRuntime:installLocal', 'ffmpeg-8.1.2-essentials_build.zip', 'pinned Gyan build']) {
    if (!packagedMainBundle.includes(marker)) problems.push(`media runtime installer code is missing from packaged main bundle: ${marker}`)
  }
  for (const devModule of ['fluent-ffmpeg', 'ffmpeg-static', 'ffprobe-static', 'typescript', 'electron-builder', 'electron-vite']) {
    if (asarEntries.some((entry) => entry.startsWith(`node_modules/${devModule}/`))) {
      problems.push(`development-only module was packaged: ${devModule}`)
    }
  }
}

const allNames = [...files.map((file) => file.path), ...asarEntries]
for (const name of ['ffmpeg', 'ffprobe']) {
  const expectedName = platform === 'win32' ? `${name}.exe` : name
  const copies = allNames.filter((entry) => basename(entry).toLowerCase() === expectedName.toLowerCase())
  if (copies.length !== 0) problems.push(`${expectedName} must be installed to per-user data and excluded from the base package; found ${copies.length} packaged copies: ${copies.join(', ')}`)
}
const whisperName = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
const whisperCopies = allNames.filter((entry) => basename(entry).toLowerCase() === whisperName.toLowerCase())
if (whisperCopies.length !== 1 || !whisperCopies[0].startsWith('resources/bin/')) {
  problems.push(`expected exactly one ${whisperName} at resources/bin; found ${whisperCopies.length}: ${whisperCopies.join(', ')}`)
}
if (existsSync(appAsarUnpacked)) {
  const unexpectedUnpacked = files.filter((file) => file.path.startsWith('resources/app.asar.unpacked/') &&
    !file.path.startsWith('resources/app.asar.unpacked/node_modules/better-sqlite3/'))
  if (unexpectedUnpacked.length) problems.push(`unexpected ASAR-unpacked file: ${unexpectedUnpacked[0].path}`)
}
if (!files.some((file) => file.path === 'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node')) {
  problems.push('missing Electron-compatible unpacked better_sqlite3.node')
}

const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
const sumPrefix = (prefix) => files.filter((file) => file.path === prefix || file.path.startsWith(`${prefix}/`))
  .reduce((sum, file) => sum + file.bytes, 0)
const runtimeBytes = sumPrefix('resources/bin')
const localeBytes = sumPrefix('locales')
const resourcesBytes = sumPrefix('resources')
const asarBytes = files.find((file) => file.path === 'resources/app.asar')?.bytes || 0
const unpackedBytes = sumPrefix('resources/app.asar.unpacked')
const topFiles = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 50)
const dirTotals = new Map()
for (const file of files) {
  const parts = file.path.split('/')
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/')
    dirTotals.set(dir, (dirTotals.get(dir) || 0) + file.bytes)
  }
}

console.log(`Package: ${appDir}`)
console.log(`Platform: ${platform}; files: ${files.length}; app.asar files: ${asarEntries.length}`)
console.log(`TOTAL: ${totalBytes} bytes / ${(totalBytes / 1024 / 1024).toFixed(3)} MiB; budget: ${maxBytes} bytes / ${(maxBytes / 1024 / 1024).toFixed(3)} MiB`)
console.log(`Electron executable: ${actualExecutable?.bytes || 0} bytes`)
console.log(`resources total: ${resourcesBytes} bytes / ${(resourcesBytes / 1024 / 1024).toFixed(3)} MiB`)
console.log(`app.asar: ${asarBytes} bytes / ${(asarBytes / 1024 / 1024).toFixed(3)} MiB (payload ${asarPayloadBytes} bytes)`)
console.log(`app.asar.unpacked: ${unpackedBytes} bytes / ${(unpackedBytes / 1024 / 1024).toFixed(3)} MiB`)
console.log(`runtime binaries/resources: ${runtimeBytes} bytes / ${(runtimeBytes / 1024 / 1024).toFixed(3)} MiB`)
console.log(`Electron locales: ${localeBytes} bytes / ${(localeBytes / 1024 / 1024).toFixed(3)} MiB`)
console.log('Largest files:')
for (const file of topFiles) console.log(`  ${file.bytes} bytes\t${file.path}`)
console.log(`Packaged SFX files: ${files.filter((file) => file.path.startsWith('resources/assets/sfx/') && file.path.toLowerCase().endsWith('.mp3')).length}`)
console.log('Largest directories:')
for (const [name, bytes] of [...dirTotals].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${bytes} bytes\t${name}`)
}

if (totalBytes >= maxBytes) problems.push(`unpacked package must be < ${maxBytes} bytes; measured ${totalBytes}`)
if (problems.length) {
  console.error(problems.map((problem) => `FAIL ${problem}`).join('\n'))
  process.exitCode = 1
} else {
  console.log('Package allowlist, runtime uniqueness, and size checks passed.')
}
