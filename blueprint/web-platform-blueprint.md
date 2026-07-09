# Capcraft Web Platform Blueprint

> Specific architectural blueprint for transforming Capcraft from an Electron desktop app into a cross-platform web-based video editing SaaS. This document references actual Capcraft source files, components, services, and data flows.

---

## 1. Current Capcraft Architecture (What We Have)

### Desktop App Structure (Electron 30 + React 18)

```
┌──────────────────────────────────────────────────────────────┐
│  Renderer Process (React 18 + Zustand + Canvas2D)           │
│  22 components, 10 stores, 4 renderer services, 16 effects  │
└────────────────────────┬─────────────────────────────────────┘
                         │ contextBridge (preload/index.ts)
┌────────────────────────▼─────────────────────────────────────┐
│  Main Process (Node.js via Electron)                         │
│  5 IPC handlers, 4 services (FFmpeg, Whisper, Thumbnail,     │
│  ExportQueue), 1 worker thread (thumbnail)                   │
└────────────────────────┬─────────────────────────────────────┘
                         │ child_process.spawn + filesystem
┌────────────────────────▼─────────────────────────────────────┐
│  External: FFmpeg, ffprobe, whisper-cli.exe, GGML models     │
│  53 bundled SFX, 13 bundled fonts, .ecp project files        │
└──────────────────────────────────────────────────────────────┘
```

### Inventory of What Exists Today

**22 React Components** (`src/renderer/components/`):
| Component | Lines | Purpose | Web Reuse |
|---|---|---|---|
| `Preview/index.tsx` | 1,700 | Canvas2D video playback, caption overlay, transform handles, guide overlays | ~95% reusable — only `video.src` needs URL instead of local path |
| `Timeline/index.tsx` | 1,106 | Canvas-based multi-track timeline, InteractionMachine, waveform display | ~95% reusable — no Electron dependency |
| `MediaPanel/index.tsx` | 829 | Media library, drag-and-drop import, hover preview, multi-select | ~70% reusable — replace `window.electron.ipcRenderer` with API calls |
| `Inspector/index.tsx` | 1,039 | Context-aware property panel (clip, text, audio, caption) | ~95% reusable — pure React |
| `CaptionEditor/index.tsx` | 598 | SRT entry editing, split/merge, timing adjustment | ~90% reusable — transcription trigger changes to API call |
| `ExportDialog/index.tsx` | 450 | Preset picker, codec selection, queue progress | ~60% reusable — export becomes server-side job |
| `AudioPanel/index.tsx` | 319 | SFX browser (53 bundled sounds), drag-to-timeline | ~70% reusable — SFX served from CDN instead of local fs |
| `EffectsPanel/index.tsx` | 194 | Effect browser (blur, glow, camera, color, etc.) | 100% reusable — data-driven, no Electron deps |
| `FiltersPanel/index.tsx` | 154 | CSS filter browser | 100% reusable |
| `KeyframeEditor/index.tsx` | 185 | Keyframe timeline editor | 100% reusable |
| `TransitionPicker/index.tsx` | 112 | Transition selector | 100% reusable |
| `LeftRail/index.tsx` | 80 | 11-tab icon rail (Media, Templates, Elements, Audio, Text, Captions, Transcript, Effects, Transitions, Filters, Plugins) | 100% reusable |
| `RightRail/index.tsx` | 73 | 6-tab icon rail (Basic, Background, Smart Tools, Audio, Animation, Speed) | 100% reusable |
| `TextPanel/index.tsx` | 169 | Text clip creation | ~90% reusable |
| `CaptionPresetPanel/index.tsx` | 116 | Caption style presets | 100% reusable |
| `HotkeyManager.tsx` | - | Global hotkeys (J/K/L, Space, I/O, S, etc.) | ~95% reusable — remove Electron-specific save/export triggers |
| `ContextMenu/index.tsx` | 160 | Right-click menu | 100% reusable |
| `Toast/index.tsx` | 113 | Notification toasts | 100% reusable |
| `ConfirmDialog/index.tsx` | 91 | Confirmation modal | 100% reusable |
| `ShortcutsDialog/index.tsx` | 147 | Keyboard shortcuts reference | 100% reusable |
| `ErrorBoundary/index.tsx` | 63 | React error boundary | 100% reusable |
| `ComingSoonPanel/index.tsx` | 39 | Placeholder for Templates, Elements, Transcript, Transitions, Plugins | 100% reusable |

**10 Zustand Stores** (`src/renderer/store/`):
| Store | Lines | Electron IPC Usage | Web Migration |
|---|---|---|---|
| `useTimeline.ts` | 1,512 | None (pure state) | 100% reusable as-is |
| `useCaption.ts` | 652 | `whisper:transcribe`, `whisper:transcribeFromTimeline`, `whisper:cancel`, `whisper:progress` | Replace IPC with REST API calls + WebSocket progress |
| `useExport.ts` | 256 | `export:start`, `export:cancel`, `export:getJobs`, `export:clearCompleted`, `export:progress` | Replace IPC with REST API calls + WebSocket progress |
| `useProject.ts` | 187 | `project:save`, `project:load`, `project:exportSRT`, `project:createTempSRT` | Replace IPC with REST API calls to Postgres |
| `useMediaLibrary.ts` | 201 | `ffmpeg:getMediaInfo`, `ffmpeg:getThumbnail` (via `getThumbnail()`) | Replace with API calls; thumbnails served from R2/CDN |
| `usePreviewView.ts` | 143 | None | 100% reusable |
| `useSelectedEntity.ts` | 58 | None | 100% reusable |
| `useStartup.ts` | 47 | `startup:validation` event | Remove entirely (no local binary checks needed) |
| `useConfirm.ts` | 36 | None | 100% reusable |
| `useToast.ts` | 58 | None | 100% reusable |

**4 Main Process Services** (to be rewritten as server-side):
| Service | Lines | Current Role | Web Equivalent |
|---|---|---|---|
| `FFmpegService.ts` | 918 | Video probe, thumbnail extraction, audio extraction, export rendering (filter_complex, concat, drawtext, upscale) | Server-side FFmpeg worker + FFmpeg WASM for client-side thumbnails |
| `WhisperService.ts` | 1,644 | Speech-to-text via whisper-cli spawn, streaming pipeline (FFmpeg stdout → whisper stdin), model validation, diagnostics | Server-side Whisper worker (or Deepgram/Replicate API) |
| `ExportQueue.ts` | 293 | Priority queue, 1 concurrent job, progress tracking, cancel support | BullMQ job queue + GPU worker nodes |
| `ThumbnailService.ts` | 112 | SQLite-backed thumbnail cache, FFmpeg frame extraction | R2 storage + CDN; client-side FFmpeg WASM for instant thumbnails |

**4 Renderer Services** (`src/renderer/services/`):
| Service | Lines | Web Reuse |
|---|---|---|
| `AudioEngine.ts` | 465 | 100% reusable — already uses Web Audio API (browser-native) |
| `FilterPipeline.ts` | - | 100% reusable — pure function (Modifier[] → CSS filter string) |
| `KeyframeEvaluator.ts` | - | 100% reusable — pure function (track + time → value) |
| `WaveformService.ts` | - | ~80% reusable — needs to fetch audio from URL instead of local file |

**16 Effects System Files** (`src/renderer/effects/`):
- `core/EffectRegistry.ts` (105 lines) — 100% reusable
- `core/ModifierEngine.ts` (517 lines) — 100% reusable
- `core/PresetRegistry.ts` (421 lines) — 100% reusable
- `core/TransitionRegistry.ts` (103 lines) — 100% reusable
- `definitions/builtinEffects.ts` (110 lines) — 100% reusable
- `definitions/captionPresets.ts` (199 lines) — 100% reusable
- `definitions/transitions.ts` (100 lines) — 100% reusable
- `types/` (6 files) — 100% reusable
- `utils/easing.ts` (84 lines) — 100% reusable
- `errors/EffectErrors.ts` (132 lines) — 100% reusable

**Shared Utilities** (`src/shared/`):
- `types/caption.ts` — CaptionStyle SSOT — 100% reusable
- `utils/srt.ts` — SRT parse/generate — 100% reusable
- `utils/timeline.ts` — timeline timing — 100% reusable
- `utils/color.ts` — hex color conversion — 100% reusable
- `utils/fonts.ts` — AVAILABLE_FONTS array — needs font CDN URLs instead of local paths
- `utils/renderGeometry.ts` — caption layout — 100% reusable

### Exact IPC Channels to Replace (25 channels)

**Invoke channels (Renderer → Main):**
| IPC Channel | Handler | Web Replacement |
|---|---|---|
| `ffmpeg:getMediaInfo` | `ffmpeg.handler.ts` | `POST /api/media/probe` — server probes uploaded file |
| `ffmpeg:extractFrame` | `ffmpeg.handler.ts` | Client-side FFmpeg WASM or `POST /api/media/frame` |
| `ffmpeg:getThumbnail` | `ffmpeg.handler.ts` | Client-side FFmpeg WASM; fallback to server-generated thumbnails in R2 |
| `ffmpeg:getThumbnailStrip` | `ffmpeg.handler.ts` | Client-side FFmpeg WASM batch extraction |
| `ffmpeg:clearThumbnailCache` | `ffmpeg.handler.ts` | Not needed (no local SQLite cache) |
| `ffmpeg:getCacheStats` | `ffmpeg.handler.ts` | Not needed |
| `ffmpeg:openMediaDialog` | `ffmpeg.handler.ts` | Browser `<input type="file">` or drag-and-drop upload |
| `ffmpeg:openSaveDialog` | `ffmpeg.handler.ts` | Browser download API (`<a download>`) |
| `ffmpeg:extractAudioFromClip` | `ffmpeg.handler.ts` | `POST /api/media/extract-audio` — server-side FFmpeg |
| `ffmpeg:mixTimelineAudio` | `ffmpeg.handler.ts` | `POST /api/media/mix-audio` — server-side FFmpeg |
| `file:readBuffer` | `ffmpeg.handler.ts` | `fetch()` from R2 presigned URL |
| `sfx:getLibrary` | `sfx.handler.ts` | `GET /api/sfx` — static JSON served from API or CDN |
| `sfx:openFileLocation` | `sfx.handler.ts` | Not needed (SFX streamed from CDN) |
| `whisper:isModelAvailable` | `whisper.handler.ts` | Not needed (server always has model) |
| `whisper:transcribe` | `whisper.handler.ts` | `POST /api/transcription/start` + WebSocket progress |
| `whisper:transcribeFromTimeline` | `whisper.handler.ts` | `POST /api/transcription/start` (server downloads media from R2) |
| `whisper:cancel` | `whisper.handler.ts` | `POST /api/transcription/cancel/:id` |
| `whisper:getDiagnostics` | `whisper.handler.ts` | Not needed in web (server-side) |
| `whisper:runDiagnosticTests` | `whisper.handler.ts` | Not needed |
| `whisper:validateModel` | `whisper.handler.ts` | Not needed |
| `export:start` | `export.handler.ts` | `POST /api/export/start` + WebSocket progress |
| `export:cancel` | `export.handler.ts` | `POST /api/export/cancel/:id` |
| `export:getJobs` | `export.handler.ts` | `GET /api/export/jobs` |
| `export:clearCompleted` | `export.handler.ts` | `DELETE /api/export/completed` |
| `project:save` | `project.handler.ts` | `PUT /api/projects/:id` (save to Postgres) |
| `project:load` | `project.handler.ts` | `GET /api/projects/:id` (load from Postgres) |
| `project:exportSRT` | `project.handler.ts` | `GET /api/projects/:id/srt` (generate + download) |
| `project:createTempSRT` | `project.handler.ts` | Server-side SRT generation |

**Listen channels (Main → Renderer events):**
| Event | Web Replacement |
|---|---|
| `export:progress` | WebSocket `export:progress` |
| `whisper:progress` | WebSocket `transcription:progress` |
| `startup:validation` | Not needed (no local binaries) |

---

## 2. Capcraft-Specific Market Positioning

### What Makes Capcraft Different from Generic "Online Video Editor"

Capcraft is NOT another Canva/Kapwing clone. Its core identity is:

1. **Caption-first editing** — The entire `useCaption` store (652 lines), `CaptionEditor` (598 lines), `CaptionPresetPanel` (116 lines), and the `CaptionStyle` SSOT type system are built around auto-caption workflows. This is the VEED-killer feature, but with more control.

2. **Prosumer timeline** — The `Timeline` component (1,106 lines) with `InteractionMachine` (hit testing, snap, lane layout, multi-tool), the `useTimeline` store (1,512 lines) with keyframes, modifiers, transitions — this is a real NLE timeline, not a simplified web toy.

3. **Data-driven effects system** — 16 files, `EffectRegistry` + `ModifierEngine` + `TransitionRegistry` + `PresetRegistry` with keyframe animation, 8 easing curves, composable modifier stacks. This is architecturally more sophisticated than any web editor.

4. **Offline transcription** — `WhisperService` (1,644 lines) with streaming pipeline, model fallback chain, word-level timestamps, silence detection. In web version, this becomes a server-side differentiator.

5. **CapCut-style UX paradigm** — LeftRail (11 tabs) + RightRail (6 tabs) + Preview + Inspector + Timeline layout. This is directly modeled on CapCut's interface, which is the most popular video editor globally ($815M ARR).

### Target Users (Specific)
- **TikTok/Reels/Shorts creators** who need auto-captions + quick export (CapCut audience)
- **Podcasters** who need transcript-first editing (Descript audience, but cheaper)
- **Social media agencies** managing multiple client accounts (VEED audience, but more powerful)
- **YouTube creators** who want CapCut features without privacy concerns (CapCut is owned by ByteDance)

### Competitor Gap Analysis (Capcraft-specific)

| Feature | CapCut | VEED | Kapwing | Descript | Capcraft |
|---|---|---|---|---|---|
| Auto-captions (Whisper-grade) | Yes (cloud) | Yes (basic) | Yes (basic) | Yes (transcript-first) | Yes (Whisper, word-level) |
| Caption animation presets | Limited | No | No | No | Yes (pop, fade, slide, karaoke, typewriter) |
| Caption styling control | Basic | Basic | Basic | Basic | Full (font, stroke, bg, position, active state) |
| Multi-track timeline | Yes | No (single track) | Limited | Yes | Yes (with InteractionMachine) |
| Effects/keyframe animation | Yes | No | Limited | No | Yes (data-driven, 8 easings) |
| Transition system | Yes | No | Limited | No | Yes (dissolve, slide, wipe, zoom, blur, light) |
| Export presets (social) | Yes | Yes | Yes | No | Yes (TikTok, YouTube, IG, 4K, ProRes, VP9) |
| Codec control | No | No | No | No | Yes (H.264, H.265, ProRes, VP9, bitrate, hardware accel) |
| SRT sidecar export | No | No | No | Yes | Yes |
| Privacy (no ByteDance) | No (Chinese-owned) | Yes (UK) | Yes (US) | Yes (US) | Yes (self-hosted option) |
| Offline/desktop mode | Yes (app) | No | No | Yes | Yes (Tauri 2.0) |

---

## 3. Tech Stack (Capcraft-Specific)

### Frontend

| Layer | Technology | Why for Capcraft |
|---|---|---|
| **Web Framework** | **Next.js 15 (App Router)** | SSR for landing page SEO, API routes for BFF pattern, existing React components port directly |
| **Editor Core** | **React 18 + TypeScript** | All 22 components, 10 stores, 16 effects files port with minimal changes |
| **Styling** | **Tailwind CSS v4** | Already used throughout Capcraft, dark editor theme preserved |
| **State** | **Zustand + Immer** | Already used (10 stores), undo/redo snapshot system preserved |
| **Browser Video** | **FFmpeg WASM + WebCodecs** | Client-side thumbnail generation (replaces `ThumbnailService`), preview rendering stays HTML5 video + Canvas2D |
| **Canvas** | **Canvas2D** (existing) | `Preview` (1,700 lines) and `Timeline` (1,106 lines) already use Canvas2D — no WebGL migration needed |
| **Desktop** | **Tauri 2.0** | Wraps the web app, 10x smaller than Electron (current 30), adds native file access for local FFmpeg/Whisper |
| **Mobile** | **Capacitor** (Phase 1) | Wraps the web editor directly — fastest path. The responsive layout already uses `window.innerWidth` for panel sizing (see `page.tsx` lines 46-58) |

### Backend

| Layer | Technology | Why for Capcraft |
|---|---|---|
| **API** | **Hono** on Railway | TypeScript E2E, replaces all 25 IPC channels with REST endpoints. Hono is 5x faster than Express, runs on Railway |
| **Realtime** | **Socket.io** | Replaces `export:progress` and `whisper:progress` IPC events. Needed for export progress, transcription progress, and future collaboration |
| **Database** | **PostgreSQL via Supabase** | Replaces `.ecp` local JSON files. Stores projects (same JSON schema), users, media metadata, export jobs, transcription jobs |
| **Queue** | **BullMQ + Redis** | Replaces `ExportQueue.ts` (293 lines). Queues: media-probe, thumbnail-gen, transcription, export-render, cleanup |
| **Storage** | **Cloudflare R2** | Replaces local filesystem. Stores uploaded media, generated thumbnails, rendered exports, transcription output. Zero egress = critical for video |
| **CDN** | **Cloudflare** | Serves thumbnails, SFX (53 files from `assets/sfx/`), fonts (13 files from `assets/fonts/`), exported videos |
| **Transcription** | **Server-side whisper-cli** (initially) | Same `WhisperService` logic (1,644 lines) runs on server. Later: add Deepgram/Replicate as scale option |
| **Video Rendering** | **FFmpeg on GPU worker** | Same `FFmpegService` logic (918 lines) — filter_complex, concat, drawtext, upscale — runs on server |
| **Auth** | **Supabase Auth** | Cheapest at scale ($25/mo at 100K MAU). Social login (Google, GitHub). Row-level security for project isolation |
| **Payments** | **Stripe** | Subscription (Free/Pro/Business) + usage-based (transcription minutes, storage overage) |

---

## 4. Capcraft-Specific Architecture

### Data Flow: How Current Flows Transform

**Flow 1: Media Import**
```
CURRENT (Electron):
  User clicks "Import" → ffmpeg:openMediaDialog → dialog.showOpenDialog()
  → FFmpegService.getMediaInfo(filePath) → ffprobe JSON
  → useTimeline.addClip({ path, durationMs, ... })
  → ThumbnailService.extract(filePath, timestamp) → Base64 thumbnail

WEB:
  User drops file / clicks upload → Browser file picker
  → Client requests presigned URL: POST /api/upload/presigned-url
  → Direct upload to R2 (bypasses API server)
  → R2 completion webhook → POST /api/upload/complete
  → Server queues media-probe job (BullMQ)
  → FFmpeg probe extracts metadata → updates media_files table
  → Server queues thumbnail-gen job → generates thumbnail.webp in R2
  → WebSocket notifies client → client fetches thumbnail from CDN URL
  → useTimeline.addClip({ url: cdnUrl, durationMs, ... })
```

**Flow 2: Transcription**
```
CURRENT (Electron):
  useCaption.transcribeClip(clipId)
  → whisper:transcribeFromTimeline IPC
  → FFmpegService spawns ffmpeg → 16kHz mono WAV to pipe
  → whisper-cli reads from stdin → temp SRT + JSON
  → Progress: win.webContents.send('whisper:progress', percent)
  → parseSRTOutput() → { entries, language, telemetry }

WEB:
  useCaption.transcribeClip(clipId)
  → POST /api/transcription/start { mediaId, language }
  → Server: download media from R2 → temp file
  → Server: spawn FFmpeg (same streaming pipeline as current WhisperService)
  → Server: spawn whisper-cli → SRT + JSON output
  → WebSocket: transcription:progress { percent }
  → useCaption.setProgress(percent) (same store action)
  → Server: parse SRT + JSON → upload result to R2
  → WebSocket: transcription:complete { entries, language }
  → useCaption store: converts entries to TextClips (same logic)
```

**Flow 3: Export**
```
CURRENT (Electron):
  useExport.startExport({ clipPaths, audioTracks, srtPath, ... })
  → export:start IPC → ExportQueueManager.addJob()
  → FFmpegService builds filter_complex (concat + transforms + drawtext)
  → Spawn FFmpeg with -progress pipe
  → Parse progress → export:progress events
  → Output: local MP4 + SRT sidecar

WEB:
  useExport.startExport({ clipUrls, audioTrackUrls, ... })
  → POST /api/export/start { projectId, preset, codec, ... }
  → Server: create export_jobs record (status: pending)
  → BullMQ: add to export-render queue
  → GPU worker picks up job:
    - Download all clip media from R2
    - Build same FFmpeg filter_complex (reuse FFmpegService logic)
    - Run FFmpeg with progress parsing
    - Upload output MP4 to R2
    - Generate SRT sidecar if captions exist
  → WebSocket: export:progress { jobId, percent }
  → WebSocket: export:complete { jobId, downloadUrl }
  → Client: show "Download" button → presigned R2 URL (7-day expiry)
```

**Flow 4: Project Save/Load**
```
CURRENT (Electron):
  Ctrl+S → project:save IPC → JSON.stringify → fs.writeFile(.ecp)
  Ctrl+O → ffmpeg:openSaveDialog → project:load IPC → fs.readFile → JSON.parse

WEB:
  Ctrl+S → PUT /api/projects/:id { name, data: { clips, audioTracks, textClips, captions, ... } }
  → Postgres: UPSERT into projects table (data_json column)
  → Auto-save: debounced PUT every 30 seconds

  Project list → GET /api/projects → shows all user projects
  Click project → GET /api/projects/:id → load into Zustand stores
  (Same data schema as .ecp — clips[], audioTracks[], textClips[], captions{})
```

**Flow 5: SFX Library**
```
CURRENT (Electron):
  AudioPanel mounts → sfx:getLibrary IPC → scan assets/sfx/ directory
  → Returns 53 SFXFile objects with local paths
  → Drag to timeline → AudioEngine preloads from file:// path

WEB:
  SFX files hosted on Cloudflare CDN (53 MP3s from assets/sfx/)
  → GET /api/sfx → returns SFXFile[] with CDN URLs
  → AudioPanel renders same UI with CDN URLs
  → Drag to timeline → AudioEngine.preloadBuffer(cdnUrl)
  → AudioEngine already supports fetch for http:// URLs (line 77)
```

### Component Migration Map (Detailed)

**Zero-change components (copy directly):**
- `LeftRail`, `RightRail` — pure UI, no IPC
- `EffectsPanel`, `FiltersPanel`, `TransitionPicker` — data-driven effects system
- `KeyframeEditor` — pure state manipulation
- `CaptionPresetPanel` — pure style application
- `ContextMenu`, `Toast`, `ConfirmDialog`, `ShortcutsDialog`, `ErrorBoundary`, `ComingSoonPanel`
- All 16 `effects/` files (registries, types, definitions, utils, errors)
- All 5 `shared/` files (types, utils)

**Small-change components (replace IPC with API calls):**
- `MediaPanel` — replace `window.electron.ipcRenderer.invoke('ffmpeg:openMediaDialog')` with file upload, replace `ffmpeg:getThumbnail` with CDN URL
- `AudioPanel` — replace `sfx:getLibrary` IPC with `fetch('/api/sfx')`
- `TextPanel` — minor: remove any file dialog references
- `HotkeyManager` — replace `Ctrl+S` handler (API save instead of IPC), replace `Ctrl+E` handler (same)
- `WaveformService` — replace local file read with `fetch()` from CDN URL

**Medium-change components (significant logic rewrite):**
- `Preview` (1,700 lines) — replace `video.src = clip.path` with `video.src = clip.url` (CDN URL). Replace local thumbnail paths with CDN URLs. AudioEngine `preloadBuffer(path)` → `preloadBuffer(url)`. Everything else stays identical.
- `CaptionEditor` (598 lines) — replace `whisper:transcribe*` IPC calls with `POST /api/transcription/start`. Replace `whisper:progress` IPC listener with WebSocket listener. All editing logic (split, merge, timing, styling) stays identical.
- `ExportDialog` (450 lines) — replace `export:start/cancel/getJobs` IPC with REST API. Replace `export:progress` IPC listener with WebSocket. Preset picker, codec selection, queue UI all stay identical.
- `Timeline` (1,106 lines) — replace thumbnail URL resolution (CDN instead of local). All InteractionMachine logic, hit testing, snap, lane layout, canvas rendering stays identical.
- `Inspector` (1,039 lines) — replace any media path references with URLs. All property editing stays identical.

**Removed entirely:**
- `useStartup` store — no local binary validation needed
- Startup validation banner in `page.tsx` (lines 377-410) — no FFmpeg/Whisper/model checks
- `preload/index.ts` — no Electron context bridge needed
- All `main/ipc/*.handler.ts` files — replaced by API routes
- `main/services/ThumbnailService.ts` — replaced by R2 + CDN + client WASM

---

## 5. Database Schema (Capcraft-Specific)

```sql
-- Users (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'business')),
  storage_used_bytes BIGINT DEFAULT 0,
  transcription_minutes_used INT DEFAULT 0,
  transcription_minutes_limit INT DEFAULT 30, -- free tier
  max_projects INT DEFAULT 5, -- free tier
  max_export_resolution TEXT DEFAULT '720p',
  watermark_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Projects (same schema as current .ecp format)
-- The data_json column stores the exact same structure as the current .ecp file:
-- { version, name, fps, resolution, aspectRatio, clips[], audioTracks[],
--   textClips[], captions: { entries[], style, language }, exportPreset }
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Project',
  data_json JSONB NOT NULL DEFAULT '{}',
  thumbnail_url TEXT,
  duration_ms INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Media files (replaces local file paths in Clip objects)
CREATE TABLE media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  duration_ms INT,
  width INT,
  height INT,
  fps NUMERIC,
  has_video BOOLEAN DEFAULT true,
  has_audio BOOLEAN DEFAULT true,
  video_codec TEXT,
  audio_codec TEXT,
  storage_key TEXT NOT NULL, -- R2 key: users/{userId}/media/{mediaId}/original
  thumbnail_key TEXT,         -- R2 key: users/{userId}/media/{mediaId}/thumbnail.webp
  waveform_key TEXT,          -- R2 key: users/{userId}/media/{mediaId}/waveform.json
  status TEXT DEFAULT 'processing' CHECK (status IN ('uploading', 'processing', 'ready', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Export jobs (replaces ExportQueue in-memory jobs)
CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'cancelled', 'error')),
  progress INT DEFAULT 0,
  preset TEXT, -- 'tiktok-reels', 'youtube', etc. (same PresetKey as useExport)
  codec TEXT, -- 'h264', 'h265', 'prores', 'vp9'
  quality_preset TEXT, -- 'fast', 'slow'
  output_width INT,
  output_height INT,
  fps INT,
  bitrate_kbps INT,
  audio_only BOOLEAN DEFAULT false,
  output_key TEXT, -- R2 key: users/{userId}/exports/{exportId}.mp4
  srt_key TEXT,    -- R2 key: users/{userId}/exports/{exportId}.srt
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Transcription jobs
CREATE TABLE transcription_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  media_id UUID REFERENCES media_files(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'cancelled', 'error')),
  progress INT DEFAULT 0,
  language TEXT DEFAULT 'auto',
  result_key TEXT, -- R2 key: users/{userId}/transcriptions/{transcriptionId}.json
  entry_count INT DEFAULT 0,
  word_count INT DEFAULT 0,
  telemetry JSONB, -- Same TranscriptionTelemetry interface from WhisperService
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Row-Level Security (RLS) — every user only sees their own data
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcription_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users see own projects" ON projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users manage own projects" ON projects FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own media" ON media_files FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users see own exports" ON export_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users see own transcriptions" ON transcription_jobs FOR SELECT USING (auth.uid() = user_id);
```

---

## 6. R2 Storage Structure (Capcraft-Specific)

```
capcraft-media/ (bucket)
├── users/
│   └── {userId}/
│       ├── media/
│       │   └── {mediaId}/
│       │       ├── original.mp4        # Raw uploaded video
│       │       ├── thumbnail.webp      # Generated thumbnail (replaces ThumbnailService)
│       │       └── waveform.json       # Generated waveform data (replaces WaveformService local cache)
│       ├── projects/
│       │   └── {projectId}.json        # Same schema as current .ecp files
│       ├── exports/
│       │   ├── {exportId}.mp4          # Rendered export (auto-delete after 7 days)
│       │   └── {exportId}.srt          # SRT sidecar (same as current project:exportSRT)
│       └── transcriptions/
│           └── {transcriptionId}.json  # Whisper output (same TranscriptionResult interface)
├── sfx/                                 # 53 bundled SFX (from assets/sfx/)
│   ├── cash-register.mp3
│   ├── cheering.mp3
│   └── ... (all 53 files)
├── fonts/                               # 13 bundled fonts (from assets/fonts/)
│   ├── Inter-VariableFont.ttf
│   ├── Poppins-Bold.ttf
│   └── ... (all 13 files)
└── templates/                           # Future: caption presets, effect presets
    └── caption-presets.json             # Same as definitions/captionPresets.ts
```

---

## 7. Scalability (Capcraft-Specific Workload)

### What Makes Capcraft's Workload Unique

Unlike a typical SaaS, Capcraft has **heavy per-user compute**:
- **Transcription**: ~2-4x realtime (1 min audio = 2-4 min CPU). A 10-min video = 20-40 min CPU time
- **Export rendering**: ~1-3x realtime for 1080p, ~5-10x for 4K with upscale. A 5-min video at 1080p = 5-15 min GPU time
- **Storage**: Video files are large. Average user uploads 500MB-2GB of raw media per project
- **Bandwidth**: Serving video for preview + export downloads. A 5-min 1080p export = ~100-300MB

### Phase-by-Phase Infrastructure

**Phase 1: 100 users (Beta launch)**
```
Vercel (Next.js frontend)           $0-20/mo
Railway (API + 1 worker)            $10/mo
Supabase (Postgres + Auth, free)    $0/mo
Cloudflare R2 (~200GB storage)      $3/mo
Hetzner CX22 (FFmpeg + Whisper)     $5/mo
Upstash Redis (free tier)           $0/mo
                                    ─────────
                            Total:  ~$18-38/mo
```
- Single API instance, single worker node
- 1 concurrent export job (same as current ExportQueue MAX_CONCURRENT = 1)
- 1 concurrent transcription job
- All users share one FFmpeg + one whisper-cli process

**Phase 2: 1,000 users**
```
Vercel Pro                          $20/mo
Railway (2 API replicas)            $30/mo
Supabase Pro                        $25/mo
Cloudflare R2 (~5TB)                $75/mo
Hetzner CX32 x2 (CPU workers)       $30/mo
Hetzner GPU (export rendering)      $100-200/mo
Upstash Redis Pro                   $10/mo
                                    ─────────
                            Total:  ~$290-390/mo
```
- 2 API replicas (stateless, behind Railway load balancer)
- BullMQ with 2 concurrent exports, 2 concurrent transcriptions
- GPU worker for FFmpeg export (same filter_complex logic as current FFmpegService)
- CPU workers for Whisper (same streaming pipeline as current WhisperService)

**Phase 3: 10,000 users**
```
Vercel Business                     $130/mo
Railway/K8s (5 API replicas)        $200/mo
Supabase Pro + read replicas        $100/mo
Cloudflare R2 (~50TB)               $750/mo
GPU workers (5-10, auto-scale)      $500-1,500/mo
CPU workers (3-5, auto-scale)       $150-300/mo
Redis cluster                       $100/mo
Cloudflare Business CDN             $20/mo
                                    ─────────
                            Total:  ~$1,950-3,100/mo
```

**Phase 4: 50,000 users**
```
Full Kubernetes infrastructure      $2,000-5,000/mo
Multi-region GPU workers            $3,000-8,000/mo
R2 storage (~500TB)                 $7,500/mo
Redis cluster                       $500/mo
Database (sharded)                  $500-1,000/mo
                                    ─────────
                            Total:  ~$13,500-22,000/mo
```

### Key Scaling Insight for Capcraft

The **GPU export workers** are the cost bottleneck. Current `FFmpegService.buildExportCommand()` generates complex filter_complex strings for concat + transforms + drawtext + upscale. Each export job ties up a GPU for minutes.

**Mitigation strategies:**
1. **Client-side preview rendering** — already how Capcraft works (Canvas2D in Preview). Server only renders final export.
2. **Progressive export** — offer lower-quality instant exports (720p, software encoding) for free tier. Reserve GPU exports for paid tiers.
3. **Queue priority** — Pro/Business users get priority in BullMQ queue (same pattern as current ExportQueue but with priority levels).
4. **Scale-to-zero** — GPU workers spin down when queue is empty. Most users edit during the day, export occasionally.

---

## 8. Security (Capcraft-Specific)

### What Changes from Desktop

**Current (Electron):**
- All data is local — no security concerns for user data
- FFmpeg/Whisper binaries bundled in `resources/bin/` — trusted
- .ecp project files on user's disk — user controls access

**Web (new concerns):**
- User media files stored in cloud (R2) — need encryption + access control
- Project data in Postgres — need RLS (row-level security)
- FFmpeg/Whisper processing user content on server — need isolation
- Export downloads need time-limited signed URLs
- SFX and fonts served from CDN — need to prevent hotlinking

### Capcraft-Specific Security Measures

1. **Media file isolation**: Each user's media stored under `users/{userId}/` in R2. Presigned URLs expire after 1 hour. No public bucket access.

2. **Project data isolation**: Postgres RLS policies ensure users can only SELECT/UPDATE their own projects. The `data_json` column (same structure as current .ecp) is never exposed to other users.

3. **Export job isolation**: Users can only see/cancel their own export jobs. Export output URLs are presigned with 7-day expiry (then auto-deleted from R2).

4. **Worker isolation**: Each FFmpeg/Whisper job runs in an isolated temp directory. Input files downloaded from R2 with presigned URLs, deleted after processing. No cross-user data leakage.

5. **Upload validation**: Server validates MIME type (only video/audio/image), file size (2GB free, 10GB pro), and runs ffprobe to verify the file is a valid media file before accepting.

6. **SFX/font protection**: CDN URLs for bundled assets (53 SFX, 13 fonts) use signed URLs that require authentication. Prevents unauthorized redistribution.

---

## 9. Monetization (Capcraft-Specific)

### Pricing Tiers (based on actual Capcraft features)

| Feature | Free | Pro ($15/mo) | Business ($35/mo) |
|---|---|---|---|
| Projects | 5 | Unlimited | Unlimited |
| Storage | 5 GB | 100 GB | 500 GB |
| Export resolution | 720p | 4K | 4K |
| Watermark | Yes (Capcraft logo) | No | No |
| Export codecs | H.264 only | H.264, H.265, VP9, ProRes | All |
| Transcription | 30 min/month | 10 hours/month | Unlimited |
| Word-level timestamps | Yes | Yes | Yes |
| Caption animation presets | 3 (pop, fade, slide) | All 6 + custom | All + team presets |
| Effects/filters | Basic (5) | All (full registry) | All |
| Transitions | 3 | All (full registry) | All |
| SRT sidecar export | No | Yes | Yes |
| Hardware-accelerated export | No | Yes | Yes |
| Priority rendering | No | Yes (2x priority) | Yes (5x priority) |
| Team collaboration | No | No | Up to 10 seats |
| Custom caption fonts | No | Yes (upload) | Yes (upload) |
| API access | No | No | Yes (future) |

### Revenue Projection (Conservative, Capcraft-specific)

Based on VEED's trajectory ($35-45M ARR) and Kapwing's ($10M+ ARR):

| Month | Total Users | Free | Pro ($15) | Biz ($35) | MRR |
|---|---|---|---|---|---|
| 1-3 | 200 | 185 | 13 | 2 | $265 |
| 4-6 | 1,000 | 880 | 100 | 20 | $2,200 |
| 7-12 | 5,000 | 4,200 | 680 | 120 | $14,400 |
| 13-18 | 15,000 | 12,000 | 2,550 | 450 | $54,000 |
| 19-24 | 50,000 | 38,000 | 10,000 | 2,000 | $220,000 |

### Cost vs Revenue

| Stage | Infra Cost | MRR | Margin |
|---|---|---|---|
| 100 users | $38 | $265 | 86% |
| 1,000 users | $350 | $2,200 | 84% |
| 5,000 users | $800 | $14,400 | 94% |
| 50,000 users | $18,000 | $220,000 | 92% |

---

## 10. Implementation Phases (Capcraft-Specific)

### Phase 1: Web MVP (6-8 weeks)

**Week 1-2: Project Setup + Auth**
- Create monorepo: `apps/web` (Next.js), `apps/api` (Hono), `apps/worker` (BullMQ)
- Copy all 22 React components + 10 stores + 16 effects files + shared utils
- Set up Supabase (auth + Postgres + RLS policies)
- Implement auth flow (sign up, login, OAuth)
- Create database schema (profiles, projects, media_files, export_jobs, transcription_jobs)

**Week 3-4: Core Editor Migration**
- Remove all `window.electron.ipcRenderer` calls from components
- Create API service layer (`src/lib/api.ts`) that replaces IPC with REST calls
- Implement file upload flow (presigned URL → R2 → media-probe job)
- Implement project save/load (replace .ecp with Postgres)
- Make Preview work with CDN URLs instead of local file paths
- Make AudioEngine work with CDN URLs (already supports fetch for http://)
- Serve 53 SFX files from R2/CDN

**Week 5-6: Server-Side Processing**
- Deploy Hono API on Railway
- Set up BullMQ worker with media-probe and thumbnail-gen queues
- Implement server-side FFmpeg (port FFmpegService logic, 918 lines)
- Implement export-render queue (port ExportQueue logic, 293 lines)
- Implement WebSocket for export progress
- Test export flow end-to-end (upload → edit → export → download)

**Week 7-8: Transcription + Polish**
- Implement server-side Whisper (port WhisperService logic, 1,644 lines)
- Implement WebSocket for transcription progress
- Landing page + pricing page (Next.js SSR)
- Deploy to Vercel (frontend) + Railway (API + workers)
- Beta testing with 10-20 users

### Phase 2: Feature Parity + Payments (4-6 weeks)
- Stripe subscription integration (Free/Pro/Business tiers)
- Usage tracking (storage, transcription minutes)
- Project dashboard (list all projects, thumbnails, last edited)
- Mobile-responsive layout (adapt the 4-column layout for tablet/mobile)
- SRT import/export (replace project:exportSRT with API)
- Custom font upload (Pro/Business feature)
- Export history (list all past exports, re-download)

### Phase 3: Desktop + Mobile (4-6 weeks)
- Tauri 2.0 desktop wrapper (wraps the web editor, adds local file access)
- Capacitor mobile app (wraps the web editor, touch-optimized timeline)
- Offline mode: local IndexedDB for project data, sync when online
- Push notifications for export/transcription completion

### Phase 4: Growth Features (ongoing)
- Real-time collaboration (CRDT-based, multiple users editing same project)
- Template marketplace (caption presets, effect presets, project templates)
- AI features: auto-cut silence, scene detection, smart reframing
- API/SDK for third-party integrations (Business tier)
- Multi-region deployment (US, EU, Asia)
- Team workspaces (shared projects, role-based access)

---

## 11. Key Technical Decisions (Capcraft-Specific)

| Decision | Choice | Why for Capcraft |
|---|---|---|
| Web framework | Next.js 15 | SSR for landing page SEO (critical for SaaS acquisition). API routes for BFF pattern. All React components port directly. |
| Backend | Hono | TypeScript E2E. Can port all IPC handler logic (5 files) directly as Hono route handlers. 5x faster than Express for the media-heavy API. |
| Database | PostgreSQL (Supabase) | Project data (`.ecp` JSON) maps perfectly to JSONB column. RLS gives us user isolation for free. Supabase Auth is cheapest at scale. |
| Storage | Cloudflare R2 | Zero egress is non-negotiable for a video platform. Serving video previews + exports from S3 would cost $87/TB in egress alone. R2 = $0. |
| Queue | BullMQ + Redis | Direct replacement for current `ExportQueue.ts` (293 lines). Same priority queue pattern, same cancel support, same progress tracking. |
| Desktop | Tauri 2.0 | Current Electron app is 30. Tauri wraps the web app at 1/10th the size. Adds native file system access for local FFmpeg/Whisper in offline mode. |
| Mobile | Capacitor (first) | Wraps the web editor directly — no rewrite. The responsive layout already adapts via `window.innerWidth` (page.tsx lines 46-58). Later: React Native for native timeline performance. |
| Video processing | Hybrid (WASM + server) | Client-side WASM for thumbnails/preview (replaces ThumbnailService). Server-side FFmpeg for export (same filter_complex logic). Server-side Whisper for transcription (same streaming pipeline). |
| Auth | Supabase Auth | $25/mo at 100K MAU vs. Clerk at $2,000/mo or Auth0 at $2,350/mo. Integrated with Postgres RLS. |
| Payments | Stripe | Only option that supports both subscription (Pro/Business) and usage-based (transcription minutes, storage overage) billing. |

---

*Document Version: 2.0 (Capcraft-Specific)*
*Created: July 9, 2026*
*Status: Research & Planning Phase — No code changes*
*Based on: Full codebase analysis of 22 components, 10 stores, 4 services, 16 effects files, 5 IPC handlers*
