# Capcraft Web Platform — Migration Checklist
## Blueprint v3 Supplement: Step-by-Step Implementation Checklist

> **STATUS: PLANNING ONLY — NO CODE CHANGES**
> Every step needed to migrate Capcraft from Electron to web platform.
> Check off items as they are completed.

---

# PHASE 0: PRE-MIGRATION SETUP (Week 1)

## Infrastructure Accounts
- [ ] Create Supabase project (note URL + anon key + service role key)
- [ ] Create Cloudflare account + R2 bucket named `capcraft-media`
- [ ] Set up custom domain `cdn.capcraft.app` pointing to R2
- [ ] Create Upstash Redis instance (note connection URL)
- [ ] Create Stripe account + configure products (Free/Pro/Business)
- [ ] Create Sentry account for error monitoring
- [ ] Create Plausible/PostHog account for analytics
- [ ] Register domain `capcraft.app` (if not already owned)

## Development Environment
- [ ] Initialize Next.js 15 project: `npx create-next-app@latest capcraft-web --typescript --tailwind --app`
- [ ] Initialize monorepo (Turborepo or npm workspaces) if using separate backend
- [ ] Set up ESLint + Prettier (copy config from current project where possible)
- [ ] Set up Vitest for unit testing
- [ ] Set up Playwright for integration testing
- [ ] Set up GitHub repository with CI/CD (GitHub Actions)
- [ ] Set up Vercel project (or alternative deployment target)
- [ ] Configure environment variables (.env.local) with all keys from implementation reference

## Database Setup
- [ ] Run PostgreSQL schema from blueprint v3 (users, projects, media, export_jobs, transcription_jobs, caption_presets)
- [ ] Create Supabase Auth configuration (email + Google + GitHub providers)
- [ ] Configure Supabase storage policies (if using Supabase storage as backup)
- [ ] Set up Redis connection for BullMQ
- [ ] Test database connection from local dev environment

---

# PHASE 1: COPY & ADAPT CORE (Weeks 1-2)

## Step 1: Copy Shared Utilities (ZERO changes)
- [ ] Copy `src/shared/utils/easing.ts` → `src/shared/utils/easing.ts`
- [ ] Copy `src/shared/utils/color.ts` → `src/shared/utils/color.ts`
- [ ] Copy `src/shared/utils/srt.ts` → `src/shared/utils/srt.ts`
- [ ] Copy `src/shared/utils/caption-layout.ts` → `src/shared/utils/caption-layout.ts`
- [ ] Copy `src/shared/effects/EffectRegistry.ts` → `src/shared/effects/EffectRegistry.ts`
- [ ] Copy `src/shared/effects/ModifierEngine.ts` → `src/shared/effects/ModifierEngine.ts`
- [ ] Copy `src/shared/effects/TransitionRegistry.ts` → `src/shared/effects/TransitionRegistry.ts`
- [ ] Copy `src/shared/effects/PresetRegistry.ts` → `src/shared/effects/PresetRegistry.ts`
- [ ] Copy `src/shared/effects/KeyframeEngine.ts` → `src/shared/effects/KeyframeEngine.ts`
- [ ] Run unit tests on all shared utilities to verify they work in Next.js environment
- [ ] **Verification**: All imports resolve, no Electron-specific dependencies

## Step 2: Copy & Adapt Zustand Stores
### useTimeline.ts (6 changes: path → url)
- [ ] Copy `src/renderer/store/useTimeline.ts` → `src/store/useTimeline.ts`
- [ ] Change `Clip.path: string` → `Clip.url: string` (line ~50)
- [ ] Change `AudioTrack.path: string` → `AudioTrack.url: string` (line ~80)
- [ ] Update `addMediaBatch()` to accept `{ url, metadata }` instead of local paths (line ~200)
- [ ] Update `copySelection()` / `cutSelection()` clipboard to use `url` field (line ~350)
- [ ] Update `pasteAtPlayhead()` to create clips with `url` from clipboard (line ~400)
- [ ] Remove any IPC autosave calls, replace with REST stub (or comment out for now)
- [ ] **Verification**: Store initializes, all 50+ actions work, undo/redo works

### useCaption.ts (7 changes: IPC → REST)
- [ ] Copy `src/renderer/store/useCaption.ts` → `src/store/useCaption.ts`
- [ ] In `_runTranscription()`: replace `audioPath` with `mediaUrl` (CDN URL) (line ~100)
- [ ] Replace IPC `transcribe:start` with `POST /api/transcribe/start` (line ~120)
- [ ] Replace IPC `transcribe:progress` listener with Socket.io (line ~130)
- [ ] Replace IPC `transcribe:result` listener with Socket.io (line ~140)
- [ ] In `transcribeClip()`: use `clip.url` instead of `clip.path` (line ~200)
- [ ] In `transcribeTrack()`: collect `clip.url` instead of `clip.path` (line ~250)
- [ ] In `transcribeTimeline()`: collect `clip.url` + `audioTrack.url` (line ~300)
- [ ] **Verification**: Store initializes, style operations work (transcription needs API)

### useExport.ts (4 changes: IPC → REST)
- [ ] Copy `src/renderer/store/useExport.ts` → `src/store/useExport.ts`
- [ ] In `startExport()`: change `clipPaths` to `clipUrls` using `clip.url` (line ~150)
- [ ] In `startExport()`: change audio track `path` to `url` (line ~160)
- [ ] In `startExport()`: change `srtPath` to `srtContent` (string, not file path)
- [ ] Replace IPC `export:start` with `POST /api/export/start`
- [ ] Replace IPC `export:cancel` with `POST /api/export/cancel`
- [ ] **Verification**: Store initializes, preset selection works (export needs API)

### useProject.ts (3 changes: IPC → REST)
- [ ] Copy `src/renderer/store/useProject.ts` → `src/store/useProject.ts`
- [ ] Replace `project:save` IPC with `POST /api/projects/:id/save`
- [ ] Replace `project:load` IPC with `POST /api/projects/:id/load`
- [ ] Replace `project:autosave` IPC with `POST /api/projects/:id/autosave`
- [ ] **Verification**: Store initializes, resolution presets work, undo/redo works

### useMediaLibrary.ts (4 changes: IPC → REST, path → url)
- [ ] Copy `src/renderer/store/useMediaLibrary.ts` → `src/store/useMediaLibrary.ts`
- [ ] Change `MediaItem.path` → `MediaItem.url` (line ~50)
- [ ] Change `MediaItem.thumbnailPath` → `MediaItem.thumbnailUrl`
- [ ] Change `MediaItem.waveformPath` → `MediaItem.waveformUrl`
- [ ] Replace `media:import` IPC with presigned upload flow (line ~80)
- [ ] Replace thumbnail loading: use `thumbnailUrl` directly (line ~120)
- [ ] Replace waveform loading: fetch from `waveformUrl` (line ~150)
- [ ] **Verification**: Store initializes, LRU cache works, search works

### Other Stores (ZERO changes)
- [ ] Copy `usePreviewView.ts` → `src/store/usePreviewView.ts`
- [ ] Copy `useToast.ts` → `src/store/useToast.ts`
- [ ] Copy `usePlayback.ts` → `src/store/usePlayback.ts` (if exists as separate file)
- [ ] Copy `useUI.ts` → `src/store/useUI.ts` (if exists as separate file)
- [ ] **DELETE** `useStartup.ts` — not needed for web

## Step 3: Create API Client & Socket Client
- [ ] Create `src/services/api.ts` — fetch wrapper with JWT auth header
  - [ ] `api.get(path)` — GET with auth
  - [ ] `api.post(path, body)` — POST with auth + JSON body
  - [ ] `api.put(path, body)` — PUT with auth
  - [ ] `api.delete(path)` — DELETE with auth
  - [ ] Auto-attach JWT from cookie/storage
  - [ ] Handle 401 → redirect to login
- [ ] Create `src/services/socket.ts` — Socket.io client singleton
  - [ ] Connect to `wss://api.capcraft.app/ws?token=jwt`
  - [ ] Auto-reconnect with exponential backoff
  - [ ] Export `socket` instance for store listeners
- [ ] Create `src/services/upload.ts` — R2 presigned upload helper
  - [ ] `initiateUpload(fileName, fileSize, mimeType, projectId)` → presigned URL
  - [ ] `uploadToR2(uploadUrl, fields, file, onProgress)` → multipart upload
  - [ ] `completeUpload(mediaId, originalName)` → trigger processing

## Step 4: Copy & Adapt Services
### AudioEngine.ts (1 change: remove IPC branch)
- [ ] Copy `src/renderer/services/AudioEngine.ts` → `src/services/AudioEngine.ts`
- [ ] In `preloadBuffer()`: REMOVE the IPC file read branch (line 87-90)
- [ ] KEEP the `fetch` branch for http/https URLs (line 91-94) — works for CDN
- [ ] **Verification**: AudioEngine loads audio from CDN URLs, playback works

### WaveformService (adapt to Web Worker)
- [ ] Copy `src/renderer/services/WaveformService.ts` → `src/workers/waveform.worker.ts`
- [ ] Replace IPC audio file read with `fetch(url)` → `arrayBuffer`
- [ ] Use `decodeAudioData` in Web Worker context
- [ ] **Verification**: Waveform extraction works from CDN URLs

### NotificationSound (adapt to CDN)
- [ ] Copy `src/renderer/services/NotificationSound.ts` → `src/services/NotificationSound.ts`
- [ ] Replace `toFileUrl()` paths with CDN URLs for SFX files
- [ ] Upload `assets/sfx/*.mp3` to R2 or serve from `/public/sfx/`
- [ ] **Verification**: Notification sounds play on events

## Step 5: Copy & Adapt Components
### Preview/index.tsx (2 critical changes)
- [ ] Copy `src/renderer/components/Preview/index.tsx` → `src/components/editor/Preview/index.tsx`
- [ ] **CRITICAL**: Remove `toFileUrl()` function (line 189-194)
- [ ] **CRITICAL**: Replace `video.src = toFileUrl(clip.path)` → `video.src = clip.url` (line 285)
- [ ] **CRITICAL**: Replace overlay `toFileUrl(clip.path)` → `clip.url` (line 501)
- [ ] Replace `toFileUrl` in audio preload: `AudioEngine.preloadBuffer(clip.url)`
- [ ] All other code stays identical (Canvas2D captions, transform gizmo, transitions)
- [ ] **Verification**: Video loads from CDN URL, captions render, transitions work

### Timeline/index.tsx (ZERO changes)
- [ ] Copy `src/renderer/components/Timeline/index.tsx` → `src/components/editor/Timeline/index.tsx`
- [ ] Copy `useTimelineInteraction` hook
- [ ] **Verification**: Canvas renders, clips display, interactions work

### Inspector/index.tsx (ZERO changes)
- [ ] Copy `src/renderer/components/Inspector/index.tsx` → `src/components/editor/Inspector/index.tsx`
- [ ] **Verification**: All 6 sub-panels render, sliders work, color pickers work

### page.tsx (3 changes)
- [ ] Copy `src/renderer/app/page.tsx` → `src/app/(editor)/[projectId]/page.tsx`
- [ ] REMOVE startup validation banner (line 377-410) — no binary checks
- [ ] REPLACE `export:progress` IPC listener (line 165) with Socket.io listener
- [ ] REPLACE file dialog calls with browser `<input type="file">` or drag-and-drop
- [ ] Keep all layout logic (4-column, resize handles, toolbar, tools)
- [ ] **Verification**: Layout renders, tools switch, undo/redo works

### All Other Components (ZERO or minimal changes)
- [ ] Copy LeftRail, RightRail → `src/components/editor/`
- [ ] Copy MediaPanel → adapt file upload to use presigned URL flow
- [ ] Copy ExportDialog → adapt IPC calls to REST + WebSocket
- [ ] Copy TextPanel, AudioPanel, EffectsPanel, FiltersPanel → as-is
- [ ] Copy CaptionEditor, CaptionPresetPanel, CaptionStrip → as-is
- [ ] Copy PlaybackControls → as-is
- [ ] Copy ConfirmDialog, ShortcutsDialog, Toast, HotkeyManager → as-is
- [ ] Copy ErrorBoundary → as-is
- [ ] Copy ComingSoonPanel → as-is

## Step 6: Copy Assets
- [ ] Upload `assets/fonts/*.ttf` to R2 or place in `public/fonts/`
- [ ] Set up `@font-face` CSS rules pointing to CDN URLs
- [ ] Upload `assets/sfx/*.mp3` to R2 or place in `public/sfx/`
- [ ] Copy Tailwind CSS config → `tailwind.config.ts`
- [ ] Copy CSS custom properties (--bg0, --bg1, --text1, --accent, etc.)

---

# PHASE 2: BUILD API SERVER (Weeks 3-5)

## Step 7: API Server Setup
- [ ] Initialize Hono project (or use Next.js API routes)
- [ ] Set up JWT authentication middleware
- [ ] Set up Zod schemas for input validation (all endpoints)
- [ ] Set up CORS configuration
- [ ] Set up rate limiting (100 req/min API, 10 uploads/min, 3 exports/min)
- [ ] Set up error handling middleware
- [ ] Set up request logging middleware

## Step 8: Auth Endpoints
- [ ] `POST /api/auth/signup` — create user via Supabase Auth
- [ ] `POST /api/auth/login` — authenticate via Supabase Auth
- [ ] `POST /api/auth/refresh` — refresh JWT
- [ ] `POST /api/auth/logout` — invalidate session
- [ ] OAuth setup (Google, GitHub)
- [ ] **Verification**: Signup → login → get JWT → access protected route

## Step 9: Project Endpoints
- [ ] `GET /api/projects` — list user's projects (paginated)
- [ ] `POST /api/projects` — create new project
- [ ] `GET /api/projects/:id` — get project metadata
- [ ] `PUT /api/projects/:id` — update project metadata
- [ ] `DELETE /api/projects/:id` — delete project (+ cascade media?)
- [ ] `POST /api/projects/:id/save` — save full state to PostgreSQL JSONB
- [ ] `POST /api/projects/:id/load` — load full state
- [ ] `POST /api/projects/:id/autosave` — save to R2 backup
- [ ] `POST /api/projects/:id/duplicate` — clone project
- [ ] **Verification**: Create → save → reload → state matches exactly

## Step 10: Media Endpoints
- [ ] `POST /api/media/upload/initiate` — generate R2 presigned POST URL
- [ ] `POST /api/media/upload/complete` — trigger media processing
- [ ] `POST /api/media/probe` — ffprobe on R2 object
- [ ] `POST /api/media/waveform` — extract waveform data
- [ ] `POST /api/media/extract-audio` — extract audio track
- [ ] `GET /api/media/:id` — get media metadata
- [ ] `DELETE /api/media/:id` — delete media from R2 + DB
- [ ] **Verification**: Upload → probe → thumbnail → waveform → display in UI

## Step 11: Export Endpoints
- [ ] `POST /api/export/start` — create export job, queue in BullMQ
- [ ] `POST /api/export/cancel` — cancel running job
- [ ] `GET /api/export/:jobId/status` — get job status + progress
- [ ] `GET /api/export/:jobId/download` — presigned download URL
- [ ] **Verification**: Start export → progress updates → download output

## Step 12: Transcription Endpoints
- [ ] `POST /api/transcribe/start` — create transcription job, queue in BullMQ
- [ ] `POST /api/transcribe/cancel` — cancel transcription
- [ ] `GET /api/transcribe/:jobId` — get transcription result
- [ ] **Verification**: Start transcription → progress → result with word timestamps

## Step 13: WebSocket Handler
- [ ] Set up Socket.io server with JWT authentication
- [ ] Implement `export:progress` event emission from export worker
- [ ] Implement `transcribe:progress` event emission from transcription worker
- [ ] Implement `transcribe:result` event emission
- [ ] Implement `media:ready` event emission from media worker
- [ ] Implement `media:error` event emission
- [ ] Set up Redis adapter for multi-server WebSocket (future scaling)
- [ ] **Verification**: Client receives all events in real-time

## Step 14: BullMQ Workers
### Export Worker
- [ ] Port FFmpegService filter graph logic from TypeScript to Node.js server
- [ ] Implement same CRF policy: H264 (fast:20/slow:18), H265 (fast:24/slow:20), VP9 (fast:33/slow:30)
- [ ] Implement same audio normalization: `aresample=48000,aformat=...`
- [ ] Download source media from R2 before processing
- [ ] Upload output to R2 after processing
- [ ] Emit progress via WebSocket
- [ ] Implement NVENC GPU encoding (with CPU fallback)
- [ ] **Verification**: Export produces same quality as Electron FFmpegService

### Transcription Worker
- [ ] Set up faster-whisper on GPU (or whisper.cpp)
- [ ] Download audio from R2 before processing
- [ ] Parse word-level SRT output into TextClip entries
- [ ] Store result in PostgreSQL
- [ ] Emit progress + result via WebSocket
- [ ] **Verification**: Transcription produces word-level timestamps

### Media Worker
- [ ] Run ffprobe on uploaded media (stream from R2)
- [ ] Generate thumbnail (FFmpeg single frame extract)
- [ ] Extract waveform data (FFmpeg + peak envelope)
- [ ] Upload thumbnail + waveform to R2
- [ ] Update media row in PostgreSQL with metadata
- [ ] Emit `media:ready` via WebSocket
- [ ] **Verification**: Thumbnail + waveform display correctly in UI

## Step 15: Billing Endpoints
- [ ] `GET /api/billing/usage` — current usage stats
- [ ] `POST /api/billing/subscribe` — create Stripe subscription
- [ ] `POST /api/billing/portal` — Stripe customer portal redirect
- [ ] Stripe webhook handler (payment success, failure, cancellation)
- [ ] Usage limit enforcement (storage, export minutes)
- [ ] **Verification**: Free → Pro upgrade works, limits enforced

---

# PHASE 3: INTEGRATION & TESTING (Weeks 5-6)

## Step 16: End-to-End Integration
- [ ] Connect frontend to backend (same dev environment or proxy)
- [ ] Test: Signup → Login → Dashboard
- [ ] Test: Create project → Save → Reload
- [ ] Test: Upload video → See thumbnail → Drag to timeline → Preview plays
- [ ] Test: Add audio track → Preview audio plays
- [ ] Test: Transcribe clip → Captions appear → Edit caption text
- [ ] Test: Change caption style → Preview updates (all 4 modes)
- [ ] Test: Add transform (scale/rotate) → Preview shows transform
- [ ] Test: Add keyframe → Preview shows animation during playback
- [ ] Test: Configure export → Start export → Progress → Download
- [ ] Test: Autosave works (wait 30s, reload, state restored)
- [ ] Test: Fullscreen preview works
- [ ] Test: All hotkeys work (V/B/H/Z, Space, Ctrl+Z, etc.)

## Step 17: Unit Tests
- [ ] Write tests for all shared utilities (easing, color, srt, caption-layout)
- [ ] Write tests for KeyframeEngine (all 8 easing curves)
- [ ] Write tests for ModifierEngine (CSS filter generation)
- [ ] Write tests for useTimeline (all 50+ actions)
- [ ] Write tests for useCaption (merge, split, retime, reformat)
- [ ] Write tests for useExport (preset resolution, payload assembly)
- [ ] **Target**: 80%+ coverage on shared/ and store/

## Step 18: Integration Tests (Playwright)
- [ ] Test: Full upload → edit → export flow
- [ ] Test: Transcription flow (upload → transcribe → captions)
- [ ] Test: Project save/load cycle
- [ ] Test: Billing flow (signup → upgrade → usage limits)
- [ ] Test: Responsive layout (desktop, tablet widths)

## Step 19: Performance Testing
- [ ] Measure: Timeline canvas render time (target: < 16ms/frame)
- [ ] Measure: Caption canvas render time (target: < 33ms/frame)
- [ ] Measure: Audio scrub latency (target: < 100ms)
- [ ] Measure: Large project load (100 clips, 50 audio, 200 captions)
- [ ] Measure: Memory usage over 30-min session (target: < 500MB)
- [ ] Measure: R2 upload speed for 1GB file
- [ ] Optimize: Code splitting (lazy load panels, export dialog)
- [ ] Optimize: Virtual scrolling for media library
- [ ] Optimize: Debounce autosave (30s minimum interval)

---

# PHASE 4: POLISH & LAUNCH (Weeks 7-8)

## Step 20: Landing Page & Marketing
- [ ] Design + build landing page (Next.js SSR)
- [ ] Design + build pricing page
- [ ] Write copy (features, benefits, comparison vs CapCut)
- [ ] Add demo video / GIF of editor in action
- [ ] SEO optimization (meta tags, sitemap, robots.txt)
- [ ] Set up analytics (Plausible or PostHog)

## Step 21: Onboarding Flow
- [ ] First-time user experience:
  - [ ] Signup → Create first project
  - [ ] Upload first video
  - [ ] Auto-transcribe
  - [ ] Apply caption style
  - [ ] Export
- [ ] Tooltips for key features
- [ ] Keyboard shortcut guide (existing ShortcutsDialog)

## Step 22: Security Hardening
- [ ] Audit: All API routes validate user ownership
- [ ] Audit: JWT in httpOnly cookie (not localStorage)
- [ ] Audit: CORS strict origin whitelist
- [ ] Audit: Rate limiting on all endpoints
- [ ] Audit: Input validation (Zod) on all endpoints
- [ ] Audit: File type + size validation on upload
- [ ] Audit: SQL injection prevention (parameterized queries)
- [ ] Audit: XSS prevention (React default + CSP headers)
- [ ] Set up HTTPS-only cookies
- [ ] Set up Content Security Policy headers

## Step 23: Monitoring & Observability
- [ ] Set up Sentry for error tracking (frontend + backend)
- [ ] Set up uptime monitoring (Pingdom or UptimeRobot)
- [ ] Set up log aggregation (Axiom or Datadog)
- [ ] Set up alerting (export failures, high error rate, slow queries)
- [ ] Set up database monitoring (slow queries, connection count)
- [ ] Set up R2 storage monitoring (usage growth)

## Step 24: Launch
- [ ] Final QA pass on all features
- [ ] Load test API (k6 or Artillery)
- [ ] Load test WebSocket (concurrent connections)
- [ ] Backup strategy verified (R2 versioning, PostgreSQL PITR)
- [ ] Rollback plan documented
- [ ] Launch on Product Hunt
- [ ] Announce on Twitter/X, Reddit, Discord
- [ ] Set up feedback collection (Intercom, Crisp, or Discord)

---

# PHASE 5: DESKTOP & MOBILE (Weeks 9-12)

## Step 25: Tauri Desktop
- [ ] Initialize Tauri 2.0 project
- [ ] Configure to load Next.js build output
- [ ] Implement Rust commands:
  - [ ] `read_local_file` — local file system access
  - [ ] `write_local_file` — local file save
  - [ ] `export_local` — local FFmpeg export (offline mode)
  - [ ] `transcribe_local` — local Whisper (offline mode)
  - [ ] `open_file_dialog` — native file picker
  - [ ] `save_file_dialog` — native save dialog
- [ ] Add `window.__TAURI__` detection in web app
- [ ] Implement hybrid mode (online/offline detection)
- [ ] Configure auto-update (Tauri updater)
- [ ] Set up code signing (macOS + Windows)
- [ ] Build for Windows (.msi), macOS (.dmg), Linux (.AppImage)
- [ ] Test on all three platforms

## Step 26: Capacitor Mobile
- [ ] Initialize Capacitor project
- [ ] Configure to load Next.js build output
- [ ] Install native plugins (filesystem, camera, share, status-bar, keyboard)
- [ ] Adapt UI for mobile (bottom sheets, touch gestures, compact toolbar)
- [ ] Implement mobile timeline interactions (pinch zoom, swipe pan)
- [ ] Implement camera recording
- [ ] Implement microphone recording
- [ ] Implement native share for exports
- [ ] Test on iOS (iPhone 12+, iPad)
- [ ] Test on Android (Pixel, Samsung)
- [ ] Submit to App Store + Google Play

---

# COMPLETION CRITERIA

The migration is complete when:
- [ ] All 16 features from data-flow-migration.md work in browser
- [ ] All unit tests pass (80%+ coverage)
- [ ] All integration tests pass
- [ ] Performance targets met (16ms timeline, 33ms captions)
- [ ] Security audit passed
- [ ] Landing page live
- [ ] Billing working (signup → pay → use)
- [ ] Desktop app builds for Windows/Mac/Linux
- [ ] Mobile app submitted to stores
- [ ] Monitoring + alerting active
- [ ] Documentation for users (help center or FAQ)
