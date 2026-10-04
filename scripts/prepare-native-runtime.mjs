import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sqlitePackage = resolve(root, 'node_modules', 'better-sqlite3', 'package.json')
const prebuildCli = resolve(root, 'node_modules', 'prebuild-install', 'bin.js')
const sqliteDir = dirname(sqlitePackage)
if (!existsSync(sqlitePackage) || !existsSync(prebuildCli)) {
  throw new Error('better-sqlite3 and prebuild-install must be installed before native preparation')
}

const electronVersion = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(root, 'node_modules/electron/package.json'), 'utf8')).version
const addonPath = resolve(sqliteDir, 'build/Release/better_sqlite3.node')
const result = spawnSync(process.execPath, [prebuildCli, '--runtime', 'electron', '--target', electronVersion, '--arch', process.arch], {
  cwd: sqliteDir,
  stdio: 'inherit',
  env: process.env,
})
if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`No published better-sqlite3 prebuild is available for Electron ${electronVersion} (${process.platform}-${process.arch}); refusing an implicit source build.`)
}
if (!existsSync(addonPath) || statSync(addonPath).size === 0) {
  throw new Error(`Electron-compatible better-sqlite3 addon was not installed: ${addonPath}`)
}
console.log(`Prepared better-sqlite3 for Electron ${electronVersion} (${process.platform}-${process.arch})`)
