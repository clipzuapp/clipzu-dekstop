# Capcraft

Desktop video editor with offline Whisper transcription, caption styling, and multi-format export. CapCut replacement for stitch → caption → export workflows.

## Features

- Video stitch, trim, split, reorder with multi-track timeline
- SFX & audio layering with Web Audio API mixing engine (53 bundled SFX)
- Per-track volume control, mute/solo, and role classification
- Auto captions via **Whisper offline** (no API calls, no internet)
- Streaming transcription pipeline (FFmpeg → whisper-cli, no temp files)
- Caption styling & animation presets (pop, fade, slide-up, karaoke, typewriter)
- Word-level caption modes (full-phrase, word-reveal, karaoke, single-word)
- Text clips with custom styling on timeline
- Export with CapCut-style dimension presets (TikTok, YouTube, Instagram, 4K)
- Hotkey-driven editing (J/K/L, I/O trim points, Space play/pause)
- Project save/load (.ecp format)
- SRT sidecar export alongside every MP4
- Media library with deduplication and lazy-loaded thumbnails
- Real-time canvas-based preview with caption rendering

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
| **Node.js** | 18+ | Development & build | Download from https://nodejs.org |
| **npm** | 9+ | Package management | Bundled with Node.js 18+ |
| **FFmpeg** | 5.0+ | Video processing, export | Bundled in `resources/bin/` for production |
| **whisper-cli** | 1.8.x | Offline transcription | Bundled in `resources/bin/` |
| **Whisper Model** | GGML format | Auto-captions | Download to `models/` or `resources/models/` |
| **MSVC Runtime** | 2015-2022 | Windows only | Checks for `msvcp140.dll` at startup |

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

### Windows-Specific Requirements

- **Visual C++ Redistributable 2015-2022**: Required for `whisper-cli.exe` and `ffmpeg.exe`
  - Startup validation checks for `C:\Windows\System32\msvcp140.dll`
  - Download from: https://aka.ms/vs/17/release/vc_redist.x64.exe
- **PowerShell**: Required for `start.bat` script execution
  - All modern Windows versions include PowerShell by default

### macOS-Specific Requirements

- **Xcode Command Line Tools**: May be required for native module compilation during `npm install`
  - Install with: `xcode-select --install`

### Linux-Specific Requirements

- **X11/Wayland**: Required for Electron GUI
- **Xvfb**: For headless/server deployment
  - Install: `sudo apt install -y xvfb`
  - Run: `xvfb-run -a npx electron-vite dev`

---

### Quick Start

### Windows (recommended)

```
Double-click start.bat
```

The `start.bat` script will:
1. Check for Node.js, FFmpeg, and Whisper model
2. Install dependencies if needed
3. Download Electron binary if needed
4. Launch the app in development mode

### Manual Setup

```bash
# Install dependencies (use --ignore-scripts for faster install)
npm install --ignore-scripts

# Run Electron postinstall (downloads binary)
cd node_modules/electron && node install.js && cd ../..

# Download Whisper model (choose one)
# Option A: Quantized base model (110MB) — fastest, recommended for most systems
curl -L -o models/ggml-base-q8_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q8_0.bin

# Option B: Unquantized base model (142MB) — balanced accuracy/speed
curl -L -o models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

# Option C: Quantized small model (370MB) — higher accuracy
curl -L -o models/ggml-small-q8_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin

# Option D: Full small model (465MB) — highest accuracy
curl -L -o models/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

# NOTE: ggml-small-q5_1.bin is NOT recommended (known kernel bug in whisper.cpp v1.8.6)

# Download FFmpeg (Windows)
# Get from: https://www.gyan.dev/ffmpeg/builds/
# Place ffmpeg.exe and ffprobe.exe in resources/bin/

# Run in development
npx electron-vite dev
```

## Building for Production

### Typecheck (always run before build)

```bash
# Both tsconfigs (recommended)
npm run typecheck

# Or individually
npm run typecheck:node
npm run typecheck:web
```

### Build (compile only, no installer)

```bash
# Output goes to out/
npx electron-vite build

# Or the batch script
build.bat
```

### Package (build + installer)

```bash
# Windows installer (.exe) → outputs to dist/
npm run dist:win

# Or the batch shortcut
build.bat --pack
```

### Development

```bash
# Dev mode with hot reload
npx electron-vite dev

# Or double-click start.bat
```

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

Capcraft uses **better-sqlite3** for thumbnail caching. On Linux VPS, native module compilation may be required during `npm install`. No other native build steps needed.

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
│   │   │   ├── project.handler.ts    # Project save/load (.ecp), SRT export
│   │   │   └── sfx.handler.ts        # SFX library browsing, file metadata
│   │   ├── services/                 # CPU-heavy services (child_process spawn)
│   │   │   ├── FFmpegService.ts      # Video processing via child_process.spawn
│   │   │   ├── WhisperService.ts     # whisper-cli.exe direct spawn (streaming + file-based)
│   │   │   ├── ThumbnailService.ts   # sql.js frame cache with FFmpeg extraction
│   │   │   └── ExportQueue.ts        # Priority queue, 1 concurrent job, progress tracking
│   │   └── workers/
│   │       └── thumbnail.worker.ts   # Background thumbnail generation
│   ├── preload/
│   │   └── index.ts                  # Context bridge, safe IPC API exposure
│   ├── renderer/                     # Electron renderer (React/Chromium)
│   │   ├── app/
│   │   │   ├── layout.tsx            # App shell wrapper
│   │   │   ├── main.tsx              # React entry point
│   │   │   └── page.tsx              # Main layout component (all panels)
│   │   ├── components/
│   │   │   ├── Preview/              # Canvas2D + rAF loop, video playback, caption rendering
│   │   │   ├── Timeline/             # react-dnd tracks, Canvas renderer, multi-track
│   │   │   ├── CaptionEditor/        # SRT parser UI, inline editing, split/merge
│   │   │   ├── AudioPanel/           # SFX library browser, drag-to-timeline
│   │   │   ├── Inspector/            # Context-aware properties panel
│   │   │   ├── MediaPanel/           # Clips, audio, text library, drag-to-timeline
│   │   │   ├── TextPanel/            # Text clip creation and management
│   │   │   ├── ExportDialog/         # Preset picker, queue progress, codec selection
│   │   │   │   ├── PresetPicker.tsx  # Export preset selector component
│   │   │   │   └── index.tsx         # Main export dialog
│   │   │   ├── HotkeyManager.tsx     # Global hotkeys (J/K/L, Space, I/O, etc.)
│   │   │   ├── ConfirmDialog/        # Confirmation dialog component
│   │   │   ├── Toast/                # Toast notification component
│   │   │   └── ShortcutsDialog/      # Keyboard shortcuts reference
│   │   ├── services/                 # Renderer-side services
│   │   │   ├── AudioEngine.ts        # Web Audio API multi-track mixing engine
│   │   │   └── WaveformService.ts    # Audio waveform extraction for timeline
│   │   ├── store/                    # Zustand stores with Immer middleware
│   │   │   ├── useTimeline.ts        # clips, audioTracks, textClips, tracks, playhead, zoom, markers
│   │   │   ├── useCaption.ts         # entries, style, transcription, silence detection
│   │   │   ├── useExport.ts          # preset, queue, upscale, codec, quality
│   │   │   ├── useProject.ts         # name, fps, resolution, undo/redo via snapshots
│   │   │   ├── useMediaLibrary.ts    # imported media items, lazy thumbnails
│   │   │   ├── useStartup.ts         # Validation status, environment checks
│   │   │   ├── useConfirm.ts         # Confirmation dialog state
│   │   │   └── useToast.ts           # Toast notification state
│   │   ├── utils/                    # Renderer utilities
│   │   │   ├── format.ts             # Time formatting utilities
│   │   │   ├── hooks.ts              # Custom React hooks
│   │   │   └── wordActivation.ts     # Word-level caption timing logic
│   │   ├── index.html                # Renderer HTML entry
│   │   └── env.d.ts                  # TypeScript environment declarations
│   └── shared/utils/
│       └── srt.ts                    # SSOT: SRT parse/generate/format (pure functions)
├── models/                           # Primary Whisper model (ggml-small-q5_1.bin)
├── models-test/                      # Fallback models for validation testing
│   ├── ggml-base-q8_0.bin           # Fast quantized base (~110MB)
│   ├── ggml-base.bin                # Unquantized base (~142MB)
│   ├── ggml-small-q8_0.bin          # Quantized small (~370MB)
│   └── ggml-small.bin               # Full small (~465MB)
├── resources/
│   ├── bin/                          # FFmpeg, ffprobe, whisper-cli binaries
│   └── models/                       # Production model location
├── assets/
│   ├── sfx/                          # 53 bundled SFX: whoosh, pop, ding, cheer, laugh, etc.
│   └── fonts/                        # Inter, Poppins, Montserrat, Bebas Neue, etc.
├── out/                              # Build output
├── scripts/
│   ├── setup-binaries.ps1            # Binary setup automation (FFmpeg + whisper.cpp)
│   └── download-sfx*.js              # SFX download scripts
└── test_file/                        # Test media and scripts
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

## Hotkeys

| Key | Action |
|---|---|
| Space | Play / Pause |
| J / K / L | Rewind / Pause / Forward |
| S | Split clip at playhead |
| Delete | Delete selected clip |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+S | Save project |
| Ctrl+E | Open export dialog |
| I / O | Set in / out trim points |

## License

MIT
