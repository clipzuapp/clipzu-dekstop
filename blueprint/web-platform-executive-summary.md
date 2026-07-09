# Capcraft Web Platform — Executive Summary & Decision Log
## Blueprint v3 — Master Index

> **STATUS: PLANNING ONLY — NO CODE CHANGES**
> This is the master index for the entire web platform blueprint collection.
> Read this first. Then dive into specific documents as needed.

---

# DOCUMENT COLLECTION

| # | Document | Lines | Contents |
|---|---|---|---|
| 1 | `web-platform-blueprint-v3.md` | 971 | Core architecture, tech stack, database schema, storage, scalability tiers, business model, ROI, migration phases, risk analysis, exact code references |
| 2 | `web-platform-data-flow-migration.md` | 778 | 16 features traced end-to-end: current Electron code path vs web code path. References actual function names and line numbers |
| 3 | `web-platform-implementation-reference.md` | 1000 | API request/response JSON schemas for every endpoint. WebSocket protocol. Line-by-line Zustand store changes. New project folder structure. Environment variables. Testing strategy |
| 4 | `web-platform-crossplatform-competitors.md` | 440 | Tauri desktop wrapper spec. Capacitor mobile spec. Feature-by-feature competitor matrix (CapCut, VEED, Descript, Kapwing, Canva). Market sizing. Revenue diversification |
| 5 | `web-platform-architecture-diagrams.md` | 479 | 8 Mermaid diagrams: current Electron architecture, target web architecture, media upload flow, export flow, transcription flow, infrastructure deployment, cross-platform architecture, state management flow |
| 6 | `web-platform-migration-checklist.md` | 441 | 100+ actionable checkboxes organized in 5 phases: setup, copy & adapt, API server, integration & testing, polish & launch, desktop & mobile |
| 7 | `web-platform-performance-constraints.md` | 284 | Performance budgets (rendering, memory, network, bundle size). Browser compatibility matrix. File size limits. Rate limits. Scaling triggers. Error handling strategy. Offline PWA support. .ecp migration |
| 8 | `web-platform-ux-specification.md` | 489 | Responsive layout (5 breakpoints). Onboarding flow (8 steps). Keyboard shortcuts (40+). Context menus (5 types). Toast messages. Empty states |
| 9 | `web-platform-security-specification.md` | 530 | Auth flow (JWT + OAuth). Authorization (ownership validation). Input validation (Zod). Upload security. Rate limiting. Data protection (encryption, CSP, CORS). GDPR compliance. Incident response |
| 10 | `web-platform-executive-summary.md` | This file | Decision log, change impact matrix, timeline, cost summary, master index |

**Total documentation: ~5,700 lines of Capcraft-specific analysis across 10 documents**

---

# KEY DECISIONS MADE

| # | Decision | Rationale | Rejected Alternative |
|---|---|---|---|
| D1 | **Next.js 15 (App Router)** for frontend | SSR for landing pages, CSR for editor. Same React patterns as current app. | Remix (less mature), CRA (no SSR), Vite SPA (no SSR) |
| D2 | **Zustand 5 + Immer** kept as-is | All 10 stores migrate with minimal changes. No Redux migration needed. | Redux Toolkit (too much rewrite), Jotai (different paradigm) |
| D3 | **Hono** for API server | TypeScript-first, lightweight, WebSocket support. Runs on Node.js. | Express (older), Fastify (more complex), tRPC (tight coupling) |
| D4 | **PostgreSQL (Supabase)** for database | Auth + DB in one. JSONB handles project state. Good free tier. | PlanetScale (no JSONB), MongoDB (no relational integrity) |
| D5 | **Cloudflare R2** for storage | **Zero egress fees** — critical for video. Video files are huge, egress would bankrupt us. | AWS S3 ($0.09/GB egress = $900/month at 10TB), GCS |
| D6 | **BullMQ + Redis** for job queue | Replaces current ExportQueue (1 concurrent → N concurrent). Proven, TypeScript-native. | AWS SQS (vendor lock), RabbitMQ (not TypeScript) |
| D7 | **Socket.io** for realtime | Replaces all IPC main→renderer events. Auto-reconnect, fallback to polling. | Raw WebSocket (no fallback), Server-Sent Events (one-way) |
| D8 | **Tauri 2.0** for desktop | 10x smaller than Electron (10MB vs 150MB). Uses OS WebView. Same web codebase. | Keep Electron (too heavy), Flutter desktop (different codebase) |
| D9 | **Capacitor** for mobile | Wraps web app directly. Same codebase. Access to native APIs via plugins. | React Native (separate UI code), Flutter (separate codebase) |
| D10 | **`path` → `url` field rename** on Clip/AudioTrack | CDN URLs replace local file paths. This is THE fundamental migration change. | Keep `path` and add `url` alongside (confusing, dual source of truth) |
| D11 | **Server-side FFmpeg** for export, **FFmpeg WASM** for thumbnails | Heavy rendering needs GPU (only available server-side). Thumbnails are quick (client-side OK). | All client-side (no GPU, no 4K), All server-side (unnecessary latency for thumbnails) |
| D12 | **faster-whisper on GPU** for transcription | 4x faster than Whisper, runs on GPU. Separate BullMQ worker. | whisper.cpp WASM (slow), OpenAI API ($0.006/min = expensive at scale) |
| D13 | **Supabase Auth** for authentication | $25/mo at 100K MAU. Email + OAuth. JWT in httpOnly cookie. | Clerk ($2,000/mo at 100K MAU), Auth0 ($95/mo for 1K MAU) |
| D14 | **Stripe** for billing | Industry standard. Webhooks for payment events. Usage-based billing support. | Paddle (higher fees), Lemon Squeezy (less mature) |
| D15 | **Canvas2D** kept for rendering | Caption rendering, timeline, transform gizmo all use Canvas2D. Works identically in browser. | WebGL (overkill, harder), WebGPU (not stable enough) |

---

# CHANGE IMPACT SUMMARY

## What changes and what doesn't

### ZERO CHANGES (8 features — ~60% of codebase):
| Feature | Why no changes needed |
|---|---|
| Caption rendering (4 modes) | Pure Canvas2D — browser-native |
| Timeline interaction (Canvas) | Pure Canvas2D + mouse events — browser-native |
| Inspector (property editor) | Pure React forms + Zustand — no I/O |
| Keyframe animation (8 easings) | Pure math — no I/O |
| Transition system (10 types) | Pure Canvas2D — browser-native |
| Hotkey system | Pure React + keyboard events — no I/O |
| Effects system (registry/engine) | Pure data + logic — no I/O |
| All shared utilities | Pure functions — no I/O |

### LOW CHANGES (5 features — ~20% of codebase):
| Feature | What changes |
|---|---|
| Video playback | Remove `toFileUrl()`, use `clip.url` (1 line) |
| Multi-layer compositing | Remove `toFileUrl()` on overlays (1 line) |
| Timeline clip add | `path` → `url` in Clip interface (type change) |
| Drag-and-drop | `path` → `url` in MIME data (1 field) |
| Notification sounds | CDN URLs instead of file:// (trivial) |

### MEDIUM CHANGES (3 features — ~10% of codebase):
| Feature | What changes |
|---|---|
| Caption transcription | IPC → REST + WebSocket, local path → CDN URL |
| Project save/load | IPC → REST, local FS → PostgreSQL + R2 |
| Audio engine | Remove IPC file read branch (keep http fetch) |

### HIGH CHANGES (2 features — ~10% of codebase):
| Feature | What changes |
|---|---|
| Media import | New upload pipeline (presigned R2 URLs, server probe/thumb/waveform) |
| Export/render | IPC → REST, local FFmpeg → server GPU FFmpeg, output → R2 |

### DELETED (1 feature):
| Feature | Why |
|---|---|
| Startup validation (useStartup) | No binaries to check in web app |

---

# COST PROJECTION

## Infrastructure Cost by User Scale
| Users | Monthly Cost | Per-User Cost | Notes |
|---|---|---|---|
| 0-100 | ~$15/mo | $0.15 | Single VPS, Supabase free, R2 free tier |
| 100-1,000 | ~$125/mo | $0.14 | Better VPS, Supabase Pro, on-demand GPU |
| 1,000-10,000 | ~$1,200/mo | $0.13 | Multiple workers, Supabase Team, GPU cluster |
| 10,000-50,000 | ~$7,500/mo | $0.11 | Kubernetes, read replicas, multi-region |

## Revenue Projection
| Year | Users | Paying | ARR | Infrastructure | Net Margin |
|---|---|---|---|---|---|
| Year 1 | 1,000 | 200 | $39K | $1.8K | 95% |
| Year 2 | 10,000 | 3,000 | $534K | $28.8K | 94.5% |
| Year 3 | 50,000 | 15,000 | $2.77M | $396K (incl team) | 85% |

---

# TIMELINE

## Phase 1: Foundation (Weeks 1-4)
```
Goal: Editor works in browser with upload → preview
Deliverables:
  - Next.js project setup
  - All shared utilities copied (zero changes)
  - All stores migrated (path→url, IPC→REST stubs)
  - All components migrated (toFileUrl removed)
  - Supabase auth working
  - R2 upload pipeline working
  - Basic preview playback with CDN URLs
```

## Phase 2: Backend Core (Weeks 5-8)
```
Goal: Full pipeline works end-to-end
Deliverables:
  - Hono API with all REST endpoints
  - Media processing pipeline (probe → thumbnail → waveform)
  - Project save/load (PostgreSQL + R2)
  - Export worker (GPU FFmpeg, same CRF policy)
  - Transcription worker (faster-whisper GPU)
  - WebSocket for progress events
  - End-to-end test: upload → edit → caption → export
```

## Phase 3: Polish & Launch (Weeks 9-12)
```
Goal: Production-ready SaaS
Deliverables:
  - Landing page + pricing
  - Onboarding flow
  - Stripe billing integration
  - Usage limits enforcement
  - Responsive tablet layout
  - PWA + offline support
  - Performance optimization
  - Security audit
  - Launch on Product Hunt
```

## Phase 4: Desktop & Mobile (Weeks 13-16)
```
Goal: Cross-platform presence
Deliverables:
  - Tauri 2.0 desktop app (Windows + macOS + Linux)
  - Capacitor mobile app (iOS + Android)
  - Offline mode (Tauri local FFmpeg + Whisper)
  - App Store + Google Play submission
```

## Phase 5: Growth (Weeks 17+)
```
Goal: Feature expansion
Deliverables:
  - Real-time collaboration
  - Template marketplace
  - AI features (auto-cut, smart zoom)
  - Brand kit
  - API for programmatic video
  - White-label option
```

---

# RISK MATRIX

| Risk | Severity | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Browser video perf issues | HIGH | MEDIUM | Bad UX on low-end devices | WebCodecs API, lazy loading, resolution limits |
| CapCut launches web version | HIGH | MEDIUM | Direct competition in browser | Focus on caption niche, move fast |
| GPU worker costs spike | MEDIUM | LOW | Margins shrink | Auto-scale to 0, on-demand instances, usage limits |
| Large file upload failures | MEDIUM | MEDIUM | User frustration | Multipart upload, resume, progress bar |
| Data loss | HIGH | LOW | Trust destruction | Autosave 30s, R2 versioning, PITR |
| Safari WebCodecs support | LOW | MEDIUM | Reduced features on Safari | Feature detection, fallback to server |

---

# QUICK REFERENCE: KEY FILES IN CURRENT CODEBASE

## Files that migrate AS-IS (copy, no changes):
```
src/shared/effects/EffectRegistry.ts
src/shared/effects/ModifierEngine.ts
src/shared/effects/TransitionRegistry.ts
src/shared/effects/PresetRegistry.ts
src/shared/effects/KeyframeEngine.ts
src/shared/utils/easing.ts
src/shared/utils/caption-layout.ts
src/shared/utils/color.ts
src/shared/utils/srt.ts
assets/fonts/*.ttf (serve via CDN)
assets/sfx/*.mp3 (serve via CDN)
```

## Files that need minor changes (path→url):
```
src/renderer/store/useTimeline.ts          — 6 locations (Clip.path, AudioTrack.path)
src/renderer/components/Preview/index.tsx  — 2 locations (toFileUrl calls on lines 285, 501)
```

## Files that need medium changes (IPC→REST):
```
src/renderer/store/useCaption.ts           — 7 locations (IPC calls)
src/renderer/store/useExport.ts            — 4 locations (IPC calls)
src/renderer/store/useProject.ts           — 3 locations (IPC calls)
src/renderer/store/useMediaLibrary.ts      — 4 locations (IPC calls + upload flow)
src/renderer/services/AudioEngine.ts       — 1 location (remove IPC file read, line 87-90)
```

## Files that need major changes:
```
src/main/services/FFmpegService.ts         — Port to server-side worker + client WASM
src/renderer/app/page.tsx                  — Remove startup validation, IPC→WebSocket
```

## Files that get DELETED:
```
src/renderer/store/useStartup.ts           — No binary validation needed
electron.vite.config.ts                    — No Electron
src/main/                                  — Entire main process (replaced by API server)
src/preload/                               — No preload script needed
```

---

# WHAT TO DO NEXT

When ready to start implementation:

1. **Read all 4 blueprint documents** — understand the full picture
2. **Set up infrastructure** — Supabase, R2, Redis, Stripe accounts
3. **Initialize Next.js project** — `npx create-next-app@latest capcraft-web`
4. **Copy shared/ utilities** — zero changes, immediate win
5. **Copy + adapt stores** — apply the 6+7+4+3+4 = 24 location changes
6. **Copy + adapt components** — remove toFileUrl, adapt upload flow
7. **Build API server** — start with auth + media upload
8. **Test end-to-end** — upload → timeline → preview → caption → export
9. **Add export worker** — GPU FFmpeg with same CRF policy
10. **Add transcription worker** — faster-whisper on GPU
11. **Polish + launch** — landing page, billing, onboarding
12. **Desktop + mobile** — Tauri + Capacitor wrappers

**Total estimated timeline: 16 weeks to cross-platform launch**
**Total estimated cost to launch: ~$500 (infrastructure for first 3 months)**
