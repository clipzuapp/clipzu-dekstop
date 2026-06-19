# Capcraft Workflow & Architecture Guide

This document provides comprehensive context on dataflow, naming conventions, IPC contracts, and component interactions in the Capcraft codebase.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Flow Patterns](#data-flow-patterns)
3. [IPC Communication Contracts](#ipc-communication-contracts)
4. [State Management Architecture](#state-management-architecture)
5. [Naming Conventions](#naming-conventions)
6. [File Organization Rules](#file-organization-rules)
7. [Component Lifecycle & Interactions](#component-lifecycle--interactions)
8. [Key Workflows](#key-workflows)
9. [Error Handling Strategy](#error-handling-strategy)
10. [Performance Considerations](#performance-considerations)

---

## Architecture Overview

Capcraft follows a **three-layer Electron architecture** with strict separation of concerns:

```
┌─────────────────────────────────────────────────┐
│           Renderer Process (React UI)           │
│  Zustand Stores → Components → Canvas2D/HTML    │
└──────────────────┬──────────────────────────────┘
                   │ contextBridge (preload/index.ts)
┌──────────────────▼──────────────────────────────┐
│            Main Process (Node.js)               │
│  IPC Handlers → Services → Workers/child_process│
└──────────────────┬──────────────────────────────┘
                   │ file system / native binaries
┌──────────────────▼──────────────────────────────┐
│         External Tools & File System            │
│  FFmpeg │ whisper-cli │ sql.js │ .ecp files     │
└─────────────────────────────────────────────────┘
```

### Key Principles

1. **No direct Node.js access from renderer** — all native operations go through IPC
2. **Services are singleton instances** — created in `main/index.ts`, injected into IPC handlers (OOP DI)
3. **Heavy computation offloaded** — Whisper uses direct `child_process.spawn` (no worker_threads), FFmpeg uses `child_process.spawn`, thumbnails use dedicated workers
4. **State flows one-way** — Zustand stores → React components → IPC invoke → Main process → Event back → Store update
5. **Persistent validation cache** — WhisperService skips model validation when model+binary haven't changed across app launches

---

## Data Flow Patterns

### 1. Media Import Flow

```
User clicks "Import" (MediaPanel)
  ↓
window.electron.ipcRenderer.invoke('ffmpeg:openMediaDialog')
  ↓
main/ipc/ffmpeg.handler.ts → dialog.showOpenDialog()
  ↓
FFmpegService.getMediaInfo(filePath) → ffprobe JSON output
  ↓
Returns: { width, height, duration, fps, hasAudio, hasVideo, codec }
  ↓
Renderer: useTimeline.addClip({ path, durationMs, ... })
  ↓
Timeline renders clip block
ThumbnailService.extract(filePath, timestamp) → Base64 thumbnail
  ↓
Timeline displays thumbnail strip
```

**Files Involved:**
- `renderer/components/MediaPanel/index.tsx`
- `preload/index.ts` (channel: `ffmpeg:openMediaDialog`, `ffmpeg:getMediaInfo`)
- `main/ipc/ffmpeg.handler.ts`
- `main/services/FFmpegService.ts`
- `main/services/ThumbnailService.ts`
- `renderer/store/useTimeline.ts`

---

### 2. Transcription Flow

```
User clicks "Transcribe" (CaptionEditor)
  ↓
useCaption.transcribeTimeline() or transcribeClip()
  ↓
window.electron.ipcRenderer.invoke('whisper:transcribeFromTimeline', params)
  ↓
main/ipc/whisper.handler.ts → WhisperService.transcribe()
  ↓
WhisperService resolves model path (fallback chain: q8_0 → base → small-q8_0 → small)
  ↓
For video files: Streaming pipeline (FFmpeg stdout → whisper stdin)
  - FFmpegService spawns ffmpeg → 16kHz mono WAV to pipe
  - whisper-cli reads from stdin, outputs to temp SRT + JSON files
  - On failure: automatic fallback to file-based transcription
  ↓
For audio files: File-based transcription
  - whisper-cli reads audio file directly
  ↓
Progress events: win.webContents.send('whisper:progress', percent)
  ↓
Renderer listens: window.electron.ipcRenderer.on('whisper:progress', handler)
  ↓
WhisperService reads temp SRT file + JSON file (word-level tokens)
  ↓
parseSRTOutput() merges JSON tokens with SRT entries
  - If JSON tokens available: use Whisper timestamps
  - If missing: synthetic fallback (character-count proportional)
  ↓
Returns: { entries, language, telemetry }
  ↓
useCaption store: converts entries to TextClips on timeline
  ↓
CaptionEditor renders editable entries
Silence detection: detectAndStoreSilences() → Timeline markers
```

**Files Involved:**
- `renderer/components/CaptionEditor/index.tsx`
- `renderer/store/useCaption.ts`
- `main/ipc/whisper.handler.ts`
- `main/services/WhisperService.ts` (streaming + file-based + fallback chain)
- `shared/utils/srt.ts` (parseSRT function)

**Key Implementation Details:**
- **Streaming Pipeline**: FFmpeg decodes video to WAV on stdout, piped to whisper-cli stdin (no temp WAV files)
- **Model Fallback Chain**: `ggml-base-q8_0.bin` → `ggml-base.bin` → `ggml-small-q8_0.bin` → `ggml-small.bin`
- **Word Timestamps**: JSON output (`-ojf` flag) provides token-level timing, merged with SRT entries
- **Persistent Cache**: `whisper-cache.json` skips validation when model+binary unchanged across launches

---

### 3. Playback Flow

```
Space key pressed (HotkeyManager)
  ↓
useTimeline.setPlaying(true)
  ↓
Preview component: useEffect starts rAF loop
  ↓
Each frame:
  - Calculate current frame from playheadMs
  - Canvas2D.drawImage(video, crop, transform)
  - Apply clip transform (scale, rotation, position, crop)
  - Render captions (active entries with animations)
  ↓
playheadMs += deltaMs (16.67ms per frame @ 60fps)
  ↓
Timeline playhead updates via Zustand reactivity
  ↓
On clip boundary: load next video element
On timeline end: pause, reset playhead
```

**Files Involved:**
- `renderer/components/HotkeyManager.tsx`
- `renderer/components/Preview/index.tsx` (Canvas2D + rAF)
- `renderer/store/useTimeline.ts`
- `renderer/components/Timeline/index.tsx`

---

### 4. Export Flow

```
User presses Ctrl+E → ExportDialog opens
  ↓
User selects preset, codec, output path
  ↓
useExport.startExport({ clipPaths, audioTracks, srtPath, ... })
  ↓
window.electron.ipcRenderer.invoke('export:start', params)
  ↓
main/ipc/export.handler.ts → ExportQueueManager.addJob()
  ↓
ExportQueue processes job:
  1. Build FFmpeg filter_complex (video concat + transforms + captions)
  2. Spawn FFmpeg with -progress pipe
  3. Parse progress → ipcRenderer.send('export:progress', jobId, percent)
  4. On complete: job.status = 'completed'
  ↓
useExport updates queue status
ExportDialog shows progress bar
```

**Files Involved:**
- `renderer/components/ExportDialog/index.tsx`
- `renderer/store/useExport.ts`
- `main/ipc/export.handler.ts`
- `main/services/ExportQueue.ts`
- `main/services/FFmpegService.ts` (buildExportCommand)

---

### 5. Project Save/Load Flow

```
User presses Ctrl+S
  ↓
Gather state from all stores:
  - useProject: name, fps, resolution, aspectRatio
  - useTimeline: clips, audioTracks, textClips
  - useCaption: activeStyle, language
  ↓
window.electron.ipcRenderer.invoke('project:save', {
  version, name, fps, resolution, aspectRatio,
  clips, audioTracks, textClips,
  captions: { entries (from textClips), style, language },
  exportPreset
})
  ↓
main/ipc/project.handler.ts → JSON.stringify → fs.writeFile(.ecp)
  ↓
.ecp file format:
{
  version: "1.0",
  name, fps, resolution, aspectRatio,
  clips[], audioTracks[], textClips[],
  captions: { entries[], style, language },
  exportPreset
}
  ↓
On load: reverse process → JSON.parse → loadProject(), loadTimeline(), loadCaptions()
```

**Files Involved:**
- `main/ipc/project.handler.ts`
- `renderer/store/useProject.ts`
- `renderer/store/useTimeline.ts`
- `renderer/store/useCaption.ts`

---

## IPC Communication Contracts

### Channel Naming Convention

Format: `domain:action`

Examples:
- `ffmpeg:getMediaInfo`
- `whisper:transcribe`
- `export:start`
- `project:save`
- `startup:validation` (event from main → renderer)

### Invoke Channels (Renderer → Main, Returns Promise)

| Channel | Request Payload | Response Type | Handler File |
|---------|----------------|---------------|--------------|
| `ffmpeg:getMediaInfo` | `filePath: string` | `MediaInfo` object | `ffmpeg.handler.ts` |
| `ffmpeg:extractFrame` | `{ path, timestampMs, width? }` | Base64 string | `ffmpeg.handler.ts` |
| `ffmpeg:getThumbnail` | `{ path, timestampMs, width? }` | Base64 string | `ffmpeg.handler.ts` |
| `ffmpeg:getThumbnailStrip` | `{ path, durationMs, frameCount?, width? }` | Base64[] array | `ffmpeg.handler.ts` |
| `ffmpeg:clearThumbnailCache` | none | `{ success: boolean }` | `ffmpeg.handler.ts` |
| `ffmpeg:getCacheStats` | none | `{ hits, misses, size }` | `ffmpeg.handler.ts` |
| `ffmpeg:openMediaDialog` | none | `string[] \| null` (file paths) | `ffmpeg.handler.ts` |
| `ffmpeg:openSaveDialog` | `defaultName: string` | `string \| null` | `ffmpeg.handler.ts` |
| `ffmpeg:extractAudioFromClip` | `clipPath: string` | `string` (WAV path) | `ffmpeg.handler.ts` |
| `ffmpeg:mixTimelineAudio` | `paths: string[]` | `string` (mixed WAV path) | `ffmpeg.handler.ts` |
| `sfx:getLibrary` | none | `SFXFile[]` | `sfx.handler.ts` |
| `sfx:openFileLocation` | `sfxId: string` | `{ success: boolean }` | `sfx.handler.ts` |
| `file:readBuffer` | `filePath: string` | `Buffer` (as Uint8Array) | `ffmpeg.handler.ts` |
| `whisper:isModelAvailable` | none | `boolean` | `whisper.handler.ts` |
| `whisper:transcribe` | `{ audioPath, language?, wordTimestamps? }` | `{ entries, language }` | `whisper.handler.ts` |
| `whisper:transcribeFromTimeline` | `{ type, clipPath?, mixPaths?, mixSources?, trimStartMs?, trimEndMs?, sourceDurationMs?, language }` | `{ entries, language }` | `whisper.handler.ts` |
| `whisper:cancel` | none | `{ success: boolean }` | `whisper.handler.ts` |
| `whisper:getDiagnostics` | none | `DiagnosticsResult` | `whisper.handler.ts` |
| `whisper:runDiagnosticTests` | none | `DiagnosticTests` | `whisper.handler.ts` |
| `whisper:validateModel` | none | `ModelCompatibilityInfo` | `whisper.handler.ts` |
| `export:start` | `ExportParams` | `ExportJob` | `export.handler.ts` |
| `export:cancel` | `jobId: string` | `{ success: boolean }` | `export.handler.ts` |
| `export:getJobs` | none | `ExportJob[]` | `export.handler.ts` |
| `export:clearCompleted` | none | `{ success: boolean }` | `export.handler.ts` |
| `project:save` | `ProjectFile, filePath?` | `string` (file path) | `project.handler.ts` |
| `project:load` | none | `{ data: ProjectFile, filePath: string } \| null` | `project.handler.ts` |
| `project:exportSRT` | `{ entries, outputPath }` | `string` (SRT path) | `project.handler.ts` |
| `project:createTempSRT` | `{ entries }` | `string` (temp path) | `project.handler.ts` |

### Listen Channels (Main → Renderer, Events)

| Channel | Payload | Triggered By | Purpose |
|---------|---------|--------------|---------|
| `export:progress` | `{ jobId, percent, status }` | ExportQueue | Update export progress bar |
| `whisper:progress` | `percent: number` (0-100) | WhisperService.worker | Update transcription progress |
| `startup:validation` | `StartupValidation` object | main/index.ts | Show environment status on app launch |

### Type Contracts

#### MediaInfo
```typescript
interface MediaInfo {
  path: string
  width: number
  height: number
  durationMs: number
  fps: number
  hasAudio: boolean
  hasVideo: boolean
  videoCodec?: string
  audioCodec?: string
  audioChannels?: number
  audioSampleRate?: number
}
```

#### CaptionEntry (from SRT)
```typescript
interface CaptionEntry {
  id: string              // Unique ID (e.g., "cap_0", "cap_0_a")
  startMs: number         // Start time in milliseconds
  endMs: number           // End time in milliseconds
  text: string            // Caption text
  words?: Array<{         // Optional word-level timing (from Whisper)
    word: string
    startMs: number
    endMs: number
  }>
}
```

#### TextClip (timeline text/caption clip)
```typescript
interface TextClip {
  id: string
  startMs: number
  durationMs: number
  endMs: number
  trackIndex: number
  text: string
  style?: CaptionStyle
  words?: Array<{ word: string; startMs: number; endMs: number }>
}
```

#### ExportJob
```typescript
interface ExportJob {
  id: string                          // UUID
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'error'
  progress: number                    // 0-100
  outputPath: string                  // Final file path
  error?: string                      // Error message if failed
  createdAt: number                   // Timestamp
  completedAt?: number                // Timestamp
}
```

#### StartupValidation
```typescript
interface StartupValidation {
  ffmpeg: boolean                     // ffmpeg binary exists
  ffprobe: boolean                    // ffprobe binary exists
  whisperCli: boolean                 // whisper-cli binary exists
  model: boolean                      // Model file exists (or fallback available)
  vcRuntime: boolean                  // VC++ runtime available (Windows)
  modelWarning?: string               // Human-readable warning
  modelCompatibility?: ModelCompatibilityInfo
}
```

#### ModelCompatibilityInfo
```typescript
interface ModelCompatibilityInfo {
  activeModel: string                 // Currently active model file name
  primaryOk: boolean                  // Whether primary model passed validation
  fallbackLevel: number               // Which fallback step was selected (0 = primary)
  triedModels: Array<{
    file: string
    ok: boolean
    exitCode: number | null
    error?: string
    errorType?: 'crash' | 'timeout' | 'not_found' | 'startup_failed' | 'unknown'
  }>
}
```

---

## State Management Architecture

### Store Responsibilities

#### `useTimeline`
- **Domain**: Video/audio/text clips, tracks, playhead, zoom, selection
- **Key State**:
  - `clips: Clip[]` — Video clips with position, duration, transform, speed
  - `audioTracks: AudioTrack[]` — Audio layers with volume, mute, role
  - `textClips: TextClip[]` — Text/caption clips on timeline with styling
  - `tracks: Track[]` — Track metadata (name, kind, mute, lock, hidden)
  - `playheadMs: number` — Current playback position
  - `totalDurationMs: number` — Timeline duration (auto-calculated)
  - `zoom: number` — Timeline zoom level (0.1–10)
  - `selectedClipId: string | null`
  - `isPlaying: boolean`
  - `markers: TimelineMarker[]` — User/automation markers

- **Key Actions**:
  - `addClip`, `moveClip`, `trimClip`, `deleteClip`, `splitClipAtPlayhead`
  - `addAudioTrack`, `setAudioVolume`, `toggleAudioMute`
  - `addTextClip`, `updateTextClip`, `deleteTextClip`
  - `addTrack`, `deleteTrack`, `renameTrack`, `toggleMuteTrack`, `toggleLockTrack`
  - `addMarker`, `removeMarker`
  - `setPlayhead`, `setZoom`, `selectClip`, `setPlaying`
  - `clearTimeline`, `loadTimeline`, `recalcTotalDuration`

#### `useCaption`
- **Domain**: Transcription entries, styling, editing
- **Key State**:
  - `status: 'idle' | 'transcribing' | 'done' | 'error'`
  - `progress: number` — Transcription progress (0-100)
  - `activeStyle: CaptionStyle` — Font, color, position, animation, alignment, captionMode
  - `selectedId: string | null`
  - `language: string` — Transcription language
  - `error: string | null`

- **Key Actions**:
  - `transcribe(audioPath, language?)` — Start Whisper transcription (legacy)
  - `transcribeClip(clipId, language?)` — Transcribe specific clip
  - `transcribeTrack(trackIndex, language?)` — Transcribe track audio
  - `transcribeTimeline(language?)` — Transcribe entire timeline
  - `cancelTranscription()`
  - `editEntry(id, text)`, `deleteEntry(id)`, `duplicateEntry(id)`, `setEntryTiming(id, start, end)`
  - `splitEntry(id, splitAtMs)`, `splitEntryWithText(id, firstText, secondText, splitAtMs)`
  - `mergeEntries(id1, id2)`
  - `applyStyle(style)` — Apply partial style updates
  - `importSRT(content)` — Batch import SRT file
  - `updateCaptionPosition(id, position)`
  - `reformatForShorts()` — Auto-split long captions for vertical video
  - `detectAndStoreSilences(gapThresholdMs?)` — Find gaps between entries
  - `loadCaptions(data)` — Load captions from project file
  - `clearCaptions()` — Clear all captions

- **CaptionStyle Properties**:
  ```typescript
  interface CaptionStyle {
    fontFamily: string
    fontSize: number
    fontWeight: number
    color: string
    strokeColor: string
    strokeWidth: number
    bgColor: string
    bgOpacity: number
    alignment: 'left' | 'center' | 'right'
    position: 'top' | 'center' | 'bottom'
    x: number
    y: number
    rotation: number
    scale: number
    animation: 'none' | 'pop' | 'fade' | 'slide-up' | 'karaoke' | 'typewriter'
    captionMode: 'full-phrase' | 'word-reveal' | 'karaoke' | 'single-word'
    revealFadeMs?: number
  }
  ```

#### `useExport`
- **Domain**: Export configuration, job queue
- **Key State**:
  - `preset: PresetKey` — Selected export preset
  - `customWidth/Height` — For custom resolution
  - `queue: ExportJob[]` — Export job list
  - `codec: 'h264' | 'h265' | 'prores' | 'vp9'`
  - `qualityPreset: 'fast' | 'slow'`
  - `upscaleEnabled`, `upscaleAlgorithm`
  - `isExporting: boolean`

- **Key Actions**:
  - `setPreset`, `setCustomResolution`, `setCodec`, `setQualityPreset`
  - `startExport(params)` — Send to main process
  - `cancelExport(jobId)`, `clearQueue`
  - `updateProgress(jobId, progress)`, `setJobStatus(jobId, status)`
  - `getOutputDimensions()` — Resolve final width/height

#### `useProject`
- **Domain**: Project metadata, undo/redo
- **Key State**:
  - `name: string`
  - `fps: 24 | 30 | 60`
  - `resolution: { width, height }`
  - `aspectRatio: '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | 'custom'`
  - `projectFilePath: string | null`
  - `isDirty: boolean` — Unsaved changes flag
  - `undoStack: UndoSnapshot[]`
  - `redoStack: UndoSnapshot[]`

- **Key Actions**:
  - `setName`, `setFps`, `setResolution`, `setAspectRatio`
  - `newProject`, `loadProject`
  - `undo`, `redo`, `pushUndo(snapshot)`
  - `markDirty`, `markClean`

#### `useMediaLibrary`
- **Domain**: Imported media items, lazy thumbnails
- **Key State**:
  - `mediaLibrary: MediaInfo[]` — Imported media with path, duration, dimensions
  - `thumbnails: Record<string, string>` — Lazy-loaded thumbnails (mediaId → base64)

- **Key Actions**:
  - `addItem(item)` — Add media to library (deduplicated by path)
  - `removeItem(id)` — Remove media from library
  - `setThumbnail(mediaId, base64)` — Cache thumbnail
  - `removeThumbnail(mediaId)` — Remove thumbnail

#### `useStartup`
- **Domain**: Environment validation, startup checks
- **Key State**:
  - `validation: StartupValidation | null`
  - `showBanner: boolean`

- **Key Actions**:
  - `setValidation(v)` — Set validation results
  - `dismissBanner()` — Hide validation banner

#### `useConfirm`
- **Domain**: Confirmation dialog state
- **Key State**: Modal open/close, message, callbacks

#### `useToast`
- **Domain**: Toast notification state
- **Key State**: Toast queue, auto-dismiss timers

### Undo/Redo Mechanism

**Snapshot-based** (not patch-based):

1. **Trigger**: Before any mutation (addClip, editEntry, deleteClip, addTextClip, etc.)
2. **Capture**: `pushUndoSnapshot()` function in `useTimeline` and `useCaption`
3. **Snapshot Contents**:
   ```typescript
   interface UndoSnapshot {
     clips: Clip[]
     audioTracks: AudioTrack[]
     textClips: TextClip[]
     captions: CaptionEntry[]  // Derived from textClips
   }
   ```
4. **Storage**: `useProject.undoStack` (max 50 entries)
5. **Restore**: `undo()` returns snapshot, renderer applies via `loadTimeline()`, `loadCaptions()`
6. **Redo**: Pushes to `redoStack`, swapped on undo

**Key Files**:
- `renderer/store/useProject.ts` (undo/redo logic)
- `renderer/store/useTimeline.ts` (pushUndoSnapshot calls)
- `renderer/store/useCaption.ts` (pushUndoSnapshot calls)

---

## Naming Conventions

### Files & Directories

| Pattern | Example | Rule |
|---------|---------|------|
| IPC handlers | `ffmpeg.handler.ts` | `{domain}.handler.ts` |
| Services | `FFmpegService.ts` | PascalCase + "Service" suffix |
| Workers | `thumbnail.worker.ts` | `{purpose}.worker.ts` |
| Stores | `useTimeline.ts` | camelCase + "use" prefix (Zustand convention) |
| Components | `MediaPanel/index.tsx` | PascalCase folder, `index.tsx` entry |
| Shared utilities | `srt.ts` | lowercase, no suffix |
| Test files | `test_ggml-small.srt` | `test_` prefix |

### Variables & Functions

| Type | Convention | Example |
|------|-----------|---------|
| Zustand stores | `use{Domain}` | `useTimeline`, `useCaption` |
| State interfaces | `{Domain}State` | `TimelineState`, `CaptionState` |
| Action interfaces | `{Domain}Actions` | `TimelineActions`, `CaptionActions` |
| Event handlers | `handle{Event}` | `handleClick`, `handleDrop` |
| IPC invoke calls | `domain:action` | `'ffmpeg:getMediaInfo'` |
| Time variables | `{name}Ms` | `startMs`, `durationMs`, `playheadMs` |
| Boolean flags | `is{State}`, `has{Feature}` | `isPlaying`, `hasAudio` |

### Component Props

```typescript
interface ComponentNameProps {
  // Required props first
  clip: Clip
  onTransform: (id: string, transform: ClipTransform) => void
  
  // Optional props last
  className?: string
  disabled?: boolean
}
```

---

## File Organization Rules

### Main Process (`src/main/`)

```
main/
├── index.ts                    # App entry, service DI, startup validation
├── ipc/                        # Thin layer: receive IPC → call service → return
│   └── {domain}.handler.ts     # One handler per domain
├── services/                   # Heavy logic, binary interaction
│   └── {Name}Service.ts        # Singleton, injectable
└── workers/                    # Worker thread scripts
    └── {name}.worker.ts        # Isolated computation
```

**Rules**:
- IPC handlers are **thin** — no business logic, just routing
- Services are **thick** — contain all domain logic
- Workers are **isolated** — no direct IPC, communicate via parent thread
- No cross-service imports (e.g., FFmpegService doesn't import WhisperService)
- **Dependency Injection**: Services instantiated in `index.ts`, passed to handler registration functions

### Renderer (`src/renderer/`)

```
renderer/
├── app/                        # App shell (layout, routing)
├── components/                 # UI components
│   └── {ComponentName}/
│       ├── index.tsx           # Main component
│       └── {SubComponent}.tsx  # Internal components (optional)
├── store/                      # Zustand stores
│   └── use{Domain}.ts
├── utils/                      # Renderer-only utilities
│   └── {name}.ts
└── index.html                  # HTML entry
```

**Rules**:
- Components import **only** from `store/`, `utils/`, `shared/`
- No direct IPC calls in components — use stores as intermediaries
- Stores handle IPC invocation and state updates
- Shared utilities (like `srt.ts`) go in `shared/` if used by both main and renderer

### Shared (`src/shared/`)

```
shared/
└── utils/
    └── srt.ts                  # Pure functions, no Node/Electron imports
```

**Rules**:
- **Pure functions only** — no side effects, no imports from `electron` or `node:`
- Used by **both** main and renderer processes
- Examples: SRT parsing, time formatting, data validation

---

## Component Lifecycle & Interactions

### Preview Component

**Lifecycle**:
1. **Mount**: Load first clip into `<video>` element (hidden)
2. **Playing**: `requestAnimationFrame` loop at 30fps
3. **Frame Render**:
   - Calculate active clips at `playheadMs`
   - Draw each clip to Canvas2D with transform
   - Draw active captions with animations
4. **Clip Transition**: Load next video when playhead crosses boundary
5. **Pause**: Cancel rAF, keep video paused
6. **Unmount**: Cleanup video elements, cancel rAF

**Key Dependencies**:
- `useTimeline` — playheadMs, clips, isPlaying
- `useCaption` — entries, activeStyle

---

### Timeline Component

**Lifecycle**:
1. **Mount**: Render track headers, clip blocks, text clips, playhead
2. **Drag & Drop**: `react-dnd` for clip repositioning
3. **Interaction**:
   - Click clip → `selectClip(id)`
   - Drag clip → `moveClip(id, newStartMs, newTrackIndex)`
   - Drag edge → `trimClip(id, trimStart, trimEnd)`
   - Double-click → Open CaptionEditor at clip time
4. **Playhead**: Updates via `setPlayhead(ms)` from rAF or mouse drag
5. **Zoom**: Horizontal scale transforms (CSS `scaleX`)

**Key Dependencies**:
- `useTimeline` — clips, audioTracks, textClips, tracks, playheadMs, zoom
- `useProject` — resolution, aspectRatio

---

### CaptionEditor Component

**Lifecycle**:
1. **Idle**: Show empty state or existing captions
2. **Transcribing**:
   - Disable editing
   - Show progress bar
   - Listen to `whisper:progress` events
3. **Done**:
   - Render editable entries
   - Enable split/merge/delete
   - Sync with Timeline playhead (highlight active entry)
4. **Editing**:
   - Click entry → `selectEntry(id)`
   - Edit text → `editEntry(id, text)` (pushes undo snapshot)
   - Drag edge → `setEntryTiming(id, start, end)`

**Key Dependencies**:
- `useCaption` — entries, status, progress, activeStyle
- `useTimeline` — playheadMs (to highlight active caption)

---

### ExportDialog Component

**Lifecycle**:
1. **Open** (Ctrl+E): Load current project state
2. **Configure**:
   - Select preset → `setPreset(key)`
   - Choose output path → `ffmpeg:openSaveDialog`
   - Toggle upscale, codec, quality
3. **Start Export**:
   - `useExport.startExport({ clipPaths, clipTrackIndices, clipTransforms, audioTracks, ... })`
   - IPC invoke → ExportQueueManager
   - Show progress for each job
4. **Completion**:
   - Job status → 'completed'
   - Enable "Open Folder" button
   - Option to start next export

**Key Dependencies**:
- `useExport` — queue, preset, codec, isExporting
- `useTimeline` — clips, audioTracks (for export params)
- `useCaption` — activeStyle (for caption overlay)

---

## Key Workflows

### Workflow 1: New Project → Import → Transcribe → Export

```
1. App Launch
   → main/index.ts validates FFmpeg, Whisper, model
   → Sends startup:validation to renderer
   → useStartup stores validation result
   → Persistent cache check skips re-validation if model+binary unchanged

2. Import Media
   → MediaPanel → ffmpeg:openMediaDialog
   → FFmpegService.getMediaInfo() → returns MediaInfo
   → useTimeline.addClip({ path, durationMs, ... })
   → useMediaLibrary.addItem() (deduplicated by path)
   → ThumbnailService.extract() → timeline thumbnails

3. Arrange Timeline
   → Drag clips on Timeline (react-dnd)
   → Trim edges, split at playhead (S key)
   → Add audio tracks (background music, SFX) with role classification
   → Add text clips manually
   → Adjust clip transforms (TransformPanel)
   → Adjust clip speed (0.25x – 4.0x)

4. Transcribe Audio
   → CaptionEditor → "Transcribe" button
   → useCaption.transcribeTimeline() or transcribeClip()
   → whisper:transcribeFromTimeline IPC call
   → FFmpegService.extractAudio() or mixTimelineAudioWithOffsets() → temp WAV file
   → WhisperService.transcribe() → whisper-cli.exe (direct spawn)
   → Progress events → useCaption.setProgress()
   → parseSRT() → CaptionEntry[]
   → Convert to TextClips on timeline
   → detectAndStoreSilences() → Timeline markers

5. Edit Captions
   → Click entry → Edit text inline
   → Split long entries (drag edge)
   → Merge short entries
   → Apply style (font, color, animation, alignment)
   → Reposition captions on preview
   → Reformat for Shorts (auto-split >8 words)

6. Export
   → Ctrl+E → ExportDialog
   → Select preset (TikTok 9:16, YouTube 16:9, etc.)
   → Choose codec (H.264, H.265, ProRes, VP9)
   → Set output path
   → startExport() → ExportQueue
   → FFmpeg builds filter_complex:
     [v0]transform[v0t]; [v1]transform[v1t];
     [v0t][v1t]concat=inputs=2[v];
     [v]drawtext=captions[vf]
   → Progress → export:progress events
   → Output: MP4 + SRT sidecar
```

---

### Workflow 2: Project Save/Load

```
Save (Ctrl+S):
1. Gather state:
   - useProject: name, fps, resolution, aspectRatio
   - useTimeline: clips, audioTracks, textClips
   - useCaption: activeStyle, language

2. Invoke: project:save({
   version: "1.0",
   name, fps, resolution, aspectRatio,
   clips, audioTracks, textClips,
   captions: {
     entries: textClips.map(tc => ({ id, startMs, endMs, text })),
     style: activeStyle,
     language
   },
   exportPreset
  })

3. Main process:
   - JSON.stringify(data)
   - fs.writeFile(filePath, json)
   - Returns filePath

4. useProject.setProjectFilePath(filePath)
   useProject.markClean()

Load:
1. ffmpeg:openSaveDialog (for .ecp files)
2. project:load()
3. Main process:
   - fs.readFile(filePath)
   - JSON.parse()
   - Validate schema
   - Returns { data, filePath }

4. Renderer:
   - useProject.loadProject(data)
   - useTimeline.loadTimeline(data)
   - useCaption.loadCaptions(data.captions)
```

---

## Error Handling Strategy

### Main Process (Services)

```typescript
// FFmpegService
try {
  await this.spawnFFmpeg(args)
} catch (error) {
  // Check if binary exists
  if (!existsSync(this.ffmpegPath)) {
    throw new Error(`FFmpeg binary not found at ${this.ffmpegPath}`)
  }
  // Check if error is from FFmpeg stderr
  if (error.stderr) {
    throw new Error(`FFmpeg error: ${error.stderr}`)
  }
  throw error
}

// WhisperService
try {
  const result = await worker.transcribe(audioPath)
} catch (error) {
  // Check model compatibility
  const modelInfo = this.validateModel(modelPath)
  if (!modelInfo.compatible) {
    throw new Error(`Model incompatible: ${modelInfo.reason}`)
  }
  throw error
}
```

### Renderer (Stores)

```typescript
// useCaption.transcribe()
try {
  const result = await ipcRenderer.invoke('whisper:transcribe', audioPath)
  set((state) => {
    state.entries = result.entries
    state.status = 'done'
  })
} catch (err) {
  set((state) => {
    state.status = 'error'
    state.error = (err as Error).message
  })
}

// useExport.startExport()
try {
  const job = await ipcRenderer.invoke('export:start', params)
  set((state) => {
    state.queue.push(job)
  })
} catch (err) {
  set((state) => {
    state.isExporting = false
  })
  // Show error in ExportDialog
  throw err
}
```

### IPC Handlers (Validation)

```typescript
// main/ipc/ffmpeg.handler.ts
ipcMain.handle('ffmpeg:getMediaInfo', async (_, filePath: string) => {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }
  return await ffmpegService.getMediaInfo(filePath)
})

// main/ipc/whisper.handler.ts
ipcMain.handle('whisper:transcribe', async (_, audioPath: string) => {
  if (!whisperService.isModelAvailable()) {
    throw new Error('Whisper model not available. Download model first.')
  }
  return await whisperService.transcribe(audioPath)
})
```

---

## Performance Considerations

### Thumbnail Caching

- **Problem**: Extracting thumbnails on every render blocks UI
- **Solution**: `ThumbnailService` with sql.js cache
  - Cache key: `${filePath}:${timestampMs}:${width}`
  - Cache hit: Return Base64 from SQLite (~5ms)
  - Cache miss: FFmpeg extraction → store → return (~200ms)
  - Worker thread: `thumbnail.worker.ts` for background extraction

### Playback Smoothness

- **Problem**: Video element switching causes stuttering
- **Solution**:
  - Preload next clip 500ms before boundary
  - Use `requestAnimationFrame` (not `setInterval`)
  - Canvas2D drawImage (faster than DOM video element)
  - Decouple playhead updates from render loop

### Transcription Performance

- **Problem**: Whisper blocks main thread
- **Solution**:
  - Direct `child_process.spawn` (no worker_threads needed — spawn is already non-blocking)
  - Streaming pipeline for video: FFmpeg stdout → whisper stdin (eliminates temp WAV files)
  - Automatic fallback to file-based transcription on streaming failure
  - Model fallback chain with persistent validation cache
  - Progress events streamed via IPC
  - Cancel support (`whisper:cancel`) kills both FFmpeg and whisper-cli processes
  - Session-level model resolve cache prevents redundant validation

### Export Queue

- **Problem**: Multiple exports crash FFmpeg
- **Solution**:
  - `ExportQueueManager` — 1 concurrent job max
  - Pending jobs queued, processed sequentially
  - Progress tracked per-job
  - Cancel support (kill FFmpeg process)

---

## Common Pitfalls & Solutions

### 1. Native Module Rebuild

**Problem**: `better-sqlite3` compiled for Node.js, not Electron
**Solution**: 
```bash
npm rebuild better-sqlite3 --runtime=electron --target=30.0.0 --disturl=https://electronjs.org/headers
```

**Current Status**: Replaced with sql.js (pure JS SQLite) — no native rebuild needed

### 2. FFmpeg Path Resolution

**Problem**: FFmpeg not found in production build
**Solution**: 
- Dev: Use `ffmpeg-static` npm package
- Prod: Bundle in `resources/bin/`, resolve via `process.resourcesPath`

### 3. Whisper Model Compatibility

**Problem**: Certain model/whisper-cli combinations crash (e.g., q5_1 kernel bug in v1.8.6)
**Solution**: Multi-layer fallback chain in `WhisperService.resolveModelPathAsync()`
1. Try `ggml-base-q8_0.bin` (fast, ~110MB)
2. Fallback to `ggml-base.bin` (unquantized, ~142MB)
3. Fallback to `ggml-small-q8_0.bin` (higher accuracy, ~370MB)
4. Fallback to `ggml-small.bin` (highest quality, ~466MB)

**Enhancements**: 
- Persistent cache (`whisper-cache.json`) skips validation when model+binary unchanged
- In-memory validation cache prevents re-spawning for models that already crashed in session
- GGML header smoke test (instant file read) at startup before async validation
- Async validation uses `spawn` (not `spawnSync`) to avoid blocking main thread

### 4. Zustand Circular Dependencies

**Problem**: `useTimeline` imports `useCaption`, `useCaption` imports `useTimeline`
**Solution**: Use dynamic imports in actions
```typescript
const { useTimeline } = await import('./useTimeline')
```

### 5. Worker Thread Packaging

**Problem**: Worker script not found in production
**Solution**: Use `__dirname` resolution, bundle in `electron.vite.config.ts`

**Current Status**: WhisperService uses direct spawn (no worker_threads) — eliminates this issue

### 6. TextClip vs CaptionEntry Confusion

**Problem**: Unclear when to use TextClip vs CaptionEntry
**Solution**:
- **CaptionEntry**: Raw SRT data from Whisper (id, startMs, endMs, text, words, wordTimestampsSource)
- **TextClip**: Timeline representation with styling and track position (includes CaptionEntry fields + trackIndex, style, durationMs)
- Transcription converts CaptionEntry[] → TextClip[] on timeline
- **Word Timestamps**: Two sources — 'whisper' (from JSON tokens) or 'synthetic' (character-count proportional fallback)
- **SSOT**: `shared/utils/srt.ts` handles all SRT parsing/generation (pure functions, no side effects)

---

## Development Tips

### Debugging IPC

```typescript
// In renderer
window.electron.ipcRenderer.invoke('ffmpeg:getMediaInfo', path)
  .then(console.log)
  .catch(console.error)

// In main (add logging temporarily)
ipcMain.handle('ffmpeg:getMediaInfo', async (_, filePath) => {
  console.log('[IPC] getMediaInfo:', filePath)
  const result = await ffmpegService.getMediaInfo(filePath)
  console.log('[IPC] getMediaInfo result:', result)
  return result
})
```

### Testing SRT Utilities

```typescript
import { parseSRT, generateSRT } from '../../shared/utils/srt'

const srt = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:04,000 --> 00:00:06,000
Test caption
`

const entries = parseSRT(srt)
console.log(entries) // [{ id: 'cap_0', startMs: 1000, endMs: 3500, text: 'Hello world' }, ...]

const regenerated = generateSRT(entries)
console.log(regenerated) // Should match original SRT
```

### State Inspection

```typescript
// In React DevTools
// Inspect Zustand stores
import { useTimeline } from './store/useTimeline'
console.log(useTimeline.getState())

// Subscribe to changes
useTimeline.subscribe((state) => {
  console.log('Playhead changed:', state.playheadMs)
})
```

---

## Glossary

| Term | Definition |
|------|-----------|
| **SSOT** | Single Source of Truth — e.g., `srt.ts` is the only file that parses/generates SRT |
| **IPC** | Inter-Process Communication — Electron mechanism for main ↔ renderer communication |
| **OOP DI** | Object-Oriented Dependency Injection — Services instantiated in `index.ts`, passed to handlers |
| **rAF** | `requestAnimationFrame` — Browser API for smooth 60fps rendering |
| **ffprobe** | FFmpeg probe tool — extracts media metadata (codecs, duration, fps) |
| **whisper-cli** | Command-line Whisper binary — performs offline speech-to-text |
| **.ecp** | Electron Capcraft Project — JSON-based project file format |
| **filter_complex** | FFmpeg advanced filter graph — used for video compositing during export |
| **Immer** | Immutability library — allows "mutable" syntax in Zustand while keeping state immutable |
| **contextBridge** | Electron API — safely exposes IPC to renderer with context isolation |
| **TextClip** | Timeline text/caption clip with styling, track position, and timing |
| **CaptionEntry** | Raw SRT entry from Whisper (id, startMs, endMs, text, words) |
| **Role Classification** | Audio track categorization (voice, music, sfx, ambient) for transcription filtering |

---

## Quick Reference

### Adding a New IPC Channel

1. **Define channel name**: `domain:action`
2. **Add to preload/index.ts**:
   ```typescript
   const validChannels = [..., 'domain:action']
   ```
3. **Create handler**: `main/ipc/domain.handler.ts`
   ```typescript
   ipcMain.handle('domain:action', async (_, params) => {
     return await service.doSomething(params)
   })
   ```
4. **Call from renderer**:
   ```typescript
   const result = await window.electron.ipcRenderer.invoke('domain:action', params)
   ```

### Adding a New Zustand Store

1. **Create file**: `renderer/store/use{Domain}.ts`
2. **Define interfaces**:
   ```typescript
   interface DomainState { ... }
   interface DomainActions { ... }
   ```
3. **Create store**:
   ```typescript
   export const useDomain = create<DomainState & DomainActions>()(
     immer((set) => ({ ...initialState, ...actions }))
   )
   ```
4. **Add to undo** (if needed):
   - Call `pushUndoSnapshot()` before mutations
   - Include in UndoSnapshot interface in `useProject.ts`
   - Implement `loadDomain()` for restoration

### Adding a New Component

1. **Create folder**: `renderer/components/ComponentName/`
2. **Create entry**: `index.tsx`
3. **Define props interface**
4. **Import stores** (not IPC directly)
5. **Export as default**

---

## Related Files

- `README.md` — Project overview, setup, build instructions, minimum requirements
- `blueprint.txt` — Original project requirements
- `electron.vite.config.ts` — Build configuration
- `electron-builder.yml` — Packaging configuration
- `package.json` — Dependencies, scripts
- `start.bat` — Windows development launcher with dependency checks

---

**Last Updated**: June 19, 2026
**Version**: 1.2.0
**Changes**: Updated to reflect streaming transcription pipeline, model fallback chain, SFX integration, deferred undo infrastructure, CaptionStyle enhancements (captionMode, revealFadeMs), and current IPC channels
