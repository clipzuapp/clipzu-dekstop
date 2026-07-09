// ---------------------------------------------------------------------------
// TranscriptPanel — Unified transcription + caption editing + style presets
// ---------------------------------------------------------------------------
//
// Composes CaptionEditor (transcription, entry editing, SRT import, diagnostics)
// and CaptionPresetPanel (visual style presets) into a single panel.
//
// Domain boundary:
//   - LEFT panel = CONTENT (what is said, when, transcription, editing)
//   - RIGHT Inspector = STYLE (how it looks — CaptionStyleTab, Animation tab)
//
// This follows CapCut's pattern: one tab for all caption/transcript work,
// with styling delegated to the Inspector.

import { CaptionEditor } from '../CaptionEditor/index'
import { CaptionPresetPanel } from '../CaptionPresetPanel/index'

export function TranscriptPanel(): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Transcription + entry editing — fills available space */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <CaptionEditor />
      </div>
      {/* Style presets — pinned to bottom, scrollable if needed */}
      <div style={{ borderTop: '0.5px solid var(--border)', maxHeight: '45%', overflow: 'auto' }}>
        <CaptionPresetPanel />
      </div>
    </div>
  )
}

export default TranscriptPanel
