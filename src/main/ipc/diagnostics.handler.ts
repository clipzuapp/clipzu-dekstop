import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { DIAGNOSTICS_EXPORT_CHANNEL } from '../../shared/ipc/channels'
import { buildDiagnosticBundle } from '../services/diagnosticBundle'
import { readDiagnosticLogs, writeDiagnostic } from '../services/DiagnosticLog'

export function registerDiagnosticsHandler(
  getWindow: () => BrowserWindow | null,
  getValidation: () => Record<string, boolean | string | number | null>,
): void {
  ipcMain.handle(DIAGNOSTICS_EXPORT_CHANNEL, async () => {
    const date = new Date().toISOString().replace(/[:.]/g, '-')
    const options = {
      title: 'Export Clipzu diagnostics',
      defaultPath: join(app.getPath('documents'), `clipzu-diagnostics-${date}.json`),
      filters: [{ name: 'JSON diagnostic bundle', extensions: ['json'] }],
    }
    const window = getWindow()
    const selected = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (selected.canceled || !selected.filePath) return { ok: false, canceled: true }

    try {
      const bundle = buildDiagnosticBundle({
        appVersion: app.getVersion(),
        platform: process.platform,
        architecture: process.arch,
        createdAt: new Date().toISOString(),
        validation: getValidation(),
        logs: readDiagnosticLogs(),
      })
      writeFileSync(selected.filePath, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      return { ok: true }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      writeDiagnostic('ERROR', 'diagnostics.export.failed', detail)
      return { ok: false, error: 'Could not write the diagnostic bundle.' }
    }
  })
}
