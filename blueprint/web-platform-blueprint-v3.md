# Capcraft Web Platform Blueprint v3.0
## Hyper-Specific Migration & Architecture Document

> **STATUS: PLANNING ONLY — NO CODE CHANGES**
> This document references actual Capcraft source code: real types, real functions, real line numbers.
> Every migration item maps to a specific file and behavior in the current Electron app.

---

# PART 1: CURRENT CAPCRAFT — COMPLETE FEATURE INVENTORY

## 1.1 Core Type System (`src/renderer/store/useTimeline.ts`, 1513 lines)

Every piece of data in Capcraft is defined by these interfaces. They are the SSOT.

### Clip (video/image on timeline)
```
id: string
path: string                    ← LOCAL FILE PATH (must become CDN URL)
startMs: number                 ← position on timeline
sourceDurationMs: number
durationMs: number              ← visible duration after speed adjustment
trackIndex: number              ← vertical lane (0 = top video track)
trimStart / trimEnd: number     ← source-level trim
hasAudio: boolean
transform: ClipTransform        ← see below
speed: number                   ← 0.25 to 4.0
volume: number                  ← 0 to 2.0
muted: boolean
fadeInMs / fadeOutMs: number
keyframes: KeyframeTrack[]      ← per-property animation
modifiers: Modifier[]           ← filter stack (blur, brightness, etc.)
outTransition: Transition       ← transition at clip exit point
blendMode: BlendMode            ← normal|multiply|screen|overlay|darken|lighten|color-dodge|color-burn|soft-light|difference
```

### ClipTransform
```
x: number, y: number            ← position offset in project pixels
scaleX: number, scaleY: number  ← 5% to 400%
rotation: number                ← -180° to +180°
opacity: number                 ← 0-100
cropTop/cropBottom/cropLeft/cropRight: number ← 0-50% each
```

### AudioTrack (standalone audio on timeline)
```
id, path, startMs, sourceDurationMs, durationMs
volume, muted
role: 'voice' | 'music' | 'sfx' | 'ambient'   ← drives color coding in Timeline
trackIndex, trimStart/trimEnd
fadeInMs / fadeOutMs
keyframes: KeyframeTrack[]
```

### TextClip (caption/text overlay)
```
id, startMs, durationMs, endMs, trackIndex
text: string
style: CaptionStyle             ← see CaptionStyle below
words: WordTimestamp[]           ← word-level timing from Whisper
wordTimestampsSource: 'whisper' | 'synthetic'
sourceId, sourceType, transcriptionJobId
originalWords / originalStartMs / originalEndMs   ← non-destructive trim tracking
fadeInMs / fadeOutMs
keyframes: KeyframeTrack[]
```

### Track (lane metadata)
```
id, index, name, kind: 'video' | 'audio' | 'caption' | 'overlay'
muted, locked, hidden, solo
```

### CaptionStyle (from `useCaption.ts`)
```
fontFamily: string              ← default 'Inter' (from AVAILABLE_FONTS)
fontSize: number                ← 12-120px, default 48
fontWeight: number              ← 300-900, default 700
textColor: string               ← default '#FFFFFF'
strokeColor: string             ← default '#000000'
strokeWidth: number             ← 0-10, default 1
textAlign: 'left'|'center'|'right'
bgOpacity: number               ← 0-100, default 50
bgColor: string                 ← default '#000000'
mode: 'full-phrase'|'word-reveal'|'karaoke'|'single-word'
revealFadeMs: number            ← 0-200, for word-reveal smoothness
positionX / positionY: number   ← 0-100, default x:50 y:75
activeHighlightColor: string    ← default '#FFD700' (karaoke mode)
activeTextColor: string         ← default '#000000'
activeScale: number             ← 50-200, default 100
animationPreset: 'pop'|'fade'|'slide-up'|'karaoke'|'typewriter'|'none'
```

### KeyframeTrack & Modifier
```
KeyframeTrack: { property: string, keyframes: Keyframe[] }
Keyframe: { timeMs: number, value: number, easing: EasingType }
EasingType: 'linear'|'ease-in'|'ease-out'|'ease-in-out'|'cubic-bezier'|'bounce'|'elastic'|'spring'

Modifier: { type: string, enabled: boolean, params: Record<string, number> }
  Types: 'blur', 'brightness', 'contrast', 'saturation', 'hue-rotate', 'grayscale', 'sepia', 'invert'
```

### Transition
```
type: 'crossfade'|'dip-to-black'|'slide-left'|'slide-right'|'slide-up'|'slide-down'|'zoom-in'|'zoom-out'|'wipe-left'|'wipe-right'
durationMs: number
```

## 1.2 All 10 Zustand Stores

### useTimeline (1513 lines) — THE core state
- **50+ actions**: addClip, moveClip, trimClip, deleteClip, duplicateClip, splitClipAtPlayhead, setClipTransform, setClipSpeed, setClipVolume, setClipMute, setClipFade, addAudioTrack, addMediaBatch, rippleDeleteClip, copySelection, cutSelection, pasteAtPlayhead, selectClip, toggleClipSelection, selectClipRange, selectAll, selectBox, setKeyframe, deleteKeyframe, addModifier, removeModifier, setOutTransition, setBlendMode, addTextClip, selectTextClip, etc.
- **Undo system**: Deep clone snapshots via `structuredClone`, max 20 stack depth, 5MB per snapshot limit
- **Deferred drag**: `beginDragCapture()` → `commitDrag()` / `cancelDrag()` — avoids undo spam during timeline drags
- **Clipboard**: Module-level `_clipboard` (clip data) and `_styleClipboard` (CaptionStyle)
- **In/Out points**: Module-level `_inPointMs` / `_outPointMs` for loop regions
- **Selection model**: Anchor/focus unified selection — `focusedId`, `selectedClipIds` Set, `selectedTextClipIds` Set

### useCaption (653 lines) — Transcription & caption management
- **4 transcription scopes**:
  - `transcribe(audioPath)` — single audio file
  - `transcribeClip(clipId)` — audio from one video clip
  - `transcribeTrack(trackIndex)` — mix all clips on a track + voice-role audio tracks
  - `transcribeTimeline()` — mix all clip audio + all voice-role audio tracks
- **`_runTranscription()`**: Shared lifecycle — sets status/progress, invokes IPC, maps results to TextClip[], handles errors, cleans up progress listener
- **`retimeWordsForEditedText()`**: When user edits caption text, redistributes word timestamps (preserves if word count matches, else proportional redistribution)
- **`mergeEntries()`**: Merges two captions with word timestamp offset normalization, non-destructive trim reconstruction, whisper source priority
- **`splitEntryWithText()`**: Splits caption at a point with custom text for each half
- **`reformatForShorts()`**: Splits phrases into individual word clips — Path A (real word timestamps, one clip per word) vs Path B (no timestamps, split by spaces equally)
- **`detectAndStoreSilences()`**: Finds gaps between captions >= threshold (default 1500ms), adds timeline markers
- **Bulk style ops**: `applyPresetToSelection()`, `applyPresetToAll()`, `applyStyleToSelection()` — merge order: defaultStyle → existingStyle → presetStyle

### useExport (257 lines) — Export configuration
- **9 presets**: tiktok-reels (1080×1920), youtube (1920×1080), instagram-post (1080×1080), instagram-port (1080×1350), 4k-vertical (2160×3840, requiresUpscale), 4k-horizontal (3840×2160, requiresUpscale), prores (1920×1080, codec:prores), webm (1920×1080, codec:vp9), custom
- **4 codecs**: h264, h265, prores, vp9
- **Bitrate control**: auto | cbr | vbr
- **Frame range export**: exportFrameRange flag
- **Audio-only mode**: audioOnly flag
- **FPS**: 24 | 30 | 60
- **Hardware accel toggle**: hardwareAccel
- **Upscale**: lanczos | bicubic algorithm selection
- **`startExport()`**: Sends massive IPC payload with all clip data (paths, track indices, hasAudio, hidden, videoMuted, fadeIn/Out, transforms, volumes, startMs, durationMs, trimStarts, speeds), all audio tracks (path, startMs, volume, trimStart, durationMs, fadeIn/Out), SRT path, caption style, output path, total duration, project dimensions, FPS

### useProject (188 lines) — Project-level settings
- **Resolution presets**: 16:9, 9:16, 1:1, 4:5, 4:3
- **Undo/redo stack**: Max 20 depth, 5MB per snapshot limit (shared with useTimeline)
- **backgroundColor**: Project canvas background
- **Aspect ratio management**: Links resolution to aspect ratio preset

### useMediaLibrary (202 lines) — Media asset management
- **LRU thumbnail cache**: 500 entries max
- **Multi-select**: Ctrl/Cmd+click support
- **Search + type filter**: Text search combined with media type filter
- **Deduplication**: By file path

### usePreviewView — Fullscreen preview state
- `isFullscreen`, `toggleFullscreen()`

### useToast — Notification toasts
- `success()`, `error()`, `warning()` methods

### useStartup — Binary validation on app launch
- Checks: FFmpeg, ffprobe, whisper-cli, AI model, VC++ runtime
- Drives the startup validation banner in page.tsx (line 377-410)

### usePlayback (inside Preview) — Play/pause/loop state
- `isPlaying`, `loopEnabled`, `masterVolume`

### useUI (inside page.tsx) — Panel sizes, active tool, active tabs
- `mediaPanelW`, `inspectorW`, `timelineH` with clamp functions

## 1.3 All 4 Renderer Services

### AudioEngine (`src/renderer/services/AudioEngine.ts`, 465 lines)
- **Singleton AudioContext**, per-track AudioBufferSourceNode + GainNode graph
- **512MB LRU buffer cache** with eviction
- **`preloadBuffer(path)`**: Uses IPC for file:// paths (line 87-90), **fetch for http/https (line 91-94)** — ALREADY SUPPORTS HTTP URLs
- **`playTracks()`**: Creates source+gain per track, handles fade-in via AudioParam linearRamp, fade-out scheduling with speed scaling, offset calculation accounting for trimStart and timelineMs
- **`playScrub()`**: 100ms burst with 5ms anti-click envelope, throttled to ~16Hz
- **`connectOverlayAudio()`**: createMediaElementSource (once per element), routes through GainNode to master
- **`setTrackVol()`**: Cancels scheduled fade ramps, sets gain immediately for real-time updates
- **`disconnectOverlayAudio()`**: Disconnects media element source

### FFmpegService (`src/renderer/services/FFmpegService.ts` — WASM version for web)
- Currently in main process; for web, becomes FFmpeg WASM in Web Worker
- Same API surface: probe, extract, render

### WaveformService — Dual-peak envelope generation
- Generates waveform data for Timeline display
- For web: runs in Web Worker to avoid blocking UI

### NotificationSound — Pre-loaded SFX
- `preloadSounds()` called on mount in page.tsx (line 85)

## 1.4 All 22 Components with Exact Behaviors

### Preview (`src/renderer/components/Preview/index.tsx`, 1701 lines)
The heart of Capcraft's rendering. Contains 10+ React effects:

- **`toFileUrl(clip.path)`** (line 189-194): Converts local paths to file:// URLs — **THE #1 MIGRATION POINT: must become CDN URLs**
- **Effect 1** (line 271): Loads video source via `video.src = toFileUrl(clip.path)` — finds clip at playhead, sets `<video>` src
- **Effect 2** (line 311): Manual seek when user scrubs while paused — threshold 0.05s to avoid redundant seeks
- **Effect 3** (line 327): Play/pause — auto-snaps playhead to clip start if before it (BUG-01 fix)
- **Effect 4** (line 366): Syncs playhead from video during playback (throttled ~30fps, MIN_INTERVAL=32ms) — reverse-maps video.currentTime to timeline-global position: `timelineMs = startMs - trimStart + (videoTime * 1000) / speed`
- **Effect 4b** (line 448): Overlay video pool for multi-layer compositing — MAX 4 overlays, creates `<video>` elements dynamically, routes audio through AudioEngine via createMediaElementSource, applies blendMode via CSS mixBlendMode, applies modifiers via CSS filter, applies keyframe opacity
- **Effect 4d** (line 547): Audio scrub preview — plays 100ms burst when playhead moves while paused, throttled to 60ms intervals
- **Effect 5** (line 583): Canvas2D caption rendering loop at 30fps (FRAME_INTERVAL = 33ms)
  - Per-clip activation cache (`activationCacheMapRef`) — avoids O(log n) binary search every frame
  - Caption dispatch (line 638-657): switches between 4 draw functions based on `style.mode`
- **Transform gizmo** (line 690-732): Hit testing for move/rotate/scale handles with density-aware HANDLE_RADIUS
- **Transition system** (line 1071-1153): Detects outTransition zones, computes exit/enter opacity and transforms for 10 transition types
- **`drawFullPhraseCaption`** (line 1307): Uses `computeCaptionLayout()` SSOT, word wrapping, stroke, background box
- **`drawWordRevealCaption`** (line 1356): Words become visible after their startTime, smoothstep easing for fade
- **`drawWordRevealSmooth`** (line 1403): Per-word opacity with text wrapping, individual word positioning
- **`drawKaraokeCaption`** (line 1524): Full phrase visible, active word highlighted with configurable highlight color, text color, and scale
- **`drawSingleWordCaption`** (line 1594): Displays only active word centered, with optional scale
- **`drawTransformBox`** (line 1646): Dashed bounding box, 8 handles (4 corners + 4 edges) + rotation handle above top

### Timeline (`src/renderer/components/Timeline/index.tsx`, 1107 lines)
Canvas-based timeline with InteractionMachine state machine:

- **Lane layout**: Video tracks + audio lanes + caption lane
- **Zoom**: `PIXELS_PER_MS = 0.1 * zoom`, zoom range 0.02 to 10
- **Dynamic ruler intervals** (line 800-806): Targets ~80-120px between major ticks, nice intervals from 100ms to 600000ms
- **Role-based audio color coding**: sfx (#261a10), voice (#1a2614), ambient (#221428), music (#141e28)
- **Waveform rendering**: Dual-peak envelope from WaveformService, scaled by track volume
- **Fade edge triangles** with handle indicators (line 871-931)
- **Keyframe diamond markers** on selected clips (line 1071-1104)
- **Transition icon** at clip out-point (purple overlay with ◇ symbol)
- **Box-select visualization** (dashed rectangle)
- **Snap-line visual indicator** during drag
- **Custom MIME types for drag-and-drop**: `application/capcraft-media` (single), `application/capcraft-media-batch` (multi)
- **Native non-passive wheel listener** (line 307-338): Ctrl+wheel = zoom (preserving cursor position), Shift+wheel = horizontal scroll
- **Context menus**: ruler, clips, audio tracks, captions, empty areas

### Inspector (`src/renderer/components/Inspector/index.tsx`, 1040 lines)
Context-sensitive property editor with 6 sub-panels:

- **Priority routing** (line 1000-1027): caption > clip > audioTrack > projectSettings
- **ClipBasicTab**: Transform (scale 5-400%, rotation ±180°, opacity 0-100%), Crop (0-50% each side), Audio (volume -30dB to +6dB, mute), Fade in/out (0-30s), KeyframeEditor
- **CaptionStyleTab**: Font family, size (12-120px), weight (300-900), text/stroke colors with swatches, stroke width (0-10), alignment, BG opacity, Caption mode selector, Reveal fade (0-200ms), Active state (highlight color, text color, scale 50-200%), Position X/Y (0-100%), "Apply to All" button
- **CaptionAnimationTab**: 6 presets (pop, fade, slide-up, karaoke, typewriter, none), seek-to-start preview
- **AudioTab**: Per-track volume with real-time AudioEngine sync, dB display
- **SpeedTab**: 0.25x-4.0x with presets (0.5x, 1.0x, 1.5x, 2.0x)
- **AudioTrackBasicTab**: Volume, mute, fade in/out, role badge display
- **ProjectSettings**: Aspect ratio presets (9:16, 16:9, 1:1, 4:5, 4:3), resolution (100-7680), FPS (24/30/60), background color, duration display

### page.tsx (`src/renderer/app/page.tsx`, 571 lines)
Main layout orchestrator:

- **4-column layout**: LeftRail (64px) + ContentPanel (18% width, 160-30% responsive) + Preview (flex) + Inspector (20% width, 200-32% responsive) + RightRail (64px)
- **Timeline at bottom**: 25% height, 100-45% responsive
- **Toolbar** (38px): CAPCRAFT logo, 4 tools (V/B/H/Z), separator, undo/redo, CC transcribe, T (add text), Export
- **Startup validation banner** (line 377-410): Checks FFmpeg, ffprobe, whisper-cli, model, VC++ runtime
- **Fullscreen preview overlay** (line 543-567): Only mounts one Preview instance at a time
- **Resize handles** with `makeResizeHandler` factory: Reads window dimensions at drag-start for max calculation

### Other Components
- **LeftRail** (64px): Tab navigation — Media, Text, Audio, Effects, Filters, Caption Presets, Coming Soon
- **RightRail** (64px): Context-sensitive tab — Basic, Style, Animation, Audio
- **MediaPanel**: Drag-and-drop import, thumbnail grid, search/filter
- **TextPanel**: Add text overlays
- **AudioPanel**: Audio asset browser
- **EffectsPanel**: Effects browser (data-driven from EffectRegistry)
- **FiltersPanel**: Filter browser (data-driven from ModifierEngine)
- **CaptionEditor**: Text editing for caption entries
- **CaptionPresetPanel**: Caption style presets
- **CaptionStrip**: Horizontal caption strip preview
- **PlaybackControls**: Play/pause, time display, seek bar
- **ExportDialog**: Export configuration UI (mirrors useExport state)
- **ConfirmDialog**: Generic confirmation modal
- **ShortcutsDialog**: Keyboard shortcut reference
- **ToastContainer**: Toast notification display
- **HotkeyManager**: Global keyboard shortcut handler
- **ComingSoonPanel**: Placeholder for unimplemented features
- **ErrorBoundary**: React error boundary wrapper

## 1.5 Main Process Services (Electron-specific, ALL must be replaced)

### FFmpegService (`src/main/services/FFmpegService.ts`, 947 lines)
- **CRF policy**: H264 (fast:20, slow:18), H265 (fast:24, slow:20), VP9 (fast:33, slow:30)
- **Audio normalization**: `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`
- **OOP class** with constructor DI (ffmpegPath, ffprobePath)
- **`getFontsDir()`**: Resolves bundled fonts from resources path
- **`escapeFilterPath()`**: Backslash→forward, colon escape, single quote escape
- **Error classification**: 5 patterns (stream specifier, invalid option, file not found, encoder error, moov atom)
- **Progress parsing**: time=HH:MM:SS.CC, fps, speed
- **`spawn()`**: Generic FFmpeg process spawner with progress callback
- **`getMediaInfo()`**: ffprobe JSON output parser — duration, width, height, fps, codec, hasAudio, fileSize

### WhisperService — Speech-to-text
- Spawns whisper-cli process
- Parses SRT output into WordTimestamp[]
- Progress reporting

### ExportQueue — Job queue
- 1 concurrent job, priority-based
- Progress events via IPC

### MediaService — File operations
- Media import, thumbnail generation, waveform extraction

## 1.6 All 25 IPC Channels (Must become REST/WebSocket)

| IPC Channel | Direction | Purpose | Web Replacement |
|---|---|---|---|
| `media:import` | renderer→main | Import media file | POST /api/media/import |
| `media:probe` | renderer→main | Get media metadata | POST /api/media/probe |
| `media:thumbnail` | renderer→main | Generate thumbnail | POST /api/media/thumbnail |
| `media:waveform` | renderer→main | Extract waveform data | POST /api/media/waveform |
| `media:extract-audio` | renderer→main | Extract audio track | POST /api/media/extract-audio |
| `export:start` | renderer→main | Begin render job | POST /api/export/start |
| `export:cancel` | renderer→main | Cancel render job | POST /api/export/cancel |
| `export:progress` | main→renderer | Progress updates | WebSocket: export:progress |
| `transcribe:start` | renderer→main | Begin transcription | POST /api/transcribe/start |
| `transcribe:progress` | main→renderer | Transcription progress | WebSocket: transcribe:progress |
| `transcribe:result` | main→renderer | Transcription result | WebSocket: transcribe:result |
| `project:save` | renderer→main | Save .ecp project | POST /api/project/save |
| `project:load` | renderer→main | Load .ecp project | POST /api/project/load |
| `project:autosave` | renderer→main | Autosave trigger | POST /api/project/autosave |
| `startup:validation` | main→renderer | Binary check results | Not needed (no binaries) |
| `fs:read-file` | renderer→main | Read file as buffer | GET /api/storage/file |
| `fs:write-file` | renderer→main | Write file | POST /api/storage/file |
| `fs:exists` | renderer→main | Check file exists | HEAD /api/storage/file |
| `fs:readdir` | renderer→main | List directory | GET /api/storage/dir |
| `fs:mkdir` | renderer→main | Create directory | POST /api/storage/dir |
| `fs:delete` | renderer→main | Delete file | DELETE /api/storage/file |
| `fs:copy` | renderer→main | Copy file | POST /api/storage/copy |
| `fs:get-temp-dir` | renderer→main | Get temp directory | Not needed (managed) |
| `dialog:open-file` | renderer→main | File picker dialog | Browser file input |
| `dialog:save-file` | renderer→main | Save file dialog | Browser download |

## 1.7 Effects System (16 files in `src/shared/effects/`)

### EffectRegistry
- Data-driven effect definitions with parameter schemas
- Each effect: id, name, category, params[], previewThumbnail

### ModifierEngine
- Processes Modifier[] stack into CSS filter string or FFmpeg filter graph
- Types: blur, brightness, contrast, saturation, hue-rotate, grayscale, sepia, invert
- `buildCssFilter(modifiers)` — used in Preview overlay compositing (line 525)

### TransitionRegistry
- 10 transition types with render functions
- Used in Preview transition system (line 1071-1153)

### PresetRegistry
- Named preset combinations of effects + modifiers
- Applied via `applyPresetToSelection()` in useCaption

### Keyframe Engine
- Evaluates KeyframeTrack[] at a given timeMs
- 8 easing curves: linear, ease-in, ease-out, ease-in-out, cubic-bezier, bounce, elastic, spring
- `evaluateKeyframes(tracks, localTimeMs)` — used in Preview (line 530)

## 1.8 Shared Utilities

- **`color.ts`**: `toAssColor()` — converts hex to ASS subtitle color format (used by FFmpegService)
- **`srt.ts`**: SRT parser/generator, `ExportCaptionStyle` type
- **`easing.ts`**: 8 easing functions for keyframe animation
- **`caption-layout.ts`**: `computeCaptionLayout()` — SSOT for caption positioning, word wrapping, bounds calculation

---

# PART 2: WEB PLATFORM ARCHITECTURE

## 2.1 Tech Stack Decision

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | Next.js 15 (App Router) + React 19 | SSR for landing, CSR for editor. Same React 18 patterns (hooks, refs, effects) work unchanged |
| **State** | Zustand 5 + Immer | **KEEP EXACTLY AS-IS** — all 10 stores migrate directly |
| **Styling** | Tailwind CSS + CSS variables | **KEEP EXACTLY AS-IS** — design tokens (--bg0, --bg1, --text1, --accent, etc.) unchanged |
| **Canvas** | Canvas2D API | **KEEP EXACTLY AS-IS** — caption rendering, timeline rendering, transform gizmo all use standard Canvas2D |
| **Audio** | Web Audio API | **KEEP EXACTLY AS-IS** — AudioEngine already supports http:// URLs (line 91-94) |
| **API** | Hono on Node.js | Lightweight, TypeScript-first, WebSocket support |
| **Database** | PostgreSQL (Supabase) | Auth + project metadata + user data |
| **Storage** | Cloudflare R2 | **Zero egress fees** — critical for video serving |
| **Queue** | BullMQ + Redis | Replaces ExportQueue (1 concurrent → many concurrent) |
| **Realtime** | Socket.io | Replaces all IPC main→renderer events |
| **Search** | Meilisearch | Media search, project search, template search |
| **CDN** | Cloudflare | In front of R2 for global delivery |

## 2.2 What Migrates AS-IS vs What Changes

### Migrates AS-IS (no code changes needed):
1. **All 10 Zustand stores** — pure state logic, no Electron dependency (except IPC calls which get swapped)
2. **All Canvas2D rendering** — Preview caption loop, Timeline canvas, transform gizmo
3. **AudioEngine** — already supports http:// URLs, Web Audio API is browser-native
4. **All type definitions** — Clip, AudioTrack, TextClip, Track, CaptionStyle, KeyframeTrack, Modifier, Transition, ClipTransform, BlendMode
5. **All easing functions** — pure math
6. **Caption layout engine** — `computeCaptionLayout()` pure function
7. **SRT parser/generator** — pure string processing
8. **EffectRegistry, ModifierEngine, TransitionRegistry, PresetRegistry** — pure data + logic
9. **All Tailwind CSS + design tokens** — identical in browser

### Needs Adaptation (same logic, different I/O):
1. **`toFileUrl(clip.path)`** → `clip.url` (CDN URL from R2)
   - Affects: Preview line 285, 501; Timeline; AudioEngine preloadBuffer
   - Change: `path: string` field becomes `url: string` on Clip, AudioTrack
2. **IPC calls** → REST API calls
   - 25 channels mapped in section 1.6
   - Pattern: `window.electron.ipcRenderer.invoke('media:probe', path)` → `fetch('/api/media/probe', { body: { url } })`
3. **IPC listeners** → WebSocket events
   - `window.electron.ipcRenderer.on('export:progress', ...)` → `socket.on('export:progress', ...)`
   - Affected: page.tsx line 155 (startup:validation), line 165 (export:progress)
4. **FFmpegService** → FFmpeg WASM (client) + FFmpeg server-side
   - Client: thumbnails, short previews, audio extraction for Whisper
   - Server: full export render, complex compositing
5. **WhisperService** → Whisper API (server-side) or faster-whisper on GPU
   - Client: small files < 30s via whisper.cpp WASM (optional)
   - Server: all files via GPU-accelerated whisper

### Removed Entirely:
1. **Startup validation** (useStartup) — no binaries to check
2. **`getFontsDir()`** — fonts served via CDN
3. **`escapeFilterPath()`** for Windows paths — server handles path escaping
4. **File system IPC** (fs:read-file, fs:write-file, etc.) — replaced by object storage
5. **Dialog IPC** (dialog:open-file, dialog:save-file) — browser native file input/download

## 2.3 New Backend Architecture

### API Server (Hono on Node.js)

```
POST   /api/auth/signup           — Create account (email + OAuth)
POST   /api/auth/login             — Login
POST   /api/auth/refresh           — Refresh JWT
POST   /api/auth/logout            — Logout

GET    /api/projects               — List user's projects
POST   /api/projects               — Create project
GET    /api/projects/:id           — Get project (JSON metadata)
PUT    /api/projects/:id           — Update project metadata
DELETE /api/projects/:id           — Delete project
POST   /api/projects/:id/save      — Save project state (full timeline JSON)
POST   /api/projects/:id/load      — Load project state
POST   /api/projects/:id/autosave  — Autosave (debounced)
POST   /api/projects/:id/duplicate — Duplicate project

POST   /api/media/upload           — Initiate upload (presigned R2 URL)
POST   /api/media/probe            — Probe uploaded media (ffprobe)
POST   /api/media/thumbnail        — Generate thumbnail (FFmpeg WASM or server)
POST   /api/media/waveform         — Extract waveform data
POST   /api/media/extract-audio    — Extract audio track
GET    /api/media/:id              — Get media metadata
DELETE /api/media/:id              — Delete media

POST   /api/export/start           — Start render job
POST   /api/export/cancel          — Cancel render job
GET    /api/export/:jobId/status   — Get job status
GET    /api/export/:jobId/download — Download completed export

POST   /api/transcribe/start       — Start transcription
POST   /api/transcribe/cancel      — Cancel transcription
GET    /api/transcribe/:jobId      — Get transcription result

GET    /api/billing/usage          — Get current usage
POST   /api/billing/subscribe     — Create subscription
POST   /api/billing/portal        — Stripe portal

WS     /ws                         — WebSocket for realtime events
```

### WebSocket Events (replaces IPC main→renderer):
```
export:progress     → { jobId, progress, status, error? }
transcribe:progress → { jobId, progress, status }
transcribe:result   → { jobId, entries: TextClip[] }
collab:update       → { projectId, userId, patch }  (future: real-time collab)
```

### Database Schema (PostgreSQL via Supabase)

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free',          -- free | pro | business
  storage_used_bytes BIGINT DEFAULT 0,
  storage_limit_bytes BIGINT,        -- free: 1GB, pro: 50GB, business: 500GB
  export_minutes_used INT DEFAULT 0,
  export_minutes_limit INT,          -- free: 30/mo, pro: unlimited
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled',
  width INT NOT NULL DEFAULT 1920,
  height INT NOT NULL DEFAULT 1080,
  fps INT NOT NULL DEFAULT 30,
  background_color TEXT DEFAULT '#000000',
  state JSONB,                       -- Full timeline state (clips, tracks, captions, etc.)
  thumbnail_url TEXT,
  duration_ms BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_saved_at TIMESTAMPTZ
);

-- Media assets
CREATE TABLE media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  width INT,
  height INT,
  duration_ms BIGINT,
  has_audio BOOLEAN DEFAULT false,
  url TEXT NOT NULL,                  -- R2 URL
  thumbnail_url TEXT,
  waveform_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Export jobs
CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',      -- pending | processing | completed | failed | cancelled
  progress INT DEFAULT 0,
  preset TEXT,                        -- tiktok-reels, youtube, etc.
  codec TEXT,
  width INT,
  height INT,
  fps INT,
  bitrate_mode TEXT,
  audio_only BOOLEAN DEFAULT false,
  output_url TEXT,                    -- R2 URL of completed export
  output_size_bytes BIGINT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transcription jobs
CREATE TABLE transcription_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',      -- pending | processing | completed | failed
  progress INT DEFAULT 0,
  language TEXT DEFAULT 'auto',
  scope TEXT,                         -- clip | track | timeline
  scope_id TEXT,                      -- clipId or trackIndex
  result JSONB,                       -- Array of caption entries with word timestamps
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Caption style presets (user-created)
CREATE TABLE caption_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  style JSONB NOT NULL,              -- CaptionStyle object
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Storage Structure (Cloudflare R2)

```
bucket: capcraft-media
├── users/{userId}/
│   ├── media/
│   │   ├── {mediaId}/
│   │   │   ├── original.mp4          ← uploaded source file
│   │   │   ├── thumbnail.webp        ← generated thumbnail
│   │   │   ├── waveform.json         ← waveform envelope data
│   │   │   └── audio.m4a             ← extracted audio (for transcription)
│   ├── projects/
│   │   ├── {projectId}/
│   │   │   ├── state.json            ← project timeline state
│   │   │   └── autosave.json         ← autosave snapshot
│   ├── exports/
│   │   ├── {jobId}/
│   │   │   └── output.mp4            ← rendered export
│   └── avatars/
│       └── {avatarId}.webp
```

## 2.4 Hybrid Processing Architecture

### Client-Side (Browser):
| Task | Technology | When |
|---|---|---|
| Thumbnail generation | FFmpeg WASM in Web Worker | On upload, < 50MB files |
| Waveform extraction | Web Audio API decodeAudioData | On upload, all files |
| Preview playback | Native `<video>` + Canvas2D | Always |
| Audio mixing | Web Audio API (AudioEngine) | During playback |
| Caption rendering | Canvas2D at 30fps | During playback |
| Small exports < 30s | FFmpeg WASM (optional, user opt-in) | For free tier quick exports |

### Server-Side (GPU VPS):
| Task | Technology | Scale |
|---|---|---|
| Full export rendering | FFmpeg (GPU NVENC) | BullMQ queue, auto-scale workers |
| Transcription | faster-whisper on GPU | BullMQ queue, separate worker |
| Large file thumbnail | FFmpeg (CPU is fine) | Quick, no GPU needed |
| Video compositing | FFmpeg filter_complex | For complex multi-track exports |

### CRF Policy Preserved (from FFmpegService.ts line 11-13):
```
Server export uses SAME CRF values:
  H264: fast=20, slow=18
  H265: fast=24, slow=20
  VP9:  fast=33, slow=30
Audio normalization: aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo
```

## 2.5 Frontend Migration Map — File by File

### Stores (copy as-is, swap IPC calls):

| File | Lines | Action |
|---|---|---|
| `useTimeline.ts` | 1513 | Copy as-is. Replace `path` field with `url` on Clip/AudioTrack. Remove IPC autosave calls (replace with REST). |
| `useCaption.ts` | 653 | Copy as-is. Replace `transcribe*()` IPC calls with REST POST. |
| `useExport.ts` | 257 | Copy as-is. Replace `startExport()` IPC with REST POST. Add WebSocket listener for progress. |
| `useProject.ts` | 188 | Copy as-is. Replace save/load IPC with REST. |
| `useMediaLibrary.ts` | 202 | Copy as-is. Replace thumbnail IPC with REST. Change `path` to `url`. |
| `usePreviewView.ts` | ~20 | Copy as-is. No changes. |
| `useToast.ts` | ~30 | Copy as-is. No changes. |
| `useStartup.ts` | ~50 | **DELETE** — no binary validation needed. |
| `usePlayback.ts` | ~30 | Copy as-is. No changes. |
| `useUI.ts` | ~40 | Copy as-is. No changes. |

### Components (copy as-is, adapt source loading):

| File | Lines | Action |
|---|---|---|
| `Preview/index.tsx` | 1701 | **KEY FILE**: Replace `toFileUrl(clip.path)` with `clip.url`. Replace overlay `toFileUrl(clip.path)` with `clip.url`. Everything else stays. |
| `Timeline/index.tsx` | 1107 | Copy as-is. Canvas rendering is browser-native. Drag-and-drop MIME types stay. |
| `Inspector/index.tsx` | 1040 | Copy as-is. All controls are pure React. |
| `page.tsx` | 571 | Remove startup validation banner. Replace IPC listeners with WebSocket. Replace file dialogs with browser equivalents. |
| `LeftRail`, `RightRail` | ~200 each | Copy as-is. |
| `MediaPanel` | ~300 | Replace file dialog with browser file input + drag-and-drop upload. |
| `ExportDialog` | ~400 | Replace IPC export calls with REST. Add WebSocket progress listener. |
| All other components | various | Copy as-is. |

### Services:

| File | Lines | Action |
|---|---|---|
| `AudioEngine.ts` | 465 | Copy as-is. `preloadBuffer()` already handles http:// URLs (line 91-94). |
| `WaveformService.ts` | ~200 | Move to Web Worker. Use fetch() instead of IPC for audio data. |
| `FFmpegService.ts` | 947 | Split: client-side WASM version for thumbnails/previews. Server-side Node.js version for exports. |

### Shared (copy as-is):

| File | Action |
|---|---|
| `effects/EffectRegistry.ts` | Copy as-is |
| `effects/ModifierEngine.ts` | Copy as-is |
| `effects/TransitionRegistry.ts` | Copy as-is |
| `effects/PresetRegistry.ts` | Copy as-is |
| `effects/KeyframeEngine.ts` | Copy as-is |
| `utils/color.ts` | Copy as-is |
| `utils/srt.ts` | Copy as-is |
| `utils/easing.ts` | Copy as-is |
| `utils/caption-layout.ts` | Copy as-is |

---

# PART 3: SCALABILITY PLAN

## 3.1 Infrastructure Tiers

### Tier 1: Launch (0-100 users)
```
VPS: 1x Hetzner CX31 (4 vCPU, 8GB RAM, 80GB SSD) — €7.49/mo
Components:
  - Next.js app (SSR + API routes) — runs on VPS
  - PostgreSQL (Supabase free tier) — 500MB DB, 1GB storage
  - Cloudflare R2 (free tier) — 10GB storage, 10M reads/mo
  - Redis (Upstash free tier) — 10K commands/day
  - 1 BullMQ worker on same VPS for exports + transcription
  
Estimated cost: ~€15/mo
```

### Tier 2: Growth (100-1,000 users)
```
VPS: 1x Hetzner CX51 (8 vCPU, 32GB RAM, 240GB SSD) — €24.49/mo
Components:
  - Next.js app on VPS (or Vercel Pro $20/mo)
  - Supabase Pro ($25/mo) — 8GB DB, 250GB storage, 250K auth users
  - Cloudflare R2 (150GB storage) — ~$2.25/mo
  - Redis (Upstash Pro ~$10/mo)
  - 2 BullMQ workers on separate VPS for exports
  - GPU worker (1x Hetzner GEX44, A100 GPU) — €1.50/hr on-demand for transcription
  
Estimated cost: ~€100-150/mo
```

### Tier 3: Scale (1,000-10,000 users)
```
Components:
  - Next.js on Vercel Enterprise or 2x VPS behind load balancer
  - Supabase Team ($599/mo) or managed PostgreSQL (2x vCPU, 8GB RAM)
  - R2 with custom domain + Cloudflare CDN
  - Redis cluster (3 nodes)
  - 4-8 BullMQ export workers (auto-scale based on queue depth)
  - 2-4 GPU transcription workers
  - Meilisearch for media/project search
  
Estimated cost: ~€800-1,500/mo
```

### Tier 4: Hyper-scale (10,000-50,000 users)
```
Components:
  - Kubernetes cluster (or managed: GKE/EKS)
  - PostgreSQL with read replicas (1 primary + 2 replicas)
  - R2 + Cloudflare CDN + regional caching
  - Redis Sentinel or Redis Cluster
  - 10-20 export workers with GPU (NVENC)
  - 5-10 transcription workers with GPU
  - Horizontal pod autoscaling based on queue depth
  - Multi-region deployment (US, EU, Asia)
  
Estimated cost: ~€5,000-10,000/mo
```

## 3.2 Key Scaling Bottlenecks & Solutions

| Bottleneck | Problem | Solution |
|---|---|---|
| **Export rendering** | CPU/GPU intensive, 1 export = 1-10 min | BullMQ queue + horizontal worker scaling. NVENC GPU encoding 5-10x faster than CPU. |
| **Transcription** | Whisper on CPU = 10x realtime | faster-whisper on GPU = 1-2x realtime. Separate queue. Priority for pro users. |
| **Media storage** | Video files are huge (100MB-10GB each) | R2 with zero egress fees. Presigned URLs for direct upload. Multipart upload for large files. |
| **Media streaming** | Preview needs low-latency video streaming | Cloudflare CDN in front of R2. Adaptive bitrate (HLS) for large files. |
| **Database** | Project state JSON can be 1-50MB | PostgreSQL JSONB handles this. Autosave debounced to 30s. Full save on explicit action only. |
| **WebSocket connections** | Each editor instance needs realtime | Socket.io with Redis adapter for multi-server. Connection limit: ~10K per server. |
| **Thumbnail generation** | Per-upload, CPU intensive | Client-side FFmpeg WASM for small files. Server-side for large files. Cache in R2. |

## 3.3 Security Architecture

| Layer | Implementation |
|---|---|
| **Auth** | Supabase Auth (email + Google + GitHub OAuth). JWT in httpOnly cookie. |
| **API** | JWT validation middleware on every route. User-scoped queries (WHERE user_id = $auth.uid). |
| **Storage** | R2 presigned URLs with 1-hour expiry. Server validates ownership before generating URL. |
| **Upload** | Direct-to-R2 via presigned POST. Server validates file type + size after upload. |
| **Rate limiting** | Hono rate limiter: 100 req/min for API, 10 uploads/min, 3 exports/min (free), 10 exports/min (pro). |
| **Input validation** | Zod schemas on every API endpoint. Max project state size: 50MB. Max upload: 5GB. |
| **CORS** | Strict origin whitelist. Credentials: include. |
| **Encryption** | TLS 1.3 everywhere. R2 server-side encryption (default). DB encryption at rest. |
| **Billing protection** | Stripe webhooks for payment events. Server-side usage tracking. Hard limits enforced. |

---

# PART 4: BUSINESS MODEL & MARKET

## 4.1 Competitor Analysis (Specific to Capcraft's Niche)

| Competitor | Revenue/Valuation | What They Do | Capcraft's Edge |
|---|---|---|---|
| **CapCut** | $815M ARR (2024) | Free desktop/mobile editor with TikTok integration | Capcraft targets creators who OUTGROW CapCut's limitations — more control over captions, transitions, keyframes |
| **Canva Video** | $4B valuation | Template-based video for non-editors | Capcraft is a REAL editor — timeline, multi-track, keyframes, not drag-and-drop templates |
| **VEED.io** | $35-45M ARR | Browser-based auto-caption + simple edit | Capcraft has 4 caption modes (karaoke, word-reveal) vs VEED's basic subtitles. Real timeline vs simplified. |
| **Descript** | $100M ARR | Text-based video editing + podcast | Capcraft focuses on visual editing. Descript is text-first. Different workflows. |
| **Kapwing** | $10M+ ARR | Browser meme/simple video editor | Capcraft is prosumer-grade. Kapwing is casual. |
| **InVideo** | $70M ARR | Template-based video creation | Capcraft is editor-first, not template-first. |
| **HeyGen** | $95-100M ARR | AI avatar video generation | Different product. Capcraft could integrate AI features later. |

### Capcraft's Unique Position:
**The only browser-based editor with CapCut-level features + AI caption workflow + multi-platform export**

Key differentiators:
1. **4 caption modes** (full-phrase, word-reveal, karaoke, single-word) — nobody else offers this in-browser
2. **Real timeline** with multi-track, keyframes, transitions, blend modes — not a simplified web toy
3. **Whisper-powered transcription** with word-level timestamps — not just basic STT
4. **Data-driven effects system** — extensible without code changes
5. **Cross-platform** — web, desktop (Tauri), mobile (Capacitor) from one codebase

## 4.2 Pricing Model

| Plan | Price | Storage | Export | Features |
|---|---|---|---|---|
| **Free** | $0/mo | 1 GB | 30 min/mo, 720p, watermark | Full editor, 2 video tracks, basic captions |
| **Pro** | $12/mo | 50 GB | Unlimited, 4K, no watermark | All caption modes, keyframes, transitions, all effects |
| **Business** | $29/mo | 500 GB | Unlimited, 4K, team sharing | Everything in Pro + shared projects, brand presets, priority rendering |
| **Enterprise** | Custom | Custom | Custom | Self-hosted option, API access, SLA |

## 4.3 Target Market

### Primary: Short-form Content Creators
- **Who**: TikTok, YouTube Shorts, Instagram Reels creators
- **Pain**: CapCut is great but desktop-only, no collaboration, limited caption styles
- **Capcraft solves**: Browser access anywhere, 4 caption modes for engagement, `reformatForShorts()` auto-splits words
- **Size**: 50M+ creators globally (Creator Economy $252B in 2025)

### Secondary: Social Media Managers
- **Who**: Agency teams managing multiple brand accounts
- **Pain**: Need consistent caption styling across videos, collaboration, brand presets
- **Capcraft solves**: Caption presets, team projects, brand kit
- **Size**: 500K+ agencies worldwide

### Tertiary: Podcast/Video Course Creators
- **Who**: Educators, podcasters who repurpose content
- **Pain**: Need accurate captions, silence detection, efficient workflow
- **Capcraft solves**: Whisper transcription, `detectAndStoreSilences()`, auto-caption styling
- **Size**: 5M+ podcasters, growing e-learning market

## 4.4 ROI Projection

### Year 1 (Launch → 1,000 users):
```
Revenue:
  Free users: 800 × $0 = $0
  Pro users: 150 × $12/mo × 12 = $21,600
  Business: 50 × $29/mo × 12 = $17,400
  Total: ~$39,000

Costs:
  Infrastructure: €100/mo × 12 = €1,200 (~$1,300)
  Supabase: $25/mo × 12 = $300
  Domain + misc: $200
  Total: ~$1,800

Net: ~$37,200 (95% margin at this scale)
```

### Year 2 (1,000 → 10,000 users):
```
Revenue:
  Free: 7,000 × $0 = $0
  Pro: 2,500 × $12/mo × 12 = $360,000
  Business: 500 × $29/mo × 12 = $174,000
  Total: ~$534,000

Costs:
  Infrastructure: €1,200/mo × 12 = €14,400 (~$15,600)
  Supabase Team: $599/mo × 12 = $7,188
  GPU workers: ~$500/mo × 12 = $6,000
  Total: ~$28,800

Net: ~$505,200 (94.5% margin)
```

### Year 3 (10,000 → 50,000 users):
```
Revenue:
  Free: 35,000 × $0 = $0
  Pro: 12,000 × $12/mo × 12 = $1,728,000
  Business: 3,000 × $29/mo × 12 = $1,044,000
  Total: ~$2,772,000

Costs:
  Infrastructure: ~$8,000/mo × 12 = $96,000
  Team (3 engineers): ~$300,000
  Total: ~$396,000

Net: ~$2,376,000 (85% margin)
```

---

# PART 5: MIGRATION PHASES

## Phase 1: Foundation (Weeks 1-4)
- Set up Next.js 15 project with App Router
- Copy all shared utilities (effects, easing, caption-layout, color, srt)
- Copy all 10 Zustand stores (remove IPC calls, add REST stubs)
- Copy all 22 components (replace `toFileUrl` with URL passthrough)
- Copy AudioEngine (already http-ready)
- Set up Supabase (auth + database schema)
- Set up R2 bucket + presigned upload flow
- **Result**: Editor works in browser with local file upload → R2 → preview

## Phase 2: Backend Core (Weeks 5-8)
- Build Hono API server with all REST endpoints
- Implement media upload pipeline (presigned URL → R2 → probe → thumbnail → waveform)
- Implement project save/load (JSON state → PostgreSQL)
- Implement autosave (debounced 30s → PostgreSQL)
- Set up BullMQ + Redis for job queue
- Build export worker (FFmpeg server-side, same CRF policy)
- Build transcription worker (faster-whisper on GPU)
- Wire up WebSocket for progress events
- **Result**: Full upload → edit → export pipeline works end-to-end

## Phase 3: Polish & Launch (Weeks 9-12)
- Landing page + pricing page (Next.js SSR)
- Onboarding flow (upload first video → auto-transcribe → style captions → export)
- Billing integration (Stripe)
- Usage tracking + limits enforcement
- Responsive layout for tablet (1024px+)
- PWA manifest + service worker for offline support
- Performance optimization (code splitting, lazy loading, virtual scrolling for media library)
- **Result**: Production-ready SaaS launch

## Phase 4: Desktop & Mobile (Weeks 13-16)
- Tauri 2.0 wrapper (wraps web app, 10x smaller than Electron)
  - Same React codebase, native window
  - Local file system access for offline editing
  - Local FFmpeg for client-side export (optional)
- Capacitor wrapper (wraps web app for iOS/Android)
  - Touch-optimized timeline interactions
  - Camera/microphone access for direct recording
  - Native share sheet for exports
- **Result**: Cross-platform presence (web + desktop + mobile)

## Phase 5: Growth Features (Weeks 17+)
- Real-time collaboration (CRDT-based project state sync)
- Template marketplace (user-created project templates)
- AI features: auto-cut silence, smart zoom, face tracking
- Brand kit (saved caption styles, color palettes, intro/outro templates)
- API for programmatic video generation
- White-label option for agencies

---

# PART 6: RISK ANALYSIS

| Risk | Severity | Mitigation |
|---|---|---|
| **Browser video performance** | High | Use WebCodecs API for decoding (Chrome 94+). FFmpeg WASM for processing. Fallback to server for heavy tasks. |
| **Large file uploads** | Medium | Multipart upload to R2 (5GB max). Progress bar. Resume on failure. |
| **WebSocket reliability** | Medium | Socket.io auto-reconnect. Heartbeat. Fallback to polling. |
| **GPU worker cost** | Medium | On-demand GPU instances (Hetzner GEX44 €1.50/hr). Auto-scale to 0 when queue empty. |
| **CapCut competition** | High | Focus on niche (caption-heavy short-form). CapCut is broad. Capcraft wins on caption quality + browser access. |
| **Browser compatibility** | Low | Canvas2D, Web Audio, WebCodecs all supported in Chrome/Edge/Firefox. Safari WebCodecs needs flag. |
| **Data loss** | High | Autosave every 30s. Full save on export. R2 versioning (30-day). PostgreSQL point-in-time recovery. |

---

# APPENDIX A: Exact Code References

## Functions that need modification:
1. `toFileUrl()` in Preview/index.tsx (line 189-194) → DELETE, use `clip.url` directly
2. `AudioEngine.preloadBuffer()` line 87-90 (IPC file read) → REMOVE, keep only fetch path (line 91-94)
3. `useExport.startExport()` → Replace IPC invoke with `POST /api/export/start`
4. `useCaption._runTranscription()` → Replace IPC invoke with `POST /api/transcribe/start` + WebSocket listener
5. `page.tsx` line 155 (startup:validation listener) → REMOVE entirely
6. `page.tsx` line 165 (export:progress listener) → Replace with WebSocket
7. `useMediaLibrary` thumbnail loading → Replace IPC with R2 thumbnail URL
8. `FFmpegService.getFontsDir()` → REMOVE, fonts via CDN @font-face
9. `FFmpegService.escapeFilterPath()` → Keep on server-side only
10. All `window.electron.ipcRenderer.invoke()` calls → Replace with `fetch()` to Hono API
11. All `window.electron.ipcRenderer.on()` listeners → Replace with Socket.io event handlers

## Files that are 100% reusable (zero changes):
- `src/shared/effects/EffectRegistry.ts`
- `src/shared/effects/ModifierEngine.ts`
- `src/shared/effects/TransitionRegistry.ts`
- `src/shared/effects/PresetRegistry.ts`
- `src/shared/effects/KeyframeEngine.ts`
- `src/shared/utils/easing.ts`
- `src/shared/utils/caption-layout.ts`
- `src/shared/utils/color.ts`
- `src/shared/utils/srt.ts`
- All Tailwind CSS classes and CSS custom properties
- All font files in `assets/fonts/` (serve via CDN)
- All SFX files in `assets/sfx/` (serve via CDN)
