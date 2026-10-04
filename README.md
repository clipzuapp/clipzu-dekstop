# Clipzu Desktop Beta

Desktop video editor with offline Whisper transcription, caption styling, and multi-format export. The current packaged beta target is Windows x64. Editing and export work offline after the pinned media runtime is installed once; transcription needs a separate one-time model download.

**Website:** [clipzu.com](https://clipzu.com)

> The editor uses cross-platform application code, but packaged macOS and Linux media-runtime bundles have not been validated for this beta. The release gate currently targets Windows x64.

## Features

- Video stitch, trim, split, reorder with multi-track timeline
- SFX & audio layering with Web Audio API mixing engine (53 bundled SFX)
- Per-track volume control, mute/solo, and role classification
- Auto captions via **Whisper offline** (no API calls, no internet)
- Streaming transcription pipeline (FFmpeg → whisper-cli, no temp files)
- Caption styling & animation presets (pop, fade, slide-up, karaoke, typewriter)
- Word-level caption modes (full-phrase, word-reveal, karaoke, single-word)
- Active state styling (highlight color, active text color, active scale)
- Text clips with custom styling on timeline
- **Effects system** with data-driven modifiers (keyframe animation, composable stack)
- **Transitions** with registry-based definitions (dissolve, slide, wipe, zoom, blur, light)
- **Filters** with CSS filter pipeline (blur, brightness, contrast, saturation, etc.)
- **Keyframe animation** with 8 easing curves (linear, easeIn, easeOut, easeInOut, easeOutBack, easeOutExpo, easeOutElastic, easeOutBounce)
- **Timeline interaction system** with hit-testing, drag/trim/snap, multi-tool support
- **Multi-tool editing** (select, blade, hand, zoom tools)
- **Preview viewport controls** (zoom mode, pan, guide overlays, quality modes, playback speed)
- Export with CapCut-style dimension presets (TikTok, YouTube, Instagram, 4K)
- Hotkey-driven editing (J/K/L, I/O trim points, Space play/pause)
- Project save/load (`.clipzu` format) with a versioned schema validator
- **Portable projects**: media is referenced by relative path + content hash, so moving the project folder (and its media) keeps it loadable
- **Atomic, crash-safe saves**: temp file + fsync + rename, single-flight queue (Ctrl+S spam and autosave coalesce to the latest bytes)
- **Missing-media relink**: a moved/deleted source opens a one-click Recovery dialog (locate each file or scan a folder) instead of failing silently
- **Legacy import**: opens old CapCraft `.ecp` projects (v1) and migrates them to `.clipzu` on next save
- Preset export/import (`.ccpreset` format)
- SRT sidecar export alongside every MP4
- Media library with deduplication and lazy-loaded thumbnails
- Real-time canvas-based preview with caption rendering
- **Export↔preview parity**: a shared export graph feeds effects, keyframes, blend modes, transitions and audio settings into FFmpeg
- Unicode-safe (UTF-8) filenames, captions and metadata everywhere
- LeftRail + RightRail navigation paradigm (CapCut-style)

## Tech Stack

| Layer | Package |
|---|---|
| Shell | electron-vite + Electron 30 |
| UI | React 18 + TypeScript (strict) |
| State | Zustand + Immer (undo/redo via snapshots) |
| Styling | Tailwind CSS (dark editor theme) |
| Video | fluent-ffmpeg (`child_process.spawn`, never blocking) |
| Transcription | whisper-cli.exe (direct spawn, streaming pipeline) |
| Audio | Web Audio API (AudioEngine, multi-track mixing) |
| Effects | ModifierEngine + EffectRegistry + TransitionRegistry |
| Filters | FilterPipeline (Modifier[] → CSS filter) |
| Keyframes | KeyframeEvaluator (pure interpolation) |
| Timeline | Canvas renderer + InteractionMachine |
| DB/Cache | better-sqlite3 (native SQLite, thumbnail cache) |
| Packaging | electron-builder |

## Requirements

### Minimum System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| **OS** | Windows 10 (64-bit), macOS 11+, Ubuntu 20.04+ | Windows 11, macOS 13+, Ubuntu 22.04+ |
| **CPU** | Intel 2nd gen (Sandy Bridge) / AMD FX series | Intel 4th gen (Haswell) or newer / AMD Ryzen |
| **RAM** | 4 GB | 8 GB+ |
| **Storage** | 2 GB (app + models) | 10 GB+ SSD |
| **Display** | 1280×720 | 1920×1080+ |

### Software Dependencies

| Component | Version | Required For | Notes |
|---|---|---|---|
| **Node.js** | 24.21.0 | Development & build | Pinned by `.nvmrc` and `engines.node` |
| **npm** | Node-bundled | Package management | Use `npm ci` with the committed lockfile |
| **FFmpeg / ffprobe** | 8.1.2 essentials | Video processing, export | Windows beta downloads the pinned archive once to per-user app data; local archive installation supports offline setup |
| **whisper-cli** | 1.8.x | Offline transcription | Per-OS build in `resources/bin/` (`whisper-cli.exe` on Windows; `whisper-cli` elsewhere) |
| **Whisper Model** | GGML format | Auto-captions | Download to `models/` (dev) or `resources/models/` (packaged) |
| **MSVC Runtime** | 2015-2022 | Windows only | Checks for `msvcp140.dll` at startup (non-Windows skips this) |

### CPU Feature Requirements

Whisper binary selection is based on CPU capabilities (auto-detected at runtime):

| CPU Generation | Features | Binary Used | Performance |
|---|---|---|---|
| Intel 4th gen+ / AMD Ryzen | AVX2, FMA, SSE4.2 | `whisper-cli-avx2` | Fastest |
| Intel 2nd-3rd gen / AMD FX | AVX, SSE4.2 | `whisper-cli-compat` | Good |
| Older/unknown CPUs | Basic x86_64 | `whisper-cli` (default) | Slower |

**Note:** Systems without AVX support will still run but transcription will be significantly slower.

### Model Size vs System Capability

| Model | Size | RAM Usage | Accuracy (WER) | Speed (4 vCPU) | Best For |
|---|---|---|---|---|---|
| `ggml-base-q8_0` | ~110 MB | ~150 MB | ~12.5% | ~4× realtime | Low-RAM systems |
| `ggml-base` | ~142 MB | ~200 MB | ~11.8% | ~3× realtime | Balanced |
| `ggml-small-q8_0` | ~370 MB | ~450 MB | ~10.5% | ~2× realtime | Quality focus |
| `ggml-small` | ~465 MB | ~500 MB | ~10.1% | ~1.5× realtime | Highest accuracy |

**Recommendation:** Use `ggml-small-q8_0` for most systems. Use `ggml-base-q8_0` for machines with <4GB RAM.

### Platform Setup

### Windows

- **FFmpeg runtime (packaged beta)**: on first launch, download the checksum-pinned FFmpeg 8.1.2 essentials archive (~104 MB), or select that archive from local storage. Clipzu verifies the archive, installs only `ffmpeg.exe` and `ffprobe.exe` into user data, and then edits/exports offline. A removed or damaged runtime can be reinstalled the same way.
- **Visual C++ Redistributable 2015-2022**: required by `whisper-cli.exe` / `ffmpeg.exe`
  - Startup validation checks for `C:\Windows\System32\msvcp140.dll`
  - Download: https://aka.ms/vs/17/release/vc_redist.x64.exe
- **PowerShell 5+**: bundled with all supported Windows versions (used by `start.bat`)

### macOS

- **Xcode Command Line Tools**: required to compile the native `better-sqlite3` module during install
  - `xcode-select --install`
- **Apple Silicon vs Intel**: use the matching `whisper-cli`/`ffmpeg` build in `resources/bin/` (`arm64` vs `x64`). The default `npm install` pulls the correct electron binary for the host.
- **Gatekeeper**: unsigned local builds may need `Right-click → Open` the first time.

### Linux

- **Runtime libraries**: Electron needs a display + standard GUI libs
  - Debian/Ubuntu: `sudo apt install -y libgtk-3-0 libnss3 libasound2 libgbm1`
  - Fedora: `sudo dnf install -y gtk3 nss alsa-lib mesa-libgbm`
- **X11/Wayland**: required for the GUI. For headless/CI use Xvfb:
  - `sudo apt install -y xvfb && xvfb-run -a npx electron-vite dev`
- **AppImage/FUSE**: to run a packaged AppImage, `sudo apt install -y libfuse2` may be required.

---

## Quick Start

All commands run from the repository root. Works on Windows (PowerShell/CMD), macOS, and Linux.

### 1. Install Node.js 24.21.0

Use the version in `.nvmrc` (or install Node.js 24.21.0 from the Node.js release archive). The packaged Windows app obtains its media runtime on first launch; development uses the lockfile's static binaries.

For offline first use, download the pinned FFmpeg archive on a connected computer and copy it to the target computer; choose **Install from local archive** in Clipzu. Only the matching 8.1.2 Gyan archive is accepted.

### 2. Install dependencies

```bash
npm ci
```

The postinstall step installs the `better-sqlite3` prebuilt binary for Electron 30, without requiring a local C++ compiler.

### 3. Download a Whisper model

Place the file in `models/` (development) — the app looks for `models/ggml-small-q8_0.bin` by default. Pick one:

```bash
# Option A: Quantized base (110 MB) — fastest, low RAM
curl -L -o models/ggml-base-q8_0.bin   https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q8_0.bin
# Option B: Base (142 MB) — balanced
curl -L -o models/ggml-base.bin        https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
# Option C: Quantized small (370 MB) — recommended default
curl -L -o models/ggml-small-q8_0.bin  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin
# Option D: Small (465 MB) — highest accuracy
curl -L -o models/ggml-small.bin       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

On Windows PowerShell, `curl` is an alias for `Invoke-WebRequest` — use `curl.exe -L -o ...` or `Invoke-WebRequest -Uri <url> -OutFile models\ggml-small-q8_0.bin`.

> `ggml-small-q5_1.bin` is **not** recommended (known kernel bug in whisper.cpp v1.8.6).

### 4. Run

| OS | Command |
|---|---|
| Windows | `start.bat` (checks prerequisites, installs deps, launches) or `npm run dev` |
| macOS / Linux | `npm run dev` |

`npx electron-vite dev` also works on any platform (equivalent to `npm run dev`).

`scripts/setup-binaries.ps1` (Windows) automates FFmpeg + whisper.cpp binary placement.

## Build Distribution

The build scripts produce a **per-OS** artifact — build on the OS you are targeting (Electron packages native binaries; cross-compiling installers is not supported by default).

| OS | Command | Output |
|---|---|---|
| Windows | `npm run dist:win` | `dist/*-setup.exe` (NSIS installer), also `dist/win-unpacked/` |
| macOS | `npm run dist:mac` | `dist/*.dmg` |
| Linux | `npm run dist:linux` | `dist/*.AppImage` |
| Any | `npm run pack` | unpacked app only (no installer) |

```bash
# Compile only (no installer) — fast sanity build to out/
npm run build

# Typecheck both tsconfigs
npm run typecheck
```

Notes:
- **Windows x64 release**: the installer excludes the FFmpeg/ffprobe pair; first-run setup installs the pinned archive to writable per-user storage. The verified runtime remains available offline afterward.
- **Whisper model**: downloads on first transcription to per-user app data and is never bundled into the installer.
- **macOS/Linux packages**: require target-specific media-runtime packs and a separate validation pass; these packaged targets are not release-ready.
- **macOS signing/notarization** is disabled by default (`electron-builder.yml` → `notarize: false`). Set your Apple credentials to sign for distribution.
- **Linux** `.AppImage` requires `libfuse2` to run on the target machine.
- **Windows** installers are built unsigned unless a code-signing certificate is configured.

## Development

```bash
npm run dev          # hot-reload dev mode
npm run typecheck    # typecheck main+preload and renderer tsconfigs
npm run test:project-format   # project-format / export / relink and runtime downloader tests
```

`build.bat` (Windows) wraps these; `build.bat --pack` runs a packaged build.

### All npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev mode with hot reload |
| `npm run build` | Production build to `out/` |
| `npm run preview` | Preview production build |
| `npm run typecheck` | Typecheck both tsconfigs |
| `npm run pack` | Build + unpackaged app |
| `npm run dist` | Build + installer (auto-detect platform) |
| `npm run dist:win` | Build + Windows installer |
| `npm run dist:mac` | Build + macOS installer |
| `npm run dist:linux` | Build + Linux installer |

## VPS / Server Deployment

Clipzu uses **better-sqlite3** for thumbnail caching. On supported local installs, `npm ci` uses its Electron-compatible prebuilt binary; the runtime installer does not compile it from source.

### Minimum VPS Specs

    | Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 6 GB |
| Storage | 30 GB SSD | 50 GB SSD |
| OS | Ubuntu 22.04+ | Ubuntu 24.04 |

### Model Size vs VPS Capability

| Model | Size | RAM (load) | Accuracy (WER) | Speed (4 vCPU) |
|---|---|---|---|---|
| `ggml-base-q8_0` | 110 MB | ~150 MB | ~12.5% | ~4× realtime |
| `ggml-base` | 142 MB | ~200 MB | ~11.8% | ~3× realtime |
| `ggml-small-q8_0` | 370 MB | ~450 MB | ~10.5% | ~2× realtime |
| `ggml-small` | 465 MB | ~500 MB | ~10.1% | ~1.5× realtime |

**Recommendation for small VPS:** Use `ggml-base-q8_0` (110MB). It processes 1 minute of audio in ~8s on 4 vCPU with only ~150MB RAM overhead.

### Headless Setup (Linux VPS)

```bash
# Install Xvfb for virtual display + FFmpeg
sudo apt update && sudo apt install -y xvfb ffmpeg

# Run with virtual display
xvfb-run -a npx electron-vite dev

# Or with X2Go for remote desktop access
sudo apt install -y x2goserver x2goserver-xsession
```

## Project Structure

```
capcut-killer/
├── src/
│   ├── main/                         # Electron main process (Node.js)
│   │   ├── index.ts                  # Entry point, service initialization, startup validation, DI
│   │   ├── ipc/                      # IPC handlers (ipcMain.handle)
│   │   │   ├── ffmpeg.handler.ts     # Media info, thumbnails, file dialogs, audio extraction
│   │   │   ├── whisper.handler.ts    # Transcription, model validation, diagnostics, timeline transcribe
│   │   │   ├── export.handler.ts     # Export queue management, progress events
│   │   │   ├── project.handler.ts    # Project save/load (.clipzu), legacy .ecp read, relink, SRT/ASS export
│   │   │   └── sfx.handler.ts        # SFX library browsing, file metadata
│   │   ├── project/                  # Project file plumbing (Electron-free, unit-tested)
│   │   │   ├── saveCoordinator.ts    # Atomic save: temp + fsync + rename, single-flight queue
│   │   │   └── projectAssets.ts      # Asset manifest build/resolve, missing-media scan
│   │   ├── services/                 # CPU-heavy services (child_process spawn)
│   │   │   ├── FFmpegService.ts      # Video processing via child_process.spawn
│   │   │   ├── WhisperService.ts     # whisper-cli direct spawn (streaming + file-based)
│   │   │   ├── ThumbnailService.ts   # better-sqlite3 frame cache with FFmpeg extraction
│   │   │   └── ExportQueue.ts        # Priority queue, 1 concurrent job, progress tracking
│   ├── preload/
│   │   └── index.ts                  # Context bridge, safe IPC API exposure
│   ├── renderer/                     # Electron renderer (React/Chromium)
│   │   ├── app/
│   │   │   ├── layout.tsx            # App shell wrapper
│   │   │   ├── main.tsx              # React entry point
│   │   │   └── page.tsx              # Main layout component (all panels, LeftRail, RightRail)
│   │   ├── components/
│   │   │   ├── Preview/              # Canvas2D + rAF loop, video playback, caption rendering
│   │   │   │   ├── index.tsx         # Main preview component
│   │   │   │   ├── CaptionStrip.tsx  # Caption overlay rendering
│   │   │   │   ├── PlaybackControls.tsx # Play/pause, seek, speed controls
│   │   │   │   ├── TransformOverlay.tsx # Clip transform handles
│   │   │   │   └── GuideOverlay.tsx  # Grid, title safe, action safe guides
│   │   │   ├── Timeline/             # Canvas-based timeline with InteractionMachine
│   │   │   ├── CaptionEditor/        # SRT parser UI, inline editing, split/merge
│   │   │   ├── CaptionPresetPanel/   # Caption style presets browser
│   │   │   ├── AudioPanel/           # SFX library browser, drag-to-timeline
│   │   │   ├── Inspector/            # Context-aware properties panel
│   │   │   │   ├── index.tsx         # Main inspector component
│   │   │   │   └── useCaptionStyleBinding.ts # Style binding hook
│   │   │   ├── InspectorHeader/      # Inspector header with entity info
│   │   │   ├── MediaPanel/           # Clips, audio, text library, drag-to-timeline
│   │   │   ├── TextPanel/            # Text clip creation and management
│   │   │   ├── EffectsPanel/         # Effects browser (blur, glow, camera, color, etc.)
│   │   │   ├── FiltersPanel/         # Filters browser (CSS filter effects)
│   │   │   ├── TransitionPicker/     # Transition selector (dissolve, slide, wipe, etc.)
│   │   │   ├── KeyframeEditor/       # Keyframe timeline editor
│   │   │   ├── StylePanel/           # Style & animation presets
│   │   │   │   └── AnimationPresets.ts # Animation preset definitions
│   │   │   ├── LeftRail/             # Left vertical icon rail (Media, Audio, Text, Effects, etc.)
│   │   │   ├── RightRail/            # Right vertical icon rail (Basic, Background, Animation, etc.)
│   │   │   ├── ComingSoonPanel/      # Placeholder for unimplemented tabs
│   │   │   ├── ContextMenu/          # Right-click context menu
│   │   │   ├── ErrorBoundary/        # React error boundary
│   │   │   ├── ExportDialog/         # Preset picker, queue progress, codec selection
│   │   │   │   ├── PresetPicker.tsx  # Export preset selector component
│   │   │   │   └── index.tsx         # Main export dialog
│   │   │   ├── HotkeyManager.tsx     # Global hotkeys (J/K/L, Space, I/O, etc.)
│   │   │   ├── ConfirmDialog/        # Confirmation dialog component
│   │   │   ├── RelinkDialog/         # Missing-media recovery (locate / scan / retry)
│   │   │   ├── Toast/                # Toast notification component
│   │   │   └── ShortcutsDialog/      # Keyboard shortcuts reference
│   │   ├── effects/                  # Effects system (data-driven)
│   │   │   ├── core/                 # Core engines
│   │   │   │   ├── EffectRegistry.ts # Effect definition registry
│   │   │   │   ├── ModifierEngine.ts # Modifier stack processor + validator
│   │   │   │   ├── PresetRegistry.ts # Preset schema management (.ccpreset)
│   │   │   │   └── TransitionRegistry.ts # Transition definition registry
│   │   │   ├── definitions/          # Built-in effect/transition/animation definitions
│   │   │   │   ├── builtinEffects.ts # Blur, brightness, contrast, saturation, etc.
│   │   │   │   ├── captionPresets.ts # Caption animation presets
│   │   │   │   └── transitions.ts    # Transition definitions
│   │   │   ├── types/                # Type system
│   │   │   │   ├── Animation.ts      # Animation definition types
│   │   │   │   ├── Effect.ts         # Effect definition types
│   │   │   │   ├── Keyframe.ts       # Keyframe + easing types
│   │   │   │   ├── Modifier.ts       # Modifier domain types
│   │   │   │   ├── Preset.ts         # Preset + .ccpreset file types
│   │   │   │   └── Transition.ts     # Transition definition types
│   │   │   ├── utils/
│   │   │   │   └── easing.ts         # Easing functions (8 curves)
│   │   │   ├── errors/
│   │   │   │   └── EffectErrors.ts   # Effect system error types
│   │   │   └── index.ts              # Public API barrel export
│   │   ├── ipc/
│   │   │   └── projectIpc.ts         # Typed project/relink IPC call sites
│   │   ├── services/                 # Renderer-side services
│   │   │   ├── AudioEngine.ts        # Web Audio API multi-track mixing engine
│   │   │   ├── FilterPipeline.ts     # Modifier[] → CSS filter string (SSOT)
│   │   │   ├── KeyframeEvaluator.ts  # Keyframe interpolation (SSOT)
│   │   │   ├── projectSession.ts     # Loaded project → stores (reset + hydrate SSOT)
│   │   │   └── WaveformService.ts    # Audio waveform extraction for timeline
│   │   ├── timeline/                 # Timeline interaction system
│   │   │   ├── interaction.ts        # InteractionMachine, hit testing, snap, lane layout
│   │   │   └── useTimelineInteraction.ts # React hook for timeline interactions
│   │   ├── store/                    # Zustand stores with Immer middleware
│   │   │   ├── useTimeline.ts        # clips, audioTracks, textClips, tracks, playhead, zoom, markers, focusedId, modifiers, keyframes
│   │   │   ├── useCaption.ts         # entries, style, transcription, silence detection
│   │   │   ├── useExport.ts          # preset, queue, upscale, codec, quality
│   │   │   ├── useProject.ts         # name, fps, resolution, undo/redo via snapshots
│   │   │   ├── useMediaLibrary.ts    # imported media items, lazy thumbnails
│   │   │   ├── useStartup.ts         # Validation status, environment checks
│   │   │   ├── useConfirm.ts         # Confirmation dialog state
│   │   │   ├── useToast.ts           # Toast notification state
│   │   │   ├── usePreviewView.ts     # Zoom mode, pan, guides, quality, playback speed (NOT persisted)
│   │   │   ├── useRelink.ts          # Missing-media relink dialog state
│   │   │   └── useSelectedEntity.ts  # Derived hook: focusedId → selected entity type
│   │   ├── utils/                    # Renderer utilities
│   │   │   ├── audio.ts              # Audio utilities
│   │   │   ├── format.ts             # Time formatting utilities
│   │   │   ├── geometry.ts           # Geometry utilities
│   │   │   ├── hooks.ts              # Custom React hooks
│   │   │   └── wordActivation.ts     # Word-level caption timing logic
│   │   ├── index.html                # Renderer HTML entry
│   │   └── env.d.ts                  # TypeScript environment declarations
│   └── shared/                       # Cross-process, zero-dependency (main + renderer + tests)
│       ├── project/
│       │   ├── projectSchema.ts      # .clipzu v2 validator + v1→v2 migration (SSOT)
│       │   ├── legacyEcp.ts          # CapCraft .ecp (v1) → loaded project mapping
│       │   ├── relink.ts             # Missing-media token protocol
│       │   └── integration/          # node:test integration suites (schema, relink, undo, golden)
│       ├── export/
│       │   ├── exportGraph.ts        # Shared export graph (effects/keyframes/blend/transitions)
│       │   └── ffmpegText.ts         # Pure ffmpeg escaping / error formatting
│       ├── ipc/
│       │   └── channels.ts           # Typed IPC channel contracts (menu + project + relink)
│       ├── types/
│       │   └── caption.ts            # CaptionStyle interface (SSOT for caption visual properties)
│       └── utils/
│           ├── srt.ts                # SSOT: SRT parse/generate/format (pure functions)
│           ├── timeline.ts           # Timeline timing utilities (recalcDuration, TextClip invariants)
│           ├── color.ts              # Hex color conversion (ASS format, CSS alpha)
│           ├── encoding.ts           # UTF-8 policy (BOM/CR/NFC/byte-length)
│           ├── fileUrl.ts            # Canonical file:// encoder
│           ├── concurrency.ts        # Bounded-parallelism limiter
│           ├── fonts.ts              # AVAILABLE_FONTS array (SSOT for font selection)
│           └── renderGeometry.ts     # Caption layout geometry (canvas dims → pixel coords)
├── models/                           # Primary Whisper model (ggml-small-q8_0.bin)
├── resources/
│   ├── bin/                          # FFmpeg, ffprobe, whisper-cli binaries
│   └── models/                       # Production model location
├── assets/
│   ├── sfx/                          # 53 bundled SFX: whoosh, pop, ding, cheer, laugh, etc.
│   └── fonts/                        # Inter, Poppins, Montserrat, Bebas Neue, Oswald, Anton, Fredoka, etc.
├── out/                              # Build output
├── scripts/
│   ├── setup-binaries.ps1            # Binary setup automation (FFmpeg + whisper.cpp)
│   └── download-sfx*.js              # SFX download scripts
└── test/                             # Test fixtures
    └── export-fixture.json           # Export test fixture
```

## Export Presets

| Preset | Dimensions | Aspect | Notes |
|---|---|---|---|
| TikTok / Reels | 1080×1920 | 9:16 | |
| YouTube | 1920×1080 | 16:9 | |
| Instagram post | 1080×1080 | 1:1 | |
| IG portrait | 1080×1350 | 4:5 | |
| 4K Vertical | 2160×3840 | 9:16 | Requires upscale |
| 4K Horizontal | 3840×2160 | 16:9 | Requires upscale |
| ProRes 422 | 1920×1080 | 16:9 | Master quality |
| WebM / VP9 | 1920×1080 | 16:9 | Web embed |
| Custom | Any | — | |

## Project Files & Portability

Projects are saved as a single `.clipzu` file (JSON, versioned `2.0`). Media is **not** embedded; instead the file stores a manifest of assets with:

- a **relative path** (relative to the `.clipzu` file's folder),
- the original absolute path as a fallback,
- a SHA-256 content hash + size/mtime,
- a per-asset `assetId` (clips/audio reference assets, never raw paths).

This means:

- **Moving the whole project folder** (with its media) keeps it loadable — the relative paths resolve.
- **A missing source** is detected on load and offers the one-click **Relink** dialog (locate each file, or scan a folder); the project is never partially loaded.
- **Legacy CapCraft `.ecp`** (v1) files open via `File → Open Project…` and migrate to `.clipzu` on the next save.
- Saves are **atomic** (write temp → fsync → rename) with a single-flight queue, so Ctrl+S spam and autosave can never corrupt or half-write a project.

## Hotkeys

`Ctrl` in the table below means `Cmd` on macOS (accelerators are `CmdOrCtrl`).

| Key | Action |
|---|---|
| Space | Play / Pause |
| J / K / L | Rewind / Pause / Forward |
| S | Split clip at playhead |
| Delete | Delete selected clip |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+S | Save project |
| Ctrl+Shift+S | Save project as… |
| Ctrl+O | Open project |
| Ctrl+N | New project |
| Ctrl+E | Open export dialog |
| I / O | Set in / out trim points |

## Remaining Work

Tracked gaps after the stabilization pass (intentionally deferred to keep this release stability-focused):

- **Performance (bounded, not re-architected)**: the timeline canvas still redraws the full surface per playhead tick, and thumbnail caching uses synchronous `better-sqlite3` on the main thread. Thumbnail/waveform/proxy fan-out is concurrency-limited (ceiling 4) as a mitigation.
- **Transitions**: slide (4-way) and zoom (in/out) are exported with exact geometry + fades; slides do not reproduce Preview's subtle partial-opacity ramp (export uses gated alpha). Wipe matches Preview (a plain crossfade). Any unmapped transition type falls back to crossfade alpha and is reported, never silent.
- **Packaging**: `resources/models/` is empty by default — the Whisper model must be added before `dist:*` for a self-contained installer. macOS notarization and Windows code-signing are off until credentials are configured.
- **Cross-platform binaries**: `resources/bin/` currently contains Windows binaries; macOS/Linux builds need their per-OS FFmpeg/ffprobe/whisper-cli dropped in before packaging.

## License

MIT
