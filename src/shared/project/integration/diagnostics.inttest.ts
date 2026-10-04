import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { DiagnosticLog } from '../../../main/services/DiagnosticLog'
import { buildDiagnosticBundle } from '../../../main/services/diagnosticBundle'

describe('opt-in diagnostic bundle privacy', () => {
  it('allowlists logs, redacts secrets, and excludes project/media paths', () => {
    const temp = mkdtempSync(join(tmpdir(), 'clipzu-diagnostic-test-'))
    try {
      const logger = new DiagnosticLog(temp)
      logger.write('ERROR', 'export.failed', 'password=hunter2 token=abc123 media=C:\\story39\\voice.mp3')
      const bundle = buildDiagnosticBundle({
        appVersion: '1.0.0', platform: 'win32', architecture: 'x64',
        createdAt: '2026-10-04T00:00:00.000Z', validation: { model: false },
        logs: [...logger.readEntries(), { name: '../secrets.txt' as 'clipzu.log', contents: 'excluded sentinel' }],
      })
      assert.deepEqual(Object.keys(bundle.logs), ['clipzu.log'])
      assert.match(bundle.logs['clipzu.log'], /password=\[REDACTED\]/)
      assert.match(bundle.logs['clipzu.log'], /token=\[REDACTED\]/)
      assert.doesNotMatch(JSON.stringify(bundle), /hunter2|abc123|story39|voice\.mp3|excluded sentinel/)
      assert.ok(bundle.manifest.excluded.includes('project files'))
      assert.equal(bundle.manifest.included[0].sha256.length, 64)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('rotates bounded logs while retaining no more than three entries', () => {
    const temp = mkdtempSync(join(tmpdir(), 'clipzu-diagnostic-rotation-'))
    try {
      const logger = new DiagnosticLog(temp)
      for (let i = 0; i < 150; i++) logger.write('INFO', 'rotation', 'x'.repeat(16_000))
      const entries = logger.readEntries()
      assert.ok(entries.length <= 3)
      for (const entry of entries) assert.ok(Buffer.byteLength(entry.contents) <= 1_048_576)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
})
