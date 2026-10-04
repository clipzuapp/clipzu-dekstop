import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface DiagnosticLogEntry {
  name: 'clipzu.log' | 'clipzu.1.log' | 'clipzu.2.log'
  contents: string
}

const MAX_FILE_BYTES = 1 * 1024 * 1024
const MAX_ROTATIONS = 2
const MAX_ENTRY_CHARS = 16_000
const LOG_NAMES: DiagnosticLogEntry['name'][] = ['clipzu.log', 'clipzu.1.log', 'clipzu.2.log']

function redact(text: string): string {
  return text
    .replace(/(\b(?:token|password|passwd|secret|api[_-]?key|authorization)\b\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z]:\\[^\s"'<>|]+|\\\\[^\s"'<>|]+|\/(?:Users|home|mnt|Volumes)\/[^\s"'<>|]+/g, '[PATH]')
    .slice(0, MAX_ENTRY_CHARS)
}

export class DiagnosticLog {
  private disabled = false
  private readonly directory: string
  private readonly currentPath: string

  constructor(userDataPath: string) {
    this.directory = join(userDataPath, 'logs')
    this.currentPath = join(this.directory, LOG_NAMES[0])
    mkdirSync(this.directory, { recursive: true })
  }

  write(level: 'INFO' | 'WARN' | 'ERROR', event: string, detail: string): void {
    if (this.disabled) return
    try {
      const line = `${new Date().toISOString()} ${level} ${redact(event)} ${redact(detail)}\n`
      const incomingBytes = Buffer.byteLength(line, 'utf8')
      if (existsSync(this.currentPath) && statSync(this.currentPath).size + incomingBytes > MAX_FILE_BYTES) this.rotate()
      appendFileSync(this.currentPath, line, { encoding: 'utf8', mode: 0o600 })
    } catch {
      // Logging must never recursively destabilize the main process.
      this.disabled = true
    }
  }

  readEntries(): DiagnosticLogEntry[] {
    const entries: DiagnosticLogEntry[] = []
    for (const name of LOG_NAMES) {
      const path = join(this.directory, name)
      if (!existsSync(path)) continue
      try {
        const text = readFileSync(path, 'utf8')
        entries.push({ name, contents: text.slice(-MAX_FILE_BYTES) })
      } catch {
        // A locked or damaged log is omitted from an opt-in bundle.
      }
    }
    return entries
  }

  private rotate(): void {
    for (let i = MAX_ROTATIONS; i >= 1; i--) {
      const from = join(this.directory, LOG_NAMES[i - 1])
      const to = join(this.directory, LOG_NAMES[i])
      if (existsSync(to)) writeFileSync(to, '', { mode: 0o600 })
      if (existsSync(from)) renameSync(from, to)
    }
  }
}

let logger: DiagnosticLog | null = null
const pending: Array<{ level: 'INFO' | 'WARN' | 'ERROR'; event: string; detail: string }> = []

export function initializeDiagnosticLog(userDataPath: string): void {
  try {
    logger = new DiagnosticLog(userDataPath)
    for (const entry of pending.splice(0)) logger.write(entry.level, entry.event, entry.detail)
  } catch {
    logger = null
  }
}

export function writeDiagnostic(level: 'INFO' | 'WARN' | 'ERROR', event: string, detail: string): void {
  if (logger) {
    logger.write(level, event, detail)
    return
  }
  if (pending.length < 100) pending.push({ level, event, detail: detail.slice(0, MAX_ENTRY_CHARS) })
}

export function readDiagnosticLogs(): DiagnosticLogEntry[] {
  return logger?.readEntries() ?? []
}
