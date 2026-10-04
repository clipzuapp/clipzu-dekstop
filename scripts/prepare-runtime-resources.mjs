import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const platform = process.env.CLIPZU_TARGET_PLATFORM || process.platform
const arch = process.env.CLIPZU_TARGET_ARCH || (platform === 'darwin' && process.platform === 'darwin' ? 'universal' : process.arch)
const legacyWindowsPack = join(root, 'resources', 'bin')
const source = platform === 'win32'
  ? legacyWindowsPack
  : join(root, 'resources', 'bin', `${platform}-${arch}`)
const destination = resolve(root, 'build', 'runtime-bin')
const buildRoot = resolve(root, 'build') + sep
if (!destination.startsWith(buildRoot)) throw new Error(`Refusing to write runtime resources outside build/: ${destination}`)
if (!existsSync(source)) throw new Error(`Runtime binary pack missing for ${platform}-${arch}: ${relative(root, source)}`)

const binaryNames = platform === 'win32' ? ['whisper-cli.exe'] : ['whisper-cli']
const selected = []
for (const entry of readdirSync(source, { withFileTypes: true })) {
  const full = join(source, entry.name)
  if (!entry.isFile()) continue
  const ext = extname(entry.name).toLowerCase()
  // SDL2 is only used by ffplay, which is not part of Clipzu's runtime.
  if (binaryNames.includes(entry.name) || (ext === '.dll' && entry.name.toLowerCase() !== 'sdl2.dll') || ext === '.dylib' || ext === '.so' || entry.name.toLowerCase().includes('.so.')) {
    selected.push([full, entry.name])
  }
}
if (platform === 'win32') {
  const sevenZip = join(root, 'node_modules', '7zip-bin', 'win', arch, '7za.exe')
  if (!existsSync(sevenZip)) throw new Error(`7-Zip runtime extractor missing for ${platform}-${arch}`)
  selected.push([sevenZip, '7za.exe'])
}
for (const name of binaryNames) {
  if (!selected.some(([, relativeName]) => relativeName === name)) {
    throw new Error(`Runtime pack ${relative(root, source)} is missing required binary ${name}`)
  }
}

rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
for (const [input, relativeName] of selected) {
  const output = join(destination, relativeName)
  mkdirSync(dirname(output), { recursive: true })
  copyFileSync(input, output)
  if (statSync(output).size === 0) throw new Error(`Runtime resource is empty: ${relative(root, input)}`)
}
console.log(`Prepared ${selected.length} runtime resources for ${platform}-${arch} in ${relative(root, destination)}`)
