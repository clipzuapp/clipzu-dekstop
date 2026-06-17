# Capcraft

Desktop video editor with offline Whisper transcription, caption styling, and multi-format export. CapCut replacement for stitch → caption → export workflows.

## Features

- Video stitch, trim, split, reorder with multi-track timeline
- SFX & audio layering with per-track volume control and role classification
- Auto captions via **Whisper offline** (no API calls, no internet)
- Caption styling & animation presets (pop, fade, slide-up, karaoke, typewriter)
- Text clips with custom styling on timeline
- Export with CapCut-style dimension presets (TikTok, YouTube, Instagram, 4K)
- Hotkey-driven editing (J/K/L, I/O trim points, Space play/pause)
- Project save/load (.ecp format)
- SRT sidecar export alongside every MP4
- Media library with deduplication and lazy-loaded thumbnails

## Tech Stack

| Layer | Package |
|---|---|
| Shell | electron-vite + Electron 30 |
| UI | React 18 + TypeScript (strict) |
| State | Zustand + Immer (undo/redo via snapshots) |
| Styling | Tailwind CSS (dark editor theme) |
| Video | fluent-ffmpeg (`child_process.spawn`, never blocking) |
| Transcription | whisper-cli.exe (direct spawn, offline) |
| DB/Cache | sql.js (pure JS SQLite, thumbnail cache) |
| Packaging | electron-builder |

## Requirements

- **Node.js** 18+
- **FFmpeg** on system PATH or in `resources/bin/` (bundled in production)
- **Whisper model** — downloaded to `resources/models/` (see below)

## Quick Start

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
# Option A: Full small model (465MB) — highest accuracy
curl -L -o resources/models/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

# Option B: Quantized (182MB) — best for VPS / low-RAM machines
curl -L -o resources/models/ggml-small-q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin

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

Capcraft uses **sql.js** (pure JavaScript SQLite) instead of native bindings, so it works on any platform without compilation. No build tools needed.

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
| `ggml-small-q5_1` | 182 MB | ~220 MB | ~11.2% | ~2× realtime |
| `ggml-small` | 465 MB | ~500 MB | ~10.1% | ~3× realtime |

**Recommendation for small VPS:** Use `ggml-small-q5_1` (182MB). It processes 1 minute of audio in ~15s on 4 vCPU with only ~220MB RAM overhead.

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
│   │   │   └── project.handler.ts    # Project save/load (.ecp), SRT export
│   │   ├── services/                 # CPU-heavy services (child_process spawn)
│   │   │   ├── FFmpegService.ts      # fluent-ffmpeg via child_process.spawn
│   │   │   ├── WhisperService.ts     # whisper-cli.exe direct spawn (no worker_threads)
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
│   │   │   ├── Preview/              # Canvas2D + rAF loop, 30fps playback, caption rendering
│   │   │   ├── Timeline/             # react-dnd tracks, Canvas renderer, multi-track
│   │   │   ├── CaptionEditor/        # SRT parser UI, inline editing, split/merge
│   │   │   ├── StylePanel/           # Font, color, animation presets
│   │   │   ├── TransformPanel/       # Clip transform (position, scale, rotation, crop)
│   │   │   ├── Inspector/            # Context-aware properties panel
│   │   │   ├── MediaPanel/           # Clips, audio, SFX library, drag-to-timeline
│   │   │   ├── TextPanel/            # Text clip creation and management
│   │   │   ├── ExportDialog/         # Preset picker, queue progress, codec selection
│   │   │   │   ├── PresetPicker.tsx  # Export preset selector component
│   │   │   │   └── index.tsx         # Main export dialog
│   │   │   └── HotkeyManager.tsx     # Global hotkeys (J/K/L, Space, I/O, etc.)
│   │   ├── store/                    # Zustand stores with Immer middleware
│   │   │   ├── useTimeline.ts        # clips, audioTracks, textClips, tracks, playhead, zoom, markers
│   │   │   ├── useCaption.ts         # entries, style, transcription, silence detection
│   │   │   ├── useExport.ts          # preset, queue, upscale, codec, quality
│   │   │   ├── useProject.ts         # name, fps, resolution, undo/redo via snapshots
│   │   │   ├── useMediaLibrary.ts    # imported media items, lazy thumbnails
│   │   │   ├── useStartup.ts         # Validation status, environment checks
│   │   │   ├── useConfirm.ts         # Confirmation dialog state
│   │   │   └── useToast.ts           # Toast notification state
│   │   ├── utils/
│   │   │   ├── format.ts             # Time formatting utilities
│   │   │   └── hooks.ts              # Custom React hooks
│   │   ├── index.html                # Renderer HTML entry
│   │   └── env.d.ts                  # TypeScript environment declarations
│   └── shared/utils/
│       └── srt.ts                    # SSOT: SRT parse/generate/format (pure functions)
├── models/                           # Whisper model files (ggml-*.bin)
├── resources/
│   ├── bin/                          # FFmpeg, ffprobe, whisper-cli binaries
│   └── models/                       # Production model location
├── assets/
│   ├── sfx/                          # Bundled SFX: whoosh, pop, ding, boom, swipe
│   └── fonts/                        # Inter variable font
├── out/                              # Build output
├── scripts/
│   └── setup-binaries.ps1            # Binary setup automation
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
