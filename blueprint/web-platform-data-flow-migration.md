# Capcraft Web Platform — Data Flow & Feature Migration Reference
## Blueprint v3 Supplement: Feature-by-Feature Code Path Analysis

> **STATUS: PLANNING ONLY — NO CODE CHANGES**
> Every feature traced from UI action → store → service → output.
> Current (Electron) path vs Web path. References actual function names and line numbers.

---

# 1. MEDIA IMPORT FLOW

## Current (Electron):
```
User drags file onto MediaPanel
  → HTML5 drag-and-drop fires drop event
  → MediaPanel calls window.electron.ipcRenderer.invoke('media:import', filePath)
  → Main process MediaService copies file to project directory
  → MediaService calls FFmpegService.getMediaInfo(filePath)
    → spawn ffprobe with '-print_format json -show_format -show_streams'
    → Parses: durationMs, width, height, fps, codec, hasAudio, fileSize
  → MediaService generates thumbnail via FFmpegService
    → spawn ffmpeg with '-ss {time} -i {path} -vframes 1 -s 160x90 {thumbPath}'
  → MediaService extracts waveform via FFmpegService
    → spawn ffmpeg with '-i {path} -af "showwavespeak=..." -f rawdata ...'
  → Returns { id, path, thumbnailPath, waveformPath, metadata } to renderer
  → useMediaLibrary.addMedia() adds to store
  → Thumbnail loaded via toFileUrl(thumbnailPath) in MediaPanel
```

## Web:
```
User drags file onto MediaPanel
  → HTML5 drag-and-drop fires drop event
  → MediaPanel calls POST /api/media/upload/initiate
    → Server generates R2 presigned POST URL (1-hour expiry)
    → Returns { uploadUrl, mediaId, fields }
  → Browser uploads file directly to R2 via presigned POST (multipart for >100MB)
  → Upload complete → POST /api/media/upload/complete { mediaId, originalName }
    → Server queues probe job in BullMQ
    → Worker runs ffprobe on R2 object (stream from R2, no local download needed)
    → Worker generates thumbnail (FFmpeg) → uploads to R2 users/{uid}/media/{mid}/thumbnail.webp
    → Worker extracts waveform → uploads to R2 users/{uid}/media/{mid}/waveform.json
    → Worker updates media row in PostgreSQL with metadata
  → WebSocket event 'media:ready' → { mediaId, url, thumbnailUrl, waveformUrl, metadata }
  → useMediaLibrary.addMedia() adds to store (url instead of path)
  → Thumbnail loaded via thumbnailUrl (Cloudflare CDN URL) in MediaPanel
```

### Key differences:
- No local file copy — file goes directly to R2
- No `toFileUrl()` — all URLs are Cloudflare CDN URLs
- Probe/thumbnail/waveform happen server-side in BullMQ worker
- Progress updates via WebSocket instead of IPC events

---

# 2. TIMELINE CLIP ADDITION

## Current (Electron):
```
User drags media from MediaPanel onto Timeline
  → Timeline's onDrop handler fires
  → Reads custom MIME type 'application/capcraft-media' from DataTransfer
  → Parses { path, durationMs, hasAudio, width, height }
  → useTimeline.addClip({
      path: mediaPath,
      startMs: dropPositionMs,     ← calculated from drop X coordinate
      sourceDurationMs: media.durationMs,
      durationMs: media.durationMs,
      trackIndex: dropTrackIndex,  ← calculated from drop Y coordinate
      hasAudio: media.hasAudio,
      transform: { x:0, y:0, scaleX:100, scaleY:100, rotation:0, opacity:100, crop...:0 },
      speed: 1, volume: 1, muted: false,
      fadeInMs: 0, fadeOutMs: 0,
      keyframes: [], modifiers: [], blendMode: 'normal'
    })
  → addClip pushes undo snapshot (deep clone of clips array)
  → Timeline re-renders canvas with new clip
  → Preview detects clip at playhead, loads video via toFileUrl(clip.path)
```

## Web:
```
User drags media from MediaPanel onto Timeline
  → IDENTICAL flow — Timeline uses same HTML5 drag-and-drop
  → Same custom MIME type 'application/capcraft-media'
  → useTimeline.addClip() called with same parameters
  → ONLY CHANGE: path field becomes url field (CDN URL from R2)
  → addClip pushes undo snapshot — IDENTICAL (pure Zustand/Immer)
  → Timeline re-renders canvas — IDENTICAL (Canvas2D)
  → Preview detects clip at playhead, loads video via clip.url (CDN URL)
```

### Key insight:
The timeline clip addition is 95% identical. The ONLY change is `path` → `url` on the Clip interface. This ripples through:
- `useTimeline.addClip()` parameter type
- `Preview/index.tsx` effect 1 (line 285): `toFileUrl(clip.path)` → `clip.url`
- `Preview/index.tsx` effect 4b (line 501): overlay `toFileUrl(clip.path)` → `clip.url`
- `AudioEngine.preloadBuffer(clip.path)` → `AudioEngine.preloadBuffer(clip.url)` (already works for http)

---

# 3. VIDEO PLAYBACK

## Current (Electron):
```
User presses Space → HotkeyManager toggles isPlaying
  → Preview effect 3 fires (line 327):
    → findClipAt(playheadMs) finds current clip
    → Auto-snaps playhead to clip.startMs if before it (BUG-01 fix)
    → video.currentTime = clipTimeSec(clip, headMs)
      → clipTimeSec = ((playheadMs - clip.startMs) * clip.speed + clip.trimStart) / 1000
    → video.play()
  → Preview effect 4 fires (line 366):
    → video 'timeupdate' listener, throttled to 32ms (~30fps)
    → Reverse-maps: timelineMs = clip.startMs - clip.trimStart + (video.currentTime * 1000) / speed
    → setPlayhead(timelineMs) — updates useTimeline store
    → At end of clip: finds next clip or stops (with loop/in-out point support)
  → Preview effect 1 fires when playhead crosses clip boundary:
    → Loads new video source via toFileUrl(clip.path)
    → onLoaded: sets currentTime, auto-plays if isPlaying
  → AudioEngine.playTracks() called with all audio tracks
    → Per track: preloadBuffer(path), createBufferSource, connect GainNode
    → Fade-in via AudioParam.linearRampToValueAtTime
    → Fade-out scheduled with speed scaling
  → Caption canvas loop (effect 5, line 583) runs at 30fps:
    → For each frame, finds active TextClips at playheadMs
    → Uses activationCacheMapRef to avoid O(log n) binary search
    → Dispatches to draw function based on style.mode:
      - 'full-phrase' → drawFullPhraseCaption (line 1307)
      - 'word-reveal' → drawWordRevealCaption (line 1356)
      - 'karaoke' → drawKaraokeCaption (line 1524)
      - 'single-word' → drawSingleWordCaption (line 1594)
```

## Web:
```
IDENTICAL flow. Every component is browser-native:
  → HotkeyManager: pure React, no changes
  → Preview effect 3: pure React + <video> API, no changes
  → Preview effect 4: pure React + video.timeupdate, no changes
  → Preview effect 1: ONLY CHANGE is toFileUrl(clip.path) → clip.url
  → AudioEngine: ALREADY supports http:// URLs (line 91-94)
  → Caption canvas loop: pure Canvas2D, no changes
  → All 4 draw functions: pure Canvas2D, no changes
  → activationCacheMapRef: pure JS Map, no changes
```

### Key insight:
Playback is 99% identical. The browser's `<video>` element handles CDN URLs natively. Web Audio API handles CDN audio URLs natively. Canvas2D is identical. The ONLY change is removing `toFileUrl()`.

---

# 4. MULTI-LAYER COMPOSITING (Overlay)

## Current (Electron):
```
Preview effect 4b (line 448):
  → findAllClipsAt(playheadMs) returns all overlapping clips
  → baseClip = activeClips[0] (lowest track index)
  → overlayClips = activeClips.slice(1, 1 + MAX_OVERLAYS)  ← MAX 4 overlays
  → For each overlay clip:
    → Creates <video> element dynamically (pooled via overlayAssignedRef Map)
    → Sets vid.src = toFileUrl(clip.path)
    → Routes audio through AudioEngine.connectOverlayAudio(clipId, vid, vol)
      → createMediaElementSource (once per element) → GainNode → master
    → Applies clip.blendMode via vid.style.mixBlendMode
    → Applies clip.modifiers via buildCssFilter(clip.modifiers) → vid.style.filter
    → Applies keyframe opacity via evaluateKeyframes(clip.keyframes, localTimeMs)
```

## Web:
```
IDENTICAL flow. ONLY CHANGE:
  → vid.src = clip.url (CDN URL instead of toFileUrl(clip.path))
  → Everything else is browser-native DOM manipulation
  → CSS mixBlendMode: identical in browser
  → CSS filter: identical in browser
  → evaluateKeyframes: pure math, identical
```

---

# 5. CAPTION TRANSCRIPTION

## Current (Electron):
```
User clicks "CC ✦" button in toolbar
  → page.tsx handleToolbarTranscribe() (line 188):
    → Gets focused clip or first clip from useTimeline
    → Calls useCaption.transcribeClip(clipId)
  → useCaption.transcribeClip(clipId):
    → Finds clip in useTimeline.getState().clips
    → Gets clip.path (local file path)
    → Calls _runTranscription({
        mode: 'clip',
        audioPath: clip.path,
        scopeId: clipId
      })
  → _runTranscription():
    → Sets status: 'transcribing', progress: 0
    → Calls window.electron.ipcRenderer.invoke('transcribe:start', {
        audioPath, language, jobId
      })
    → Listens to IPC 'transcribe:progress' events
    → Main process WhisperService:
      → Spawns whisper-cli process with audioPath
      → Parses SRT output into WordTimestamp[]
      → Reports progress via IPC
    → On completion:
      → Maps SRT entries to TextClip[] with:
        - id: randomUUID()
        - startMs/endMs from SRT timestamps
        - text from SRT content
        - words: WordTimestamp[] from whisper word-level timing
        - wordTimestampsSource: 'whisper'
        - style: { ...activeStyle } (current CaptionStyle)
      → Calls useTimeline.addTextClip() for each entry
      → Sets status: 'done'
```

## Web:
```
User clicks "CC ✦" button in toolbar
  → page.tsx handleToolbarTranscribe() — IDENTICAL
  → useCaption.transcribeClip(clipId) — IDENTICAL setup
  → _runTranscription():
    → Sets status: 'transcribing', progress: 0
    → Calls POST /api/transcribe/start {
        mediaUrl: clip.url,    ← CDN URL instead of local path
        language,
        scope: 'clip',
        scopeId: clipId,
        projectId
      }
    → Server validates user ownership of project
    → Server creates transcription_jobs row
    → Server queues BullMQ job:
      → GPU worker picks up job
      → Downloads audio from R2 (clip.url)
      → Runs faster-whisper on GPU (1-2x realtime vs 10x on CPU)
      → Parses word-level SRT output
      → Updates job row with result JSON
      → Emits WebSocket 'transcribe:progress' events during processing
    → Client listens via Socket.io:
      → 'transcribe:progress' → updates progress state
      → 'transcribe:result' → receives { entries: TextClip[] }
    → On completion:
      → Maps result entries to TextClip[] — IDENTICAL mapping logic
      → Calls useTimeline.addTextClip() — IDENTICAL
      → Sets status: 'done'
```

### Key differences:
- Local file path → R2 CDN URL
- whisper-cli (CPU, main process) → faster-whisper (GPU, BullMQ worker)
- IPC events → WebSocket events
- All 4 transcription scopes (transcribe, transcribeClip, transcribeTrack, transcribeTimeline) follow same pattern

---

# 6. CAPTION RENDERING (4 MODES)

## Current (Electron) — All 4 modes:
```
Preview effect 5 (line 583) — Canvas2D loop at 30fps:
  FRAME_INTERVAL = 33ms
  
  Each frame:
    → Find active TextClips at playheadMs (binary search, cached in activationCacheMapRef)
    → For each active TextClip:
      → Switch on clip.style.mode:

      CASE 'full-phrase' → drawFullPhraseCaption(ctx, clip, playheadMs, projectWidth, projectHeight):
        → computeCaptionLayout() — SSOT function from caption-layout.ts
        → Word wrapping based on canvas measureText
        → Draws background box (bgColor, bgOpacity)
        → Draws text with stroke (strokeColor, strokeWidth)
        → Draws fill (textColor, fontSize, fontWeight, fontFamily)
        → Position: (positionX%, positionY%) of canvas

      CASE 'word-reveal' → drawWordRevealCaption(ctx, clip, playheadMs, ...):
        → Words become visible after their word.startTime
        → smoothstep easing for fade-in of each word
        → revealFadeMs controls transition smoothness
        → Uses drawWordRevealSmooth() (line 1403) for per-word opacity + wrapping

      CASE 'karaoke' → drawKaraokeCaption(ctx, clip, playheadMs, ...):
        → Full phrase visible at all times
        → Active word (current word based on playheadMs vs word timestamps):
          - highlightColor (default #FFD700) applied to active word
          - textColor (default #000000) applied to active word fill
          - activeScale (default 100%, range 50-200%) scales active word
        → Inactive words: normal textColor + stroke

      CASE 'single-word' → drawSingleWordCaption(ctx, clip, playheadMs, ...):
        → Only displays the active word (centered)
        → activeScale applies
        → Smooth transition between words
```

## Web:
```
100% IDENTICAL. All 4 modes are pure Canvas2D rendering.
  → computeCaptionLayout() — pure function, no changes
  → Canvas measureText — browser API, identical
  → Canvas fillText, strokeText, fillRect — browser API, identical
  → activationCacheMapRef — pure JS Map, no changes
  → Word timestamp comparison — pure math, no changes
  → smoothstep easing — pure math, no changes
  → Font loading: @font-face with CDN-hosted font files (same TTF files from assets/fonts/)
```

---

# 7. EXPORT / RENDER

## Current (Electron):
```
User clicks Export → ExportDialog opens
  → useExport state drives UI:
    → Preset selector (9 presets: tiktok-reels, youtube, instagram-post, etc.)
    → Codec selector (h264, h265, prores, vp9)
    → Quality (fast/slow) → determines CRF (H264: 20/18, H265: 24/20, VP9: 33/30)
    → Bitrate mode (auto/cbr/vbr)
    → FPS (24/30/60)
    → Frame range toggle
    → Audio-only toggle
    → Hardware accel toggle

User clicks "Start Export":
  → useExport.startExport() gathers massive payload:
    → clipPaths[], clipTrackIndices[], clipHasAudio[], clipHidden[], clipVideoMuted[]
    → clipFadeInMs[], clipFadeOutMs[]
    → clipTransforms[] (x, y, scaleX, scaleY, rotation, opacity, crop*)
    → clipVolumes[], clipStartMs[], clipDurationMs[], clipTrimStarts[], clipSpeeds[]
    → audioTracks[] (path, startMs, volume, trimStart, durationMs, fadeInMs, fadeOutMs)
    → srtPath (generated from TextClips via srt.ts)
    → captionStyle (CaptionStyle object)
    → outputPath, totalDurationMs, projectWidth, projectHeight, fps
  → IPC invoke('export:start', payload)
  → Main process ExportQueue:
    → 1 concurrent job, priority-based
    → Spawns FFmpegService with complex filter graph:
      → Video inputs with trim, scale, transform, fade, overlay, caption burn-in
      → Audio inputs with volume, fade, mix
      → Audio normalization: aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo
      → Font path resolution via getFontsDir() for subtitle filter
    → Progress parsed from stderr: time=HH:MM:SS.CC → percent
    → IPC emit('export:progress', { jobId, progress, status })
  → page.tsx listens (line 165) → updates useExport state → toast on complete
```

## Web:
```
User clicks Export → ExportDialog opens — IDENTICAL UI
  → useExport state — IDENTICAL (all 9 presets, codecs, options)
  → ONLY CHANGE: audioTracks[].path → audioTracks[].url (CDN URLs)

User clicks "Start Export":
  → useExport.startExport() gathers payload — IDENTICAL
    → srtPath becomes srtContent (string, not file path) — send SRT content directly
    → outputPath → server generates R2 URL for output
  → POST /api/export/start { payload }
  → Server validates user ownership, checks usage limits
  → Creates export_jobs row, queues BullMQ job
  → GPU worker picks up job:
    → Downloads source media from R2 (all clip URLs)
    → Runs FFmpeg with SAME filter graph logic (ported to Node.js)
    → SAME CRF policy: H264 fast:20/slow:18, H265 fast:24/slow:20, VP9 fast:33/slow:30
    → SAME audio normalization: aresample=48000,aformat=...
    → SAME font handling: @font-face fonts downloaded to temp dir for FFmpeg subtitle filter
    → NVENC GPU encoding (5-10x faster than CPU)
    → Progress parsed from stderr — IDENTICAL logic
    → Uploads output to R2: users/{uid}/exports/{jobId}/output.mp4
    → Updates export_jobs row with output_url, output_size_bytes
    → WebSocket emit 'export:progress' — same event shape as IPC
  → Client Socket.io listener — IDENTICAL to current IPC listener
    → Updates useExport state → toast on complete
    → Download button links to R2 URL (Cloudflare CDN, zero egress cost)
```

### Key differences:
- Local file paths → R2 CDN URLs for all inputs
- SRT file path → SRT string content in API body
- Output to local disk → Output to R2
- 1 concurrent export (ExportQueue) → N concurrent exports (BullMQ auto-scale)
- CPU encoding → GPU NVENC encoding
- getFontsDir() → download fonts from CDN to worker temp dir
- All FFmpeg filter graph logic ported from TypeScript class to server-side worker

---

# 8. PROJECT SAVE / LOAD

## Current (Electron):
```
Save:
  → useProject triggers save
  → Collects state from all stores:
    → useTimeline: clips[], audioTracks[], textClips[], tracks[], playheadMs, totalDurationMs
    → useCaption: activeStyle, language, entries[]
    → useExport: preset, codec, qualityPreset, etc.
    → useProject: width, height, fps, backgroundColor, aspectRatio
  → Serializes to .ecp JSON format
  → IPC invoke('project:save', { filePath, state })
  → Main process writes JSON to local disk

Load:
  → IPC invoke('project:load', { filePath })
  → Main process reads JSON from local disk
  → Returns state object
  → useTimeline, useCaption, useProject, useExport all restored from state
```

## Web:
```
Save (explicit):
  → Collects state from all stores — IDENTICAL
  → POST /api/projects/:id/save { state: JSON }
  → Server validates ownership, serializes to PostgreSQL JSONB
  → Also saves to R2: users/{uid}/projects/{pid}/state.json (backup)
  → Updates projects.updated_at

Autosave:
  → Debounced 30s after any state change
  → POST /api/projects/:id/autosave { state: JSON }
  → Server writes to R2: users/{uid}/projects/{pid}/autosave.json
  → Does NOT update PostgreSQL (too frequent, JSONB writes are expensive)
  → On load: try PostgreSQL first, fall back to R2 autosave

Load:
  → POST /api/projects/:id/load
  → Server validates ownership
  → Returns state from PostgreSQL (or R2 if PostgreSQL state is older)
  → Client restores all stores — IDENTICAL

Format: .ecp JSON → same schema, stored in PostgreSQL JSONB + R2 backup
```

---

# 9. TIMELINE INTERACTION (Canvas-based)

## Current (Electron):
```
Timeline uses InteractionMachine state machine:
  States: idle, dragging, trimming, selecting, box-selecting, slicing
  Transitions triggered by mousedown/mousemove/mouseup + keyboard modifiers

  SELECT tool (V):
    → mousedown on clip → beginDragCapture() (deferred undo)
    → mousemove → moveClip (updates clip.startMs and/or trackIndex)
    → mouseup → commitDrag() (single undo snapshot)
    → mousedown on empty → box-select start
    → mousemove → update box rectangle
    → mouseup → selectClipRange() for all clips in box

  BLADE tool (B):
    → mousedown on clip at position → splitClipAtPlayhead(clipId, splitMs)
    → Creates two clips from one, preserving all properties

  HAND tool (H):
    → mousedown + drag → pan timeline horizontally (scroll offset)

  ZOOM tool (Z):
    → click → zoom in at cursor position
    → Ctrl+wheel → zoom in/out preserving cursor position (line 307-338)
    → Shift+wheel → horizontal scroll

  SNAP:
    → During drag, snap lines appear at:
      - Other clip edges (start/end)
      - Playhead position
      - Timeline markers (silence markers, etc.)
```

## Web:
```
100% IDENTICAL. Timeline is pure Canvas2D + mouse/keyboard events.
  → InteractionMachine: pure state machine, no changes
  → All mouse handlers: browser events, identical
  → Canvas rendering: browser Canvas2D, identical
  → Snap logic: pure math, identical
  → Deferred undo (beginDragCapture/commitDrag): pure Zustand, identical
  → Custom MIME types for drag-and-drop: browser DataTransfer API, identical
  → Context menus: React components, identical
  → Wheel listener (Ctrl+wheel zoom, Shift+wheel scroll): browser wheel event, identical
```

---

# 10. INSPECTOR (Property Editor)

## Current (Electron):
```
Inspector priority routing (line 1000-1027):
  → If textClip selected → show CaptionStyleTab + CaptionAnimationTab
  → Else if clip selected → show ClipBasicTab (Transform, Crop, Audio, Fade, Keyframes, Speed)
  → Else if audioTrack selected → show AudioTrackBasicTab
  → Else → show ProjectSettings

  ClipBasicTab:
    → Scale slider (5-400%) → setClipTransform({ scaleX, scaleY })
    → Rotation slider (±180°) → setClipTransform({ rotation })
    → Opacity slider (0-100%) → setClipTransform({ opacity })
    → Crop sliders (0-50% each side) → setClipTransform({ cropTop/Bottom/Left/Right })
    → Volume slider (-30dB to +6dB) → setClipVolume() + AudioEngine.setTrackVol()
    → Mute toggle → setClipMute()
    → Fade in/out (0-30s) → setClipFade()
    → KeyframeEditor → setKeyframe(), deleteKeyframe()

  CaptionStyleTab:
    → Font family dropdown (AVAILABLE_FONTS) → updateCaptionStyle({ fontFamily })
    → Font size (12-120px) → updateCaptionStyle({ fontSize })
    → Font weight (300-900) → updateCaptionStyle({ fontWeight })
    → Text color picker → updateCaptionStyle({ textColor })
    → Stroke color picker → updateCaptionStyle({ strokeColor })
    → Stroke width (0-10) → updateCaptionStyle({ strokeWidth })
    → Alignment (left/center/right) → updateCaptionStyle({ textAlign })
    → BG opacity (0-100%) → updateCaptionStyle({ bgOpacity })
    → Mode selector (4 modes) → updateCaptionStyle({ mode })
    → Reveal fade (0-200ms) → updateCaptionStyle({ revealFadeMs })
    → Active highlight color → updateCaptionStyle({ activeHighlightColor })
    → Active text color → updateCaptionStyle({ activeTextColor })
    → Active scale (50-200%) → updateCaptionStyle({ activeScale })
    → Position X/Y (0-100%) → updateCaptionStyle({ positionX/Y })
    → "Apply to All" button → applyStyleToSelection()
```

## Web:
```
100% IDENTICAL. Inspector is pure React forms + Zustand store updates.
  → All sliders: React state + debounced onChange, identical
  → All color pickers: React components, identical
  → All dropdowns: React components, identical
  → dB volume display: pure math (20 * Math.log10(volume)), identical
  → Real-time AudioEngine sync: AudioEngine.setTrackVol() — identical (Web Audio API)
  → KeyframeEditor: pure React + Canvas2D, identical
  → "Apply to All": useCaption.applyStyleToSelection() — identical
```

---

# 11. AUDIO ENGINE

## Current (Electron):
```
AudioEngine singleton:
  → AudioContext (singleton)
  → 512MB LRU buffer cache

  preloadBuffer(path):
    → If path starts with 'http' → fetch(path) → arrayBuffer → decodeAudioData
    → Else → IPC invoke('fs:read-file', path) → arrayBuffer → decodeAudioData
    → Store in LRU cache

  playTracks(audioTracks, trackLanes, headMs, masterVolume):
    → For each track:
      → Get buffer from cache
      → Create AudioBufferSourceNode
      → Create GainNode
      → Connect: source → gain → master
      → Calculate offset: (headMs - track.startMs + track.trimStart) * speed / 1000
      → Set fade-in: gain.gain.linearRampToValueAtTime(target, startTime + fadeInSec)
      → Set fade-out: schedule gain reduction at (duration - fadeOutSec)
      → source.start(0, offset)

  playScrub(buffer, positionSec, volume):
    → 100ms burst at positionSec
    → 5ms anti-click envelope (gain ramp up then down)
    → Throttled to ~16Hz in Preview (60ms minimum interval)

  connectOverlayAudio(clipId, videoElement, volume, muted):
    → createMediaElementSource(videoElement) — ONCE per element
    → Connect through GainNode to master
    → Returns audioId for later disconnect

  setTrackVol(trackId, volume):
    → Cancel scheduled fade ramps
    → Set gain.gain.value immediately
```

## Web:
```
99% IDENTICAL. ONLY CHANGE:
  → preloadBuffer(path):
    → REMOVE the IPC path (line 87-90) — no local file system in browser
    → KEEP the fetch path (line 91-94) — works for R2 CDN URLs
    → That's it. The http:// branch already handles CDN URLs.

  Everything else: 100% identical. Web Audio API is browser-native.
  AudioBufferSourceNode, GainNode, AudioParam.linearRampToValueAtTime — all standard browser APIs.
  512MB LRU cache — pure JS, no changes.
  createMediaElementSource — browser API, no changes.
```

---

# 12. KEYFRAME ANIMATION SYSTEM

## Current (Electron):
```
KeyframeEngine (src/shared/effects/KeyframeEngine.ts):
  → evaluateKeyframes(tracks: KeyframeTrack[], timeMs: number): Record<string, number>
    → For each track:
      → Binary search for surrounding keyframes
      → Interpolate value based on easing function
      → 8 easing types: linear, ease-in, ease-out, ease-in-out, cubic-bezier, bounce, elastic, spring
    → Returns { property: evaluatedValue } for all animated properties

  Used in:
    → Preview overlay compositing (line 530): evaluateKeyframes(clip.keyframes, localTimeMs)
      → Applies opacity from keyframes to overlay video element
    → Inspector KeyframeEditor: visual display of keyframe diamonds on timeline
    → Export FFmpeg filter graph: keyframes converted to FFmpeg expression syntax
```

## Web:
```
100% IDENTICAL. KeyframeEngine is pure math — no I/O, no platform dependencies.
  → evaluateKeyframes: pure function
  → 8 easing functions: pure math
  → Binary search: pure algorithm
  → Used in Preview overlay: identical (CSS opacity from evaluated value)
  → Used in export: server-side port of FFmpeg filter generation
```

---

# 13. TRANSITION SYSTEM

## Current (Electron):
```
Preview transition system (line 1071-1153):
  → Detects when playhead is within outTransition zone of a clip
  → Computes transition progress (0 to 1) based on position within zone
  → Applies based on transition.type:
    - 'crossfade': exit clip opacity decreases, enter clip opacity increases
    - 'dip-to-black': both clips fade to black (opacity → 0, canvas bg visible)
    - 'slide-left': exit clip slides left, enter clip slides in from right
    - 'slide-right': exit clip slides right, enter clip slides in from left
    - 'slide-up': exit clip slides up, enter clip slides in from bottom
    - 'slide-down': exit clip slides down, enter clip slides in from top
    - 'zoom-in': exit clip zooms in (scale up), enter clip appears normal
    - 'zoom-out': exit clip zooms out (scale down), enter clip appears normal
    - 'wipe-left': hard edge wipe from right to left
    - 'wipe-right': hard edge wipe from left to right
  → Uses Canvas2D clip/transform operations
```

## Web:
```
100% IDENTICAL. Transitions are pure Canvas2D rendering.
  → All transition types: Canvas2D operations, identical
  → Progress calculation: pure math, identical
  → TransitionRegistry: pure data + logic, identical
```

---

# 14. DRAG-AND-DROP (Media Import)

## Current (Electron):
```
MediaPanel → Timeline drag:
  → onDragStart in MediaPanel:
    → dataTransfer.setData('application/capcraft-media', JSON.stringify({
        path: media.path,
        durationMs: media.durationMs,
        hasAudio: media.hasAudio,
        width: media.width,
        height: media.height
      }))
  → onDragStart for batch:
    → dataTransfer.setData('application/capcraft-media-batch', JSON.stringify(items[]))
  → onDrop in Timeline:
    → Reads custom MIME type
    → Calculates drop position (X → timeMs, Y → trackIndex)
    → Calls useTimeline.addClip() or useTimeline.addMediaBatch()
```

## Web:
```
99% IDENTICAL. ONLY CHANGE:
  → Custom MIME data: path → url (CDN URL)
  → HTML5 Drag and Drop API: identical in browser
  → Custom MIME types ('application/capcraft-media'): work in any browser
  → Drop position calculation: pure math, identical
```

---

# 15. HOTKEY SYSTEM

## Current (Electron):
```
HotkeyManager component:
  → Global keydown listener
  → Mappings:
    - V → setTool('select')
    - B → setTool('blade')
    - H → setTool('hand')
    - Z → setTool('zoom')
    - Space → toggle play/pause
    - Ctrl+Z → undo
    - Ctrl+Shift+Z → redo
    - Ctrl+C → copySelection()
    - Ctrl+X → cutSelection()
    - Ctrl+V → pasteAtPlayhead()
    - Ctrl+A → selectAll()
    - Delete/Backspace → deleteSelectedClips()
    - T → addText()
    - Ctrl+E → openExport()
    - ? → openShortcuts()
    - Escape → exit fullscreen / deselect
```

## Web:
```
100% IDENTICAL. HotkeyManager is pure React + keyboard events.
  → All mappings: identical
  → No Electron-specific APIs used
```

---

# 16. NOTIFICATION SOUNDS

## Current (Electron):
```
NotificationSound service:
  → preloadSounds() called on page.tsx mount (line 85)
  → Loads SFX files from assets/sfx/ via toFileUrl
  → Plays sounds for: export complete, transcription done, errors, etc.
```

## Web:
```
MINOR CHANGE:
  → Preload via CDN URLs instead of toFileUrl
  → Same audio files (assets/sfx/*.mp3) served from Cloudflare CDN
  → Web Audio API or HTML5 Audio for playback — identical
```

---

# SUMMARY: CHANGE IMPACT MATRIX

| Feature | Change Scope | Effort | Risk |
|---|---|---|---|
| Media import | New upload pipeline (R2 presigned URLs) | HIGH | MEDIUM |
| Timeline clip add | `path` → `url` on Clip interface | LOW | LOW |
| Video playback | Remove `toFileUrl()`, use `clip.url` | LOW | LOW |
| Multi-layer compositing | Remove `toFileUrl()` on overlays | LOW | LOW |
| Caption transcription | IPC → REST + WebSocket, local → GPU whisper | MEDIUM | MEDIUM |
| Caption rendering (4 modes) | ZERO changes | NONE | NONE |
| Export/render | IPC → REST, local FFmpeg → server GPU FFmpeg | HIGH | HIGH |
| Project save/load | IPC → REST, local FS → PostgreSQL + R2 | MEDIUM | LOW |
| Timeline interaction | ZERO changes | NONE | NONE |
| Inspector | ZERO changes | NONE | NONE |
| Audio engine | Remove IPC file read branch (keep http fetch) | LOW | LOW |
| Keyframe animation | ZERO changes | NONE | NONE |
| Transition system | ZERO changes | NONE | NONE |
| Drag-and-drop | `path` → `url` in MIME data | LOW | LOW |
| Hotkey system | ZERO changes | NONE | NONE |
| Notification sounds | CDN URLs instead of file:// | LOW | LOW |

### Total estimated migration effort:
- **ZERO changes**: 8 features (caption rendering, timeline, inspector, keyframes, transitions, hotkeys, audio mixing logic, easing)
- **LOW changes**: 5 features (clip add, playback, drag-drop, audio preload, sounds) — mostly `path` → `url`
- **MEDIUM changes**: 3 features (transcription, project save/load, export config)
- **HIGH changes**: 2 features (media import pipeline, export rendering pipeline)

### Critical path:
1. Media import pipeline (upload → R2 → probe → thumbnail → waveform)
2. Export rendering pipeline (REST → BullMQ → GPU FFmpeg → R2 → download)
3. Everything else is incremental
