# Capcraft Web Platform — Implementation Reference
## Blueprint v3 Supplement: API Schemas, Store Migration, Project Structure

> **STATUS: PLANNING ONLY — NO CODE CHANGES**
> Exact JSON schemas for every API endpoint. Exact line-by-line changes for every store.
> New project folder structure. Environment config. Testing strategy.

---

# 1. API REQUEST/RESPONSE SCHEMAS

## 1.1 Auth Endpoints

### POST /api/auth/signup
```json
// Request
{ "email": "user@example.com", "password": "...", "name": "John" }

// Response 201
{ "user": { "id": "uuid", "email": "...", "name": "...", "plan": "free" }, "token": "jwt..." }

// Response 409
{ "error": "Email already registered" }
```

### POST /api/auth/login
```json
// Request
{ "email": "user@example.com", "password": "..." }

// Response 200
{ "user": { "id": "uuid", "email": "...", "name": "...", "plan": "pro" }, "token": "jwt..." }

// Response 401
{ "error": "Invalid credentials" }
```

### POST /api/auth/refresh
```json
// Request (httpOnly cookie automatically sent)
// Response 200
{ "token": "new-jwt..." }
```

## 1.2 Project Endpoints

### GET /api/projects
```json
// Response 200
{
  "projects": [
    {
      "id": "uuid",
      "name": "My Video",
      "width": 1920,
      "height": 1080,
      "fps": 30,
      "backgroundColor": "#000000",
      "thumbnailUrl": "https://cdn.capcraft.app/users/uid/projects/pid/thumb.webp",
      "durationMs": 45000,
      "createdAt": "2026-01-15T10:30:00Z",
      "updatedAt": "2026-01-15T14:22:00Z"
    }
  ],
  "total": 12,
  "page": 1,
  "perPage": 20
}
```

### POST /api/projects
```json
// Request
{
  "name": "My Video",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "backgroundColor": "#000000",
  "aspectRatio": "16:9"
}

// Response 201
{ "id": "uuid", "name": "My Video", "createdAt": "..." }
```

### POST /api/projects/:id/save
```json
// Request — Full project state (same shape as current .ecp JSON)
{
  "state": {
    "clips": [
      {
        "id": "clip-1",
        "url": "https://cdn.capcraft.app/users/uid/media/mid/original.mp4",
        "startMs": 0,
        "sourceDurationMs": 15000,
        "durationMs": 15000,
        "trackIndex": 0,
        "trimStart": 0,
        "trimEnd": 0,
        "hasAudio": true,
        "transform": { "x": 0, "y": 0, "scaleX": 100, "scaleY": 100, "rotation": 0, "opacity": 100, "cropTop": 0, "cropBottom": 0, "cropLeft": 0, "cropRight": 0 },
        "speed": 1,
        "volume": 1,
        "muted": false,
        "fadeInMs": 0,
        "fadeOutMs": 0,
        "keyframes": [],
        "modifiers": [],
        "blendMode": "normal"
      }
    ],
    "audioTracks": [
      {
        "id": "at-1",
        "url": "https://cdn.capcraft.app/users/uid/media/mid2/audio.m4a",
        "startMs": 0,
        "sourceDurationMs": 30000,
        "durationMs": 30000,
        "volume": 0.8,
        "muted": false,
        "role": "music",
        "trackIndex": 1,
        "trimStart": 0,
        "trimEnd": 0,
        "fadeInMs": 500,
        "fadeOutMs": 1000,
        "keyframes": []
      }
    ],
    "textClips": [
      {
        "id": "tc-1",
        "startMs": 500,
        "durationMs": 3000,
        "endMs": 3500,
        "trackIndex": 0,
        "text": "Hello world",
        "style": {
          "fontFamily": "Inter",
          "fontSize": 48,
          "fontWeight": 700,
          "textColor": "#FFFFFF",
          "strokeColor": "#000000",
          "strokeWidth": 1,
          "textAlign": "center",
          "bgOpacity": 50,
          "bgColor": "#000000",
          "mode": "karaoke",
          "revealFadeMs": 100,
          "positionX": 50,
          "positionY": 75,
          "activeHighlightColor": "#FFD700",
          "activeTextColor": "#000000",
          "activeScale": 100,
          "animationPreset": "pop"
        },
        "words": [
          { "text": "Hello", "startTime": 0, "endTime": 800 },
          { "text": "world", "startTime": 800, "endTime": 1500 }
        ],
        "wordTimestampsSource": "whisper",
        "fadeInMs": 0,
        "fadeOutMs": 0,
        "keyframes": []
      }
    ],
    "tracks": [
      { "id": "t-0", "index": 0, "name": "Video 1", "kind": "video", "muted": false, "locked": false, "hidden": false, "solo": false },
      { "id": "t-1", "index": 1, "name": "Audio 1", "kind": "audio", "muted": false, "locked": false, "hidden": false, "solo": false },
      { "id": "t-2", "index": 2, "name": "Captions", "kind": "caption", "muted": false, "locked": false, "hidden": false, "solo": false }
    ],
    "playheadMs": 5000,
    "totalDurationMs": 45000,
    "projectWidth": 1920,
    "projectHeight": 1080,
    "fps": 30,
    "backgroundColor": "#000000",
    "aspectRatio": "16:9",
    "activeStyle": { "...CaptionStyle..." : "..." },
    "exportPreset": "youtube",
    "exportCodec": "h264",
    "masterVolume": 1
  }
}

// Response 200
{ "saved": true, "updatedAt": "2026-01-15T14:22:00Z", "sizeBytes": 24500 }
```

### POST /api/projects/:id/load
```json
// Response 200 — Same shape as save request body's "state" field
{
  "project": { "id": "uuid", "name": "My Video", "..." : "..." },
  "state": { "...full timeline state as saved..." }
}

// Response 404
{ "error": "Project not found" }
```

### POST /api/projects/:id/autosave
```json
// Request — Same as /save but lighter validation
{ "state": { "...same shape..." } }

// Response 200
{ "saved": true }
```

### POST /api/projects/:id/duplicate
```json
// Response 201
{ "id": "new-uuid", "name": "My Video (copy)", "createdAt": "..." }
```

## 1.3 Media Endpoints

### POST /api/media/upload/initiate
```json
// Request
{
  "fileName": "my-video.mp4",
  "fileSize": 52428800,
  "mimeType": "video/mp4",
  "projectId": "uuid"
}

// Response 200
{
  "mediaId": "uuid",
  "uploadUrl": "https://capcraft-media.r2.cloudflarestorage.com/",
  "fields": {
    "key": "users/uid/media/mid/original",
    "x-amz-algorithm": "AWS4-HMAC-SHA256",
    "x-amz-credential": "...",
    "policy": "...",
    "x-amz-signature": "..."
  },
  "expiresIn": 3600
}
```

### POST /api/media/upload/complete
```json
// Request
{ "mediaId": "uuid", "originalName": "my-video.mp4" }

// Response 200
{
  "media": {
    "id": "uuid",
    "url": "https://cdn.capcraft.app/users/uid/media/mid/original.mp4",
    "status": "processing"
  }
}
// Server then queues probe job. WebSocket 'media:ready' sent when done.
```

### POST /api/media/probe
```json
// Request
{ "url": "https://cdn.capcraft.app/users/uid/media/mid/original.mp4" }

// Response 200
{
  "durationMs": 15000,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "codec": "h264",
  "hasAudio": true,
  "fileSize": 52428800
}
```

### POST /api/media/waveform
```json
// Request
{ "mediaId": "uuid" }

// Response 200
{
  "waveformUrl": "https://cdn.capcraft.app/users/uid/media/mid/waveform.json",
  "peaks": [0.1, 0.3, 0.8, 0.5, ...],
  "sampleRate": 100
}
```

### GET /api/media/:id
```json
// Response 200
{
  "id": "uuid",
  "originalName": "my-video.mp4",
  "mimeType": "video/mp4",
  "sizeBytes": 52428800,
  "width": 1920,
  "height": 1080,
  "durationMs": 15000,
  "hasAudio": true,
  "url": "https://cdn.capcraft.app/users/uid/media/mid/original.mp4",
  "thumbnailUrl": "https://cdn.capcraft.app/users/uid/media/mid/thumbnail.webp",
  "waveformUrl": "https://cdn.capcraft.app/users/uid/media/mid/waveform.json",
  "createdAt": "2026-01-15T10:30:00Z"
}
```

## 1.4 Export Endpoints

### POST /api/export/start
```json
// Request — mirrors current useExport.startExport() IPC payload
{
  "projectId": "uuid",
  "preset": "youtube",
  "codec": "h264",
  "qualityPreset": "fast",
  "bitrateMode": "auto",
  "bitrateKbps": null,
  "fps": 30,
  "audioOnly": false,
  "exportFrameRange": false,
  "hardwareAccel": true,
  "upscaleEnabled": false,
  "upscaleAlgorithm": "lanczos",
  "customWidth": null,
  "customHeight": null,

  "clipUrls": ["https://cdn.../original.mp4", "https://cdn.../clip2.mp4"],
  "clipTrackIndices": [0, 0],
  "clipHasAudio": [true, true],
  "clipHidden": [false, false],
  "clipVideoMuted": [false, false],
  "clipFadeInMs": [0, 500],
  "clipFadeOutMs": [0, 300],
  "clipTransforms": [
    { "x": 0, "y": 0, "scaleX": 100, "scaleY": 100, "rotation": 0, "opacity": 100, "cropTop": 0, "cropBottom": 0, "cropLeft": 0, "cropRight": 0 }
  ],
  "clipVolumes": [1, 0.8],
  "clipStartMs": [0, 5000],
  "clipDurationMs": [15000, 10000],
  "clipTrimStarts": [0, 2000],
  "clipSpeeds": [1, 1.5],

  "audioTracks": [
    {
      "url": "https://cdn.../audio.m4a",
      "startMs": 0,
      "volume": 0.8,
      "trimStart": 0,
      "durationMs": 30000,
      "fadeInMs": 500,
      "fadeOutMs": 1000
    }
  ],

  "srtContent": "1\n00:00:00,500 --> 00:00:03,500\nHello world\n\n",
  "captionStyle": { "...CaptionStyle object..." },

  "totalDurationMs": 45000,
  "projectWidth": 1920,
  "projectHeight": 1080
}

// Response 201
{
  "jobId": "uuid",
  "status": "queued",
  "estimatedTimeSec": 120
}
```

### POST /api/export/cancel
```json
// Request
{ "jobId": "uuid" }

// Response 200
{ "status": "cancelled" }
```

### GET /api/export/:jobId/status
```json
// Response 200
{
  "jobId": "uuid",
  "status": "processing",
  "progress": 67,
  "startedAt": "2026-01-15T14:00:00Z",
  "estimatedRemainingSec": 40
}
```

### GET /api/export/:jobId/download
```json
// Response 302 Redirect → presigned R2 URL (1-hour expiry)
// Location: https://cdn.capcraft.app/users/uid/exports/jid/output.mp4?signature=...

// Response 200 (if JSON preferred)
{
  "downloadUrl": "https://cdn.capcraft.app/...",
  "expiresIn": 3600,
  "outputSizeBytes": 15728640
}
```

## 1.5 Transcription Endpoints

### POST /api/transcribe/start
```json
// Request
{
  "projectId": "uuid",
  "mediaUrl": "https://cdn.capcraft.app/users/uid/media/mid/original.mp4",
  "language": "auto",
  "scope": "clip",
  "scopeId": "clip-1",
  "clipStartMs": 0,
  "clipEndMs": 15000
}

// Response 201
{ "jobId": "uuid", "status": "queued" }
```

### WebSocket: transcribe:progress
```json
{ "jobId": "uuid", "progress": 45, "status": "processing" }
```

### WebSocket: transcribe:result
```json
{
  "jobId": "uuid",
  "entries": [
    {
      "id": "tc-gen-1",
      "startMs": 500,
      "endMs": 3500,
      "text": "Hello world",
      "words": [
        { "text": "Hello", "startTime": 0, "endTime": 800 },
        { "text": "world", "startTime": 800, "endTime": 1500 }
      ],
      "wordTimestampsSource": "whisper"
    }
  ]
}
```

## 1.6 Billing Endpoints

### GET /api/billing/usage
```json
// Response 200
{
  "plan": "pro",
  "storageUsedBytes": 5368709120,
  "storageLimitBytes": 53687091200,
  "exportMinutesUsed": 45,
  "exportMinutesLimit": -1,
  "mediaCount": 23,
  "projectCount": 5
}
```

---

# 2. WEBSOCKET PROTOCOL

## Connection
```
Client connects: wss://api.capcraft.app/ws?token=jwt...
Server validates JWT, associates socket with userId
Socket joins room: `project:{projectId}` (per active project)
```

## Client → Server Events

### `project:join`
```json
{ "projectId": "uuid" }
// Server joins socket to project room for collab (future)
```

### `project:leave`
```json
{ "projectId": "uuid" }
```

## Server → Client Events

### `export:progress`
```json
{ "jobId": "uuid", "progress": 67, "status": "processing" }
// status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
```

### `transcribe:progress`
```json
{ "jobId": "uuid", "progress": 45, "status": "processing" }
```

### `transcribe:result`
```json
{ "jobId": "uuid", "entries": [ "...TextClip data..." ] }
```

### `media:ready`
```json
{
  "mediaId": "uuid",
  "url": "https://cdn...",
  "thumbnailUrl": "https://cdn...",
  "waveformUrl": "https://cdn...",
  "metadata": {
    "durationMs": 15000,
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "codec": "h264",
    "hasAudio": true,
    "fileSize": 52428800
  }
}
```

### `media:error`
```json
{ "mediaId": "uuid", "error": "Failed to process video: unsupported codec" }
```

### `collab:update` (future)
```json
{ "projectId": "uuid", "userId": "uuid", "patch": { "op": "replace", "path": "/clips/0/transform/x", "value": 100 } }
```

---

# 3. ZUSTAND STORE MIGRATION — LINE BY LINE

## 3.1 useTimeline.ts (1513 lines)

### Changes needed:
```
LINE ~50: Clip interface
  - path: string
  + url: string

LINE ~80: AudioTrack interface
  - path: string
  + url: string

LINE ~200: addMediaBatch() action
  - Takes local file paths
  + Takes { url, metadata } objects from API response

LINE ~350: copySelection() / cutSelection()
  - Clipboard contains path field
  + Clipboard contains url field

LINE ~400: pasteAtPlayhead()
  - Creates clips with path from clipboard
  + Creates clips with url from clipboard

LINE ~1400: Autosave trigger (if present)
  - window.electron.ipcRenderer.invoke('project:autosave', state)
  + fetch('/api/projects/:id/autosave', { body: JSON.stringify({ state }) })

ALL OTHER LINES: No changes. Pure state logic.
```

### Total changes: ~6 locations, all `path` → `url`

## 3.2 useCaption.ts (653 lines)

### Changes needed:
```
LINE ~100: _runTranscription()
  - const audioPath = ... (local file path)
  + const mediaUrl = ... (CDN URL from clip.url)

LINE ~120: IPC invocation
  - window.electron.ipcRenderer.invoke('transcribe:start', { audioPath, ... })
  + const res = await fetch('/api/transcribe/start', {
      method: 'POST',
      body: JSON.stringify({ mediaUrl, language, scope, scopeId, projectId })
    })
  + const { jobId } = await res.json()

LINE ~130: Progress listener
  - const cleanup = window.electron.ipcRenderer.on('transcribe:progress', ...)
  + socket.on('transcribe:progress', ...)

LINE ~140: Result handling
  - const cleanup = window.electron.ipcRenderer.on('transcribe:result', ...)
  + socket.on('transcribe:result', ...)

LINE ~200: transcribeClip(clipId)
  - const clip = clips.find(c => c.id === clipId)
  - audioPath = clip.path
  + audioUrl = clip.url

LINE ~250: transcribeTrack(trackIndex)
  - Collects clip.path for each clip on track
  + Collects clip.url for each clip on track

LINE ~300: transcribeTimeline()
  - Collects clip.path + audioTrack.path
  + Collects clip.url + audioTrack.url

ALL OTHER LINES: No changes. Caption logic (merge, split, reformat, retime) is pure data manipulation.
```

### Total changes: ~7 locations, all IPC → REST + `path` → `url`

## 3.3 useExport.ts (257 lines)

### Changes needed:
```
LINE ~50: Export state
  - No path/url fields on state itself (paths gathered at export time)

LINE ~150: startExport()
  - clipPaths: clips.map(c => c.path)
  + clipUrls: clips.map(c => c.url)

  - audioTracks payload includes path field
  + audioTracks payload includes url field

  - srtPath: string (path to generated SRT file)
  + srtContent: string (SRT content as string, not file path)

  - window.electron.ipcRenderer.invoke('export:start', payload)
  + const res = await fetch('/api/export/start', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  + const { jobId } = await res.json()

LINE ~200: cancelExport()
  - window.electron.ipcRenderer.invoke('export:cancel', jobId)
  + fetch('/api/export/cancel', { method: 'POST', body: JSON.stringify({ jobId }) })

ALL OTHER LINES: No changes. Preset definitions, codec options, quality settings — all identical.
```

### Total changes: ~4 locations

## 3.4 useProject.ts (188 lines)

### Changes needed:
```
LINE ~80: saveProject()
  - window.electron.ipcRenderer.invoke('project:save', { filePath, state })
  + fetch('/api/projects/:id/save', { method: 'POST', body: JSON.stringify({ state }) })

LINE ~100: loadProject()
  - const state = await window.electron.ipcRenderer.invoke('project:load', { filePath })
  + const res = await fetch('/api/projects/:id/load', { method: 'POST' })
  + const { state } = await res.json()

LINE ~120: autosave()
  - window.electron.ipcRenderer.invoke('project:autosave', state)
  + fetch('/api/projects/:id/autosave', { method: 'POST', body: JSON.stringify({ state }) })

ALL OTHER LINES: No changes. Resolution presets, undo/redo, aspect ratio — identical.
```

### Total changes: ~3 locations

## 3.5 useMediaLibrary.ts (202 lines)

### Changes needed:
```
LINE ~50: MediaItem interface
  - path: string
  - thumbnailPath: string
  - waveformPath: string
  + url: string
  + thumbnailUrl: string
  + waveformUrl: string

LINE ~80: importMedia()
  - const result = await window.electron.ipcRenderer.invoke('media:import', filePath)
  + // Step 1: Get presigned upload URL
  + const { uploadUrl, mediaId, fields } = await fetch('/api/media/upload/initiate', {
      method: 'POST', body: JSON.stringify({ fileName, fileSize, mimeType, projectId })
    }).then(r => r.json())
  + // Step 2: Upload directly to R2
  + await uploadToR2(uploadUrl, fields, file)
  + // Step 3: Notify server
  + const { media } = await fetch('/api/media/upload/complete', {
      method: 'POST', body: JSON.stringify({ mediaId, originalName })
    }).then(r => r.json())
  + // Step 4: Wait for WebSocket 'media:ready' event

LINE ~120: loadThumbnail()
  - const url = toFileUrl(media.thumbnailPath)
  + const url = media.thumbnailUrl

LINE ~150: loadWaveform()
  - const data = await fetch(toFileUrl(media.waveformPath)).then(r => r.json())
  + const data = await fetch(media.waveformUrl).then(r => r.json())

ALL OTHER LINES: No changes. LRU cache, multi-select, search, dedup — identical.
```

### Total changes: ~4 locations

## 3.6 useStartup.ts (~50 lines)
```
DELETE ENTIRELY. No binary validation needed in web app.
```

## 3.7 All other stores (usePreviewView, useToast, usePlayback, useUI)
```
ZERO changes. Pure UI state, no I/O.
```

---

# 4. NEW PROJECT STRUCTURE

```
capcraft-web/
├── src/
│   ├── app/                          ← Next.js App Router
│   │   ├── (marketing)/              ← Marketing pages (SSR)
│   │   │   ├── page.tsx              ← Landing page
│   │   │   ├── pricing/page.tsx      ← Pricing page
│   │   │   ├── blog/page.tsx         ← Blog
│   │   │   └── layout.tsx            ← Marketing layout (nav + footer)
│   │   ├── (editor)/                 ← Editor app (CSR)
│   │   │   ├── page.tsx              ← Project list / dashboard
│   │   │   ├── [projectId]/
│   │   │   │   └── page.tsx          ← Editor (migrated from current page.tsx)
│   │   │   └── layout.tsx            ← Editor layout (no nav/footer)
│   │   ├── (auth)/                   ← Auth pages
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── layout.tsx
│   │   ├── api/                      ← Hono API routes (or separate package)
│   │   │   ├── auth/[...path]/route.ts
│   │   │   ├── projects/[...path]/route.ts
│   │   │   ├── media/[...path]/route.ts
│   │   │   ├── export/[...path]/route.ts
│   │   │   ├── transcribe/[...path]/route.ts
│   │   │   ├── billing/[...path]/route.ts
│   │   │   └── ws/route.ts           ← WebSocket upgrade handler
│   │   └── layout.tsx                ← Root layout (providers, fonts)
│   │
│   ├── components/                   ← ALL migrated from current codebase
│   │   ├── editor/
│   │   │   ├── Preview/
│   │   │   │   ├── index.tsx         ← Migrated (toFileUrl removed)
│   │   │   │   ├── CaptionStrip.tsx  ← As-is
│   │   │   │   └── PlaybackControls.tsx ← As-is
│   │   │   ├── Timeline/
│   │   │   │   ├── index.tsx         ← As-is (Canvas2D)
│   │   │   │   └── useTimelineInteraction.ts ← As-is
│   │   │   ├── Inspector/
│   │   │   │   └── index.tsx         ← As-is
│   │   │   ├── MediaPanel/
│   │   │   │   └── index.tsx         ← Modified (upload via presigned URL)
│   │   │   ├── LeftRail/
│   │   │   │   └── index.tsx         ← As-is
│   │   │   ├── RightRail/
│   │   │   │   └── index.tsx         ← As-is
│   │   │   ├── ExportDialog/
│   │   │   │   └── index.tsx         ← Modified (REST + WebSocket)
│   │   │   ├── TextPanel/
│   │   │   ├── AudioPanel/
│   │   │   ├── EffectsPanel/
│   │   │   ├── FiltersPanel/
│   │   │   ├── CaptionEditor/
│   │   │   ├── CaptionPresetPanel/
│   │   │   ├── ConfirmDialog/
│   │   │   ├── ShortcutsDialog/
│   │   │   ├── Toast/
│   │   │   ├── HotkeyManager/
│   │   │   ├── ComingSoonPanel/
│   │   │   └── ErrorBoundary/
│   │   └── marketing/                ← New marketing components
│   │       ├── Hero.tsx
│   │       ├── Features.tsx
│   │       ├── PricingTable.tsx
│   │       └── Footer.tsx
│   │
│   ├── store/                        ← ALL migrated Zustand stores
│   │   ├── useTimeline.ts            ← path → url (6 changes)
│   │   ├── useCaption.ts             ← IPC → REST (7 changes)
│   │   ├── useExport.ts              ← IPC → REST (4 changes)
│   │   ├── useProject.ts             ← IPC → REST (3 changes)
│   │   ├── useMediaLibrary.ts        ← path → url, upload flow (4 changes)
│   │   ├── usePreviewView.ts         ← As-is
│   │   ├── useToast.ts               ← As-is
│   │   ├── usePlayback.ts            ← As-is
│   │   └── useUI.ts                  ← As-is
│   │   (useStartup.ts DELETED)
│   │
│   ├── services/                     ← Migrated services
│   │   ├── AudioEngine.ts            ← Remove IPC file read (keep http fetch)
│   │   ├── WaveformService.ts        ← Move to Web Worker, fetch instead of IPC
│   │   ├── FFmpegService.client.ts   ← FFmpeg WASM for client-side thumbnails
│   │   ├── NotificationSound.ts      ← CDN URLs instead of file://
│   │   ├── api.ts                    ← NEW: fetch wrapper with JWT auth
│   │   ├── socket.ts                 ← NEW: Socket.io client singleton
│   │   └── upload.ts                 ← NEW: R2 presigned upload helper
│   │
│   ├── shared/                       ← ALL copied as-is
│   │   ├── effects/
│   │   │   ├── EffectRegistry.ts
│   │   │   ├── ModifierEngine.ts
│   │   │   ├── TransitionRegistry.ts
│   │   │   ├── PresetRegistry.ts
│   │   │   └── KeyframeEngine.ts
│   │   └── utils/
│   │       ├── color.ts
│   │       ├── srt.ts
│   │       ├── easing.ts
│   │       └── caption-layout.ts
│   │
│   ├── workers/                      ← NEW: Web Workers
│   │   ├── ffmpeg.worker.ts          ← FFmpeg WASM for thumbnails
│   │   ├── waveform.worker.ts        ← Waveform extraction via Web Audio
│   │   └── export.worker.ts          ← Optional: client-side small exports
│   │
│   └── lib/                          ← NEW: Shared utilities
│       ├── supabase.ts               ← Supabase client
│       ├── stripe.ts                 ← Stripe client
│       ├── r2.ts                     ← R2 presigned URL generation
│       ├── redis.ts                  ← Redis/BullMQ connection
│       ├── auth.ts                   ← JWT validation middleware
│       └── zod-schemas.ts            ← Input validation schemas
│
├── server/                           ← Backend (separate package or monorepo)
│   ├── workers/
│   │   ├── export.worker.ts          ← BullMQ export job processor
│   │   ├── transcribe.worker.ts      ← BullMQ transcription processor
│   │   └── media.worker.ts           ← BullMQ media processing (probe/thumb/wave)
│   ├── services/
│   │   ├── FFmpegService.ts          ← Server-side FFmpeg (ported from Electron)
│   │   ├── WhisperService.ts         ← Server-side Whisper (faster-whisper GPU)
│   │   ├── ExportQueue.ts            ← BullMQ queue management
│   │   └── StorageService.ts         ← R2 operations
│   └── routes/
│       ├── auth.ts
│       ├── projects.ts
│       ├── media.ts
│       ├── export.ts
│       ├── transcribe.ts
│       └── billing.ts
│
├── public/
│   ├── fonts/                        ← From assets/fonts/ (served via CDN)
│   └── sfx/                          ← From assets/sfx/ (served via CDN)
│
├── assets/                           ← Source assets (not served directly)
│   ├── fonts/
│   └── sfx/
│
├── package.json
├── next.config.ts
├── tailwind.config.ts                ← Migrated from current
├── tsconfig.json
├── electron.vite.config.ts           ← DELETE (no longer Electron)
└── .env.local                        ← Environment variables
```

---

# 5. ENVIRONMENT VARIABLES

```env
# .env.local

# Supabase (Auth + Database)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Cloudflare R2 (Storage)
R2_ACCOUNT_ID=xxxxx
R2_ACCESS_KEY_ID=xxxxx
R2_SECRET_ACCESS_KEY=xxxxx
R2_BUCKET_NAME=capcraft-media
R2_PUBLIC_URL=https://cdn.capcraft.app

# Redis (BullMQ Queue)
REDIS_URL=redis://xxxxx.upstash.io:6379

# Socket.io
SOCKET_IO_URL=wss://api.capcraft.app

# Stripe (Billing)
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_BUSINESS=price_xxx

# FFmpeg (server-side, for export worker)
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe

# Whisper (server-side, for transcription worker)
WHISPER_MODEL_PATH=/models/ggml-small-q8_0.bin
WHISPER_GPU=true

# App
NEXT_PUBLIC_APP_URL=https://capcraft.app
JWT_SECRET=xxxxx
MAX_UPLOAD_SIZE=5368709120
MAX_PROJECT_STATE_SIZE=52428800
```

---

# 6. TESTING STRATEGY

## 6.1 Unit Tests (Vitest)
```
Priority: HIGH — Tests pure logic, no browser needed

Files to test:
  - shared/effects/KeyframeEngine.test.ts    ← 8 easing functions, interpolation
  - shared/effects/ModifierEngine.test.ts    ← CSS filter generation
  - shared/utils/easing.test.ts              ← All 8 easing curves
  - shared/utils/srt.test.ts                 ← SRT parse/generate roundtrip
  - shared/utils/caption-layout.test.ts      ← Word wrapping, bounds
  - shared/utils/color.test.ts               ← Hex to ASS conversion
  - store/useTimeline.test.ts                ← All 50+ actions
  - store/useCaption.test.ts                 ← Merge, split, retime, reformat
  - store/useExport.test.ts                  ← Preset resolution, payload assembly
```

## 6.2 Component Tests (Vitest + React Testing Library)
```
Priority: MEDIUM — Tests UI rendering

Files to test:
  - components/Inspector/Inspector.test.tsx   ← Panel routing, slider values
  - components/ExportDialog/ExportDialog.test.tsx ← Preset selection, form validation
  - components/MediaPanel/MediaPanel.test.tsx ← Upload flow, thumbnail display
```

## 6.3 Integration Tests (Playwright)
```
Priority: HIGH — Tests full user flows

Flows to test:
  1. Upload video → see thumbnail → drag to timeline → preview plays
  2. Transcribe clip → captions appear → edit caption text → style changes
  3. Add clip → adjust transform → add keyframe → preview shows animation
  4. Configure export → start export → progress updates → download completes
  5. Save project → reload page → project restored
  6. Signup → create project → upgrade to Pro → verify limits increased
```

## 6.4 Performance Tests
```
Priority: MEDIUM — Tests browser performance

Metrics to measure:
  - Timeline canvas render time (target: < 16ms per frame)
  - Caption canvas render time (target: < 33ms per frame at 30fps)
  - Audio scrub latency (target: < 100ms)
  - Large project load time (100 clips, 50 audio tracks, 200 captions)
  - Memory usage over 30-minute editing session
  - R2 upload speed for 1GB file
```

---

# 7. CRITICAL MIGRATION CHECKLIST

## Must-do before any code is written:
- [ ] Decide: monorepo (Turborepo) or separate repos (frontend/backend)?
- [ ] Set up Supabase project + database schema
- [ ] Set up Cloudflare R2 bucket + CDN custom domain
- [ ] Set up Redis (Upstash) for BullMQ
- [ ] Set up Stripe account + product/pricing config
- [ ] Choose deployment target: Vercel + Railway? Or self-hosted VPS?
- [ ] Set up CI/CD pipeline (GitHub Actions)
- [ ] Set up error monitoring (Sentry)
- [ ] Set up analytics (Plausible or PostHog)

## Must-do during Phase 1:
- [ ] Copy all shared/ utilities (zero changes needed)
- [ ] Copy all stores (apply path→url + IPC→REST changes)
- [ ] Copy all components (apply toFileUrl removal)
- [ ] Copy AudioEngine (remove IPC branch)
- [ ] Set up api.ts fetch wrapper with JWT
- [ ] Set up socket.ts Socket.io client
- [ ] Set up upload.ts R2 presigned upload helper
- [ ] Test: upload → timeline → preview → captions → export (end-to-end)
