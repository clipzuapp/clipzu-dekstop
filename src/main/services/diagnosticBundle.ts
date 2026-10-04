import { createHash } from 'crypto'
import type { DiagnosticLogEntry } from './DiagnosticLog'

export interface DiagnosticBundleInput {
  appVersion: string
  platform: string
  architecture: string
  createdAt: string
  validation: Record<string, boolean | string | number | null>
  logs: DiagnosticLogEntry[]
}

export interface DiagnosticBundle {
  manifest: {
    format: 'clipzu-diagnostics-v1'
    createdAt: string
    included: Array<{ name: string; bytes: number; sha256: string }>
    excluded: string[]
  }
  app: { version: string; platform: string; architecture: string }
  validation: Record<string, boolean | string | number | null>
  logs: Record<string, string>
}

function safeLogName(name: string): name is DiagnosticLogEntry['name'] {
  return name === 'clipzu.log' || name === 'clipzu.1.log' || name === 'clipzu.2.log'
}

function redact(text: string): string {
  return text
    .replace(/(\b(?:token|password|passwd|secret|api[_-]?key|authorization)\b\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b[A-Za-z]:\\[^\s"'<>|]+|\\\\[^\s"'<>|]+|\/(?:Users|home|mnt|Volumes)\/[^\s"'<>|]+/g, '[PATH]')
}

export function buildDiagnosticBundle(input: DiagnosticBundleInput): DiagnosticBundle {
  const logs: Record<string, string> = {}
  const included: DiagnosticBundle['manifest']['included'] = []
  for (const entry of input.logs) {
    if (!safeLogName(entry.name)) continue
    const contents = redact(entry.contents.slice(-1_048_576))
    logs[entry.name] = contents
    included.push({
      name: entry.name,
      bytes: Buffer.byteLength(contents, 'utf8'),
      sha256: createHash('sha256').update(contents).digest('hex'),
    })
  }
  return {
    manifest: {
      format: 'clipzu-diagnostics-v1',
      createdAt: input.createdAt,
      included,
      excluded: ['media files', 'project files', 'proxy files', 'waveform cache', 'models', 'story fixtures', 'credentials'],
    },
    app: { version: input.appVersion, platform: input.platform, architecture: input.architecture },
    validation: { ...input.validation },
    logs,
  }
}
