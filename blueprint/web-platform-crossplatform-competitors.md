# Capcraft Web Platform — Cross-Platform & Competitor Analysis
## Blueprint v3 Supplement: Desktop (Tauri), Mobile (Capacitor), Competitor Deep-Dive

> **STATUS: PLANNING ONLY — NO CODE CHANGES**

---

# 1. TAURI 2.0 DESKTOP WRAPPER

## Why Tauri over Electron?
| Factor | Electron (current) | Tauri 2.0 |
|---|---|---|
| Bundle size | ~150MB (bundles Chromium + Node) | ~10-15MB (uses OS WebView) |
| Memory usage | ~200-400MB baseline | ~80-150MB baseline |
| Startup time | 2-4 seconds | < 1 second |
| Security | Node.js in renderer (large attack surface) | No Node.js in renderer (Rust backend) |
| Auto-update | electron-updater (manual setup) | Built-in Tauri updater |
| Code sharing | Separate main/renderer process | Web app loaded directly in WebView |

## Architecture
```
Tauri 2.0 App
├── Frontend: Same Next.js web app loaded in OS WebView
│   ├── On macOS: WKWebView (Safari engine)
│   ├── On Windows: WebView2 (Edge Chromium)
│   └── On Linux: WebKitGTK
│
├── Backend: Rust (Tauri commands)
│   ├── Replaces Electron main process
│   ├── Provides native APIs via IPC (Tauri commands)
│   └── Much smaller attack surface than Electron
│
└── Capabilities:
    ├── Native file system access (no presigned URL needed for local files)
    ├── Native file dialogs (open/save)
    ├── Local FFmpeg binary (for client-side export without server)
    ├── Local Whisper binary (for client-side transcription)
    ├── System tray integration
    ├── Global keyboard shortcuts
    ├── Deep links (capcraft://open-project/uuid)
    └── Auto-update via Tauri updater
```

## What Tauri Adds Over Pure Web

### Local file system access
```rust
// Tauri command: read local file without uploading to R2
#[tauri::command]
async fn read_local_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

// In the web app, detect Tauri environment:
if (window.__TAURI__) {
  // Use local file directly — no upload needed
  const buffer = await invoke('read_local_file', { path: filePath });
  // Process locally, upload to R2 only when saving
} else {
  // Pure web: upload to R2 via presigned URL
}
```

### Local FFmpeg for offline export
```rust
#[tauri::command]
async fn export_local(
    config: ExportConfig,
    on_progress: impl Fn(ExportProgress) -> Result<(), String>
) -> Result<String, String> {
    // Run FFmpeg locally — same logic as current Electron FFmpegService
    // No server needed, no queue needed, no GPU encoding (CPU only)
    // Progress callback streams back to frontend
}
```

### Hybrid mode (Tauri-specific)
```
Desktop app can operate in two modes:

ONLINE MODE (default):
  → Same as web app — media in R2, export on server GPU
  → Full features, 4K export, fast transcription

OFFLINE MODE (when no internet):
  → Media stored locally (file system)
  → Export via local FFmpeg (CPU, slower)
  → Transcription via local Whisper (CPU, slower)
  → Sync to cloud when back online

This is a KEY differentiator vs pure web competitors.
```

## Tauri Migration Effort
```
Estimated: 2-3 weeks AFTER web app is complete

Steps:
1. Create Tauri 2.0 project wrapping the Next.js build output
2. Implement Rust commands for:
   - Local file read/write (replaces presigned URL flow)
   - Local FFmpeg spawn (replaces server export for offline mode)
   - Local Whisper spawn (replaces server transcription for offline mode)
   - Native file dialogs
   - System tray
   - Auto-update configuration
3. Add Tauri detection in web app (window.__TAURI__ guard)
4. Test on macOS, Windows, Linux
5. Configure code signing (macOS + Windows)
6. Set up CI/CD for desktop builds (GitHub Actions → Tauri build)
```

---

# 2. CAPACITOR MOBILE WRAPPER

## Why Capacitor over React Native?
| Factor | React Native | Capacitor |
|---|---|---|
| Code sharing | Separate UI code (JSX but different components) | Same web app loaded in WebView |
| Canvas2D | Requires react-native-skia or similar | Works natively in WebView |
| Web Audio API | Not available | Works natively in WebView |
| Development effort | High (new UI layer) | Low (wrap existing web app) |
| Performance | Better for heavy native UI | Good enough for video editor (WebView is GPU-accelerated) |
| Community | Larger | Smaller but growing |

## Architecture
```
Capacitor App
├── Frontend: Same Next.js web app loaded in native WebView
│   ├── iOS: WKWebView (Safari engine, hardware-accelerated)
│   └── Android: Android System WebView (Chromium-based)
│
├── Native plugins:
│   ├── @capacitor/filesystem — local file cache
│   ├── @capacitor/camera — camera access for recording
│   ├── @capacitor/share — native share sheet
│   ├── @capacitor/status-bar — fullscreen editing
│   ├── @capacitor/screen-orientation — lock to landscape
│   ├── @capacitor/keyboard — handle keyboard events
│   └── @capgo/capacitor-updater — OTA updates
│
└── Mobile-specific adaptations:
    ├── Touch-optimized timeline (pinch zoom, swipe pan)
    ├── Simplified toolbar (fewer buttons, larger tap targets)
    ├── Bottom sheet panels (instead of side panels)
    ├── Gesture-based navigation
    └── Reduced preview resolution (save battery)
```

## Mobile UI Adaptations

### Layout changes (page.tsx)
```
DESKTOP (current):
┌──────┬────────┬─────────────────┬──────────┐
│Left  │ Media  │                 │Inspector │
│Rail  │ Panel  │    Preview      │          │
│64px  │ 18%    │     (flex)      │  20%     │
├──────┴────────┴─────────────────┴──────────┤
│                 Timeline 25%                │
└────────────────────────────────────────────┘

MOBILE (adapted):
┌────────────────────────────────────────────┐
│ Toolbar (compact)                    [⋮]   │
├────────────────────────────────────────────┤
│                                            │
│              Preview (60% height)           │
│                                            │
├────────────────────────────────────────────┤
│ Timeline (swipe to expand/collapse)        │
│ [▶] 00:00 ─────────────── 01:30           │
├────────────────────────────────────────────┤
│ Bottom sheet (drag up for panels)          │
│ ┌────────────────────────────────────────┐ │
│ │ Media | Text | Audio | Effects | CC    │ │
│ │                                        │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

### Touch interactions for Timeline
```
DESKTOP:
  - Mouse drag → move clip
  - Mouse drag edge → trim clip
  - Ctrl+wheel → zoom
  - Shift+wheel → pan
  - Right-click → context menu

MOBILE:
  - Single finger drag → move clip
  - Long press + drag edge → trim clip
  - Pinch → zoom timeline
  - Two-finger drag → pan timeline
  - Long press → context menu (as bottom sheet)
  - Double-tap clip → open inspector
```

### Touch interactions for Preview
```
DESKTOP:
  - Click transform handle → move/rotate/scale
  - Scroll wheel → seek
  - Space → play/pause

MOBILE:
  - Drag clip in preview → move (transform)
  - Pinch in preview → scale
  - Two-finger rotate → rotation
  - Tap → play/pause
  - Swipe left/right on preview → seek
```

## Mobile-specific Features
```
1. Camera recording:
   → @capacitor/camera plugin
   → Record directly into timeline
   → Front/back camera switch
   → Record with caption overlay (AR-style)

2. Microphone recording:
   → Record voice-over directly
   → Auto-transcribe via server Whisper
   → Waveform display in timeline

3. Photo library access:
   → @capacitor/filesystem + photo library
   → Select photos/videos from gallery
   → Upload to R2 for editing

4. Native share:
   → Export to R2 → share via native share sheet
   → Direct share to TikTok, Instagram, YouTube
   → Share project link for collaboration

5. Push notifications:
   → Export complete notification
   → Transcription complete notification
   → Collaboration update notification
```

## Capacitor Migration Effort
```
Estimated: 3-4 weeks AFTER web app is complete

Steps:
1. Create Capacitor project wrapping the Next.js build output
2. Configure iOS and Android projects
3. Install and configure native plugins
4. Adapt UI for mobile (responsive layout, bottom sheets, touch gestures)
5. Implement mobile-specific timeline interactions (pinch, swipe)
6. Implement camera/microphone recording
7. Implement native share integration
8. Test on iOS devices (iPhone 12+, iPad)
9. Test on Android devices (Pixel, Samsung)
10. Submit to App Store + Google Play
```

---

# 3. DETAILED COMPETITOR FEATURE MATRIX

## Feature-by-Feature Comparison

### Core Editing
| Feature | Capcraft | CapCut | VEED | Descript | Kapwing | Canva |
|---|---|---|---|---|---|---|
| Multi-track timeline | ✅ (video+audio+caption) | ✅ | ❌ (single track) | ✅ | ✅ (simplified) | ❌ |
| Canvas-based timeline | ✅ | ✅ | ❌ (DOM-based) | ❌ | ❌ | ❌ |
| Clip transform (pos/scale/rotate) | ✅ | ✅ | ✅ (basic) | ✅ | ✅ (basic) | ✅ (basic) |
| Crop | ✅ (per-side %) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Speed control (0.25-4x) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Keyframe animation | ✅ (8 easing types) | ✅ (limited) | ❌ | ❌ | ❌ | ❌ |
| Blend modes (10 types) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Transitions (10 types) | ✅ | ✅ | ✅ (3 types) | ✅ (basic) | ✅ (5 types) | ✅ (basic) |
| Audio mixing (multi-track) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Audio fade in/out | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Volume per-track (dB) | ✅ (-30 to +6 dB) | ✅ | ❌ | ✅ | ❌ | ❌ |
| Ripple delete | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| In/Out point loop | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Frame-accurate seeking | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |

### Caption/Subtitle Features
| Feature | Capcraft | CapCut | VEED | Descript | Kapwing | Canva |
|---|---|---|---|---|---|---|
| Auto-transcription (Whisper) | ✅ (word-level) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Word-level timestamps | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Full-phrase mode | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Word-reveal mode | ✅ (smooth fade) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Karaoke highlight mode | ✅ (color+scale) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Single-word mode | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Caption style presets | ✅ (user-created) | ✅ | ✅ (limited) | ❌ | ❌ | ❌ |
| Per-word styling | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Active state (highlight/scale) | ✅ (3 properties) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reveal fade control | ✅ (0-200ms) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Silence detection | ✅ (timeline markers) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Reformat for shorts (word split) | ✅ (auto) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Non-destructive trim | ✅ (originalWords) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Caption animation presets | ✅ (6 types) | ✅ (limited) | ❌ | ❌ | ❌ | ❌ |
| Apply style to all captions | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Effects & Filters
| Feature | Capcraft | CapCut | VEED | Descript | Kapwing | Canva |
|---|---|---|---|---|---|---|
| Data-driven effect system | ✅ (registry pattern) | ❌ (hardcoded) | ❌ | ❌ | ❌ | ❌ |
| Modifier stack (8 types) | ✅ | ✅ | ✅ (limited) | ❌ | ✅ (limited) | ✅ |
| CSS filter pipeline | ✅ | ❌ (proprietary) | ❌ | ❌ | ❌ | ❌ |
| Custom effect registration | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Preset system | ✅ (user-created) | ✅ | ❌ | ❌ | ❌ | ❌ |

### Export
| Feature | Capcraft | CapCut | VEED | Descript | Kapwing | Canva |
|---|---|---|---|---|---|---|
| Platform presets (9) | ✅ | ✅ | ✅ (limited) | ❌ | ✅ (limited) | ✅ |
| Codec selection (4) | ✅ | ❌ (auto) | ❌ | ❌ | ❌ | ❌ |
| Quality presets (fast/slow) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bitrate control (auto/cbr/vbr) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Frame range export | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Audio-only export | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 4K export | ✅ | ✅ (Pro only) | ✅ (Business) | ✅ | ✅ (Enterprise) | ✅ (Pro) |
| FPS selection (24/30/60) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Hardware acceleration | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| CRF policy (transparent) | ✅ | ❌ (opaque) | ❌ | ❌ | ❌ | ❌ |

### Platform & Access
| Feature | Capcraft | CapCut | VEED | Descript | Kapwing | Canva |
|---|---|---|---|---|---|---|
| Web browser | ✅ (planned) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Desktop (Windows/Mac/Linux) | ✅ (Tauri, planned) | ✅ (Electron) | ❌ | ✅ (Electron) | ❌ | ❌ |
| Mobile (iOS/Android) | ✅ (Capacitor, planned) | ✅ | ✅ (limited) | ✅ (limited) | ❌ | ✅ |
| Offline mode | ✅ (Tauri local) | ✅ | ❌ | ✅ (limited) | ❌ | ❌ |
| Cross-device sync | ✅ (cloud) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Open source | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Collaboration
| Feature | Capcraft | CapCut | VEED | Descript | Kapwing | Canva |
|---|---|---|---|---|---|---|
| Real-time collaboration | ✅ (planned) | ❌ | ✅ (limited) | ✅ | ✅ | ✅ |
| Team projects | ✅ (planned) | ❌ | ✅ (Business) | ✅ | ✅ (Enterprise) | ✅ (Teams) |
| Shared asset library | ✅ (planned) | ❌ | ✅ (Business) | ❌ | ❌ | ✅ |
| Comment/feedback | ❌ (future) | ❌ | ✅ | ✅ | ✅ | ✅ |

## Capcraft's Unique Advantages (Summary)

### 1. Caption System (NOBODY else has this)
- 4 caption modes (full-phrase, word-reveal, karaoke, single-word)
- Word-level timestamp control
- Active state styling (highlight color, text color, scale)
- Reveal fade smoothness control
- Silence detection with timeline markers
- Auto reformat for shorts (word-by-word split)
- Non-destructive trim with original word preservation
- 6 caption animation presets
- User-created caption style presets

### 2. Technical Transparency
- CRF policy visible and configurable
- Codec selection (4 codecs)
- Bitrate control (auto/cbr/vbr)
- Keyframe animation with 8 easing curves
- Data-driven effect system (extensible)
- Blend modes (10 types)

### 3. Cross-Platform Flexibility
- Web + Desktop (Tauri) + Mobile (Capacitor) from ONE codebase
- Offline mode via Tauri (local FFmpeg + Whisper)
- Hybrid: online for heavy tasks, offline for quick edits

### 4. Developer Extensibility
- EffectRegistry pattern (add effects without code changes)
- ModifierEngine (CSS filter pipeline)
- PresetRegistry (user-created presets)
- Open architecture for plugins (future)

---

# 4. MARKET SIZING — DETAILED

## Creator Economy (Total Addressable Market)
```
Global Creator Economy: $252B (2025), growing 15% YoY
├── Influencer/Creator count: 50M+ globally
├── Short-form video creators: 20M+ (TikTok, Reels, Shorts)
├── Podcasters: 5M+ (repurposing to video)
├── Online educators: 3M+ (course creators)
└── Social media agencies: 500K+ (managing client content)

Serviceable Addressable Market (SAM):
  → English-speaking short-form creators: 8M
  → Who pay for editing tools: 2M (25%)
  → Average willingness to pay: $12-29/mo

Serviceable Obtainable Market (SOM) Year 1-3:
  → Year 1: 1,000 users × $15 avg = $180K ARR
  → Year 2: 10,000 users × $15 avg = $1.8M ARR
  → Year 3: 50,000 users × $15 avg = $9M ARR
```

## Video Editing Software Market
```
Global Video Editing Software: $3.75B (2026)
├── Professional (Premiere, Final Cut, DaVinci): $2.1B
├── Prosumer (CapCut, VEED, Descript): $1.2B
└── Consumer (iMovie, Canva Video): $450M

Capcraft targets Prosumer segment:
  → $1.2B market growing 22% YoY
  → Browser-based sub-segment: $300M (25% of prosumer)
  → Growing faster (35% YoY) as web tech matures
```

## Why Now?
```
1. WebCodecs API (Chrome 94+, 2021) — hardware-accelerated video in browser
2. FFmpeg WASM — full FFmpeg ported to browser (2020)
3. Whisper (OpenAI, 2022) — accurate speech-to-text, open source
4. faster-whisper (2023) — 4x faster than Whisper on GPU
5. Cloudflare R2 (2022) — zero egress fees make video hosting viable
6. Tauri 2.0 (2024) — lightweight desktop wrapper
7. React Server Components (2024) — better SSR for editor apps
8. WebGPU (2024) — GPU access in browser for effects/rendering
```

---

# 5. REVENUE DIVERSIFICATION (Beyond Subscriptions)

## Potential Revenue Streams
```
1. Subscriptions (primary): Free / Pro $12 / Business $29 / Enterprise custom
2. Export credits (add-on): $5 for 100 extra export minutes
3. Storage overage: $0.02/GB/month beyond plan limit
4. Template marketplace: 70/30 split (creator/platform)
5. API access (Enterprise): $99-499/mo for programmatic video generation
6. White-label: $299/mo for agency branding removal
7. Priority rendering: $3/mo add-on for faster export queue
```
