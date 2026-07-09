# Capcraft Web Platform — Performance Budget & Technical Constraints
## Blueprint v3 Supplement: Performance Targets, Limits, and Constraints

> **STATUS: PLANNING ONLY — NO CODE CHANGES**

---

# 1. PERFORMANCE BUDGET

## 1.1 Rendering Performance

| Metric | Target | Measurement | Current (Electron) | Notes |
|---|---|---|---|---|
| Timeline canvas frame time | < 16ms | `performance.now()` per render cycle | ~8-12ms | Must maintain 60fps during drag/scroll |
| Caption canvas frame time | < 33ms | `performance.now()` per frame | ~15-25ms at 30fps | FRAME_INTERVAL = 33ms (30fps target) |
| Preview composite frame time | < 33ms | DevTools Performance tab | ~20-30ms | Video + overlays + captions combined |
| Inspector re-render time | < 50ms | React DevTools profiler | ~10-30ms | Debounced sliders prevent spam |
| Full app initial render | < 2s | Lighthouse FCP | ~1.5s | Next.js SSR should help |
| Time to interactive | < 4s | Lighthouse TTI | ~3s | Code splitting critical |

## 1.2 Memory Budget

| Component | Limit | Measurement | Current (Electron) | Notes |
|---|---|---|---|---|
| AudioEngine LRU cache | 512MB | `audioContext` memory | 512MB (same) | Already has eviction policy |
| Video element pool | MAX 4 overlays | Count `<video>` elements | MAX 4 (same) | Hard cap in Preview effect 4b |
| Zustand store snapshots | < 5MB per snapshot | `JSON.stringify(state).length` | 5MB limit (same) | useProject undo stack |
| Undo stack depth | Max 20 entries | `stack.length` | 20 (same) | Deep clone via structuredClone |
| Thumbnail LRU cache | 500 entries | `cache.size` | 500 (same) | useMediaLibrary |
| Total JS heap | < 500MB | Chrome Task Manager | ~300-400MB | Alert at 400MB, warn at 300MB |
| Total browser tab memory | < 800MB | Chrome Task Manager | ~500-700MB (Electron) | Should be lower without Chromium overhead |

## 1.3 Network Performance

| Operation | Target | Measurement | Notes |
|---|---|---|---|
| API response time (read) | < 200ms | Server timing header | p95 target |
| API response time (write) | < 500ms | Server timing header | p95 target |
| Project save (50MB state) | < 3s | Upload progress | Compress with gzip (~10MB) |
| Project load (50MB state) | < 2s | Download progress | Compress with gzip |
| Media upload (1GB) | < 60s | Multipart progress | 100MB chunks, parallel upload |
| Thumbnail generation | < 5s | Worker processing | Server-side FFmpeg single frame |
| Waveform extraction | < 10s | Worker processing | Server-side FFmpeg |
| Export (10min 1080p) | < 3min | GPU worker | NVENC 5-10x realtime |
| Transcription (10min audio) | < 30s | GPU worker | faster-whisper ~3x realtime |
| WebSocket event latency | < 100ms | Client-to-server RTT | For progress updates |

## 1.4 Bundle Size Budget

| Bundle | Target | Measurement | Notes |
|---|---|---|---|
| Initial JS (critical path) | < 200KB gzipped | Next.js build output | Code split aggressively |
| Editor page JS (total) | < 500KB gzipped | Next.js build output | Lazy load panels |
| CSS (total) | < 50KB gzipped | Next.js build output | Tailwind purges unused |
| Font files (total) | < 500KB | Sum of TTF/WOFF2 | Use WOFF2 for web, subset |
| FFmpeg WASM | < 25MB | Worker chunk | Lazy load only when needed |
| Total initial page weight | < 2MB | Lighthouse | Including fonts, images |

---

# 2. TECHNICAL CONSTRAINTS

## 2.1 Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge | Notes |
|---|---|---|---|---|---|
| Canvas2D | ✅ 1.0 | ✅ 1.0 | ✅ 1.0 | ✅ 1.0 | Universal |
| Web Audio API | ✅ 14+ | ✅ 23+ | ✅ 14.1+ | ✅ 79+ | Universal |
| WebCodecs | ✅ 94+ | ❌ (flag) | ❌ | ✅ 94+ | Chrome/Edge only — fallback needed |
| OffscreenCanvas | ✅ 69+ | ✅ 105+ | ✅ 16.4+ | ✅ 69+ | For Web Worker canvas |
| structuredClone | ✅ 98+ | ✅ 94+ | ✅ 15.4+ | ✅ 98+ | For undo snapshots |
| ResizeObserver | ✅ 64+ | ✅ 69+ | ✅ 13.1+ | ✅ 79+ | For responsive panels |
| Web Workers | ✅ 4+ | ✅ 3.5+ | ✅ 4+ | ✅ 12+ | Universal |
| SharedArrayBuffer | ✅ 68+ | ✅ 79+ | ✅ 15.2+ | ✅ 79+ | For FFmpeg WASM |
| WebSocket | ✅ 16+ | ✅ 11+ | ✅ 7+ | ✅ 12+ | Universal |
| File API (drag-drop) | ✅ 6+ | ✅ 3.6+ | ✅ 11.1+ | ✅ 12+ | Universal |
| Presigned POST upload | ✅ 4+ | ✅ 3.5+ | ✅ 5+ | ✅ 12+ | Universal |

### Minimum Browser Requirements:
```
Supported:
  - Chrome 98+ (released Feb 2022)
  - Edge 98+ (released Feb 2022)
  - Firefox 94+ (released Nov 2021)
  - Safari 15.4+ (released Mar 2022)

Not supported:
  - IE 11 (no Canvas2D perf, no Web Audio)
  - Safari < 15.4 (no structuredClone)
  - Firefox < 94 (no structuredClone)

Degraded experience (functional but slower):
  - Safari: No WebCodecs → server-side thumbnail generation
  - Firefox: No WebCodecs → server-side thumbnail generation
```

## 2.2 File Size Limits

| Limit | Value | Rationale |
|---|---|---|
| Max single upload | 5GB | R2 presigned POST limit |
| Max project state | 50MB | PostgreSQL JSONB practical limit |
| Max export duration | 60 minutes | GPU worker time limit (free: 10min, pro: 60min) |
| Max timeline tracks | 20 video + 20 audio + 10 caption | Canvas rendering performance |
| Max clips per project | 500 | Undo stack memory (500 × 5MB = 2.5GB worst case) |
| Max captions per project | 2,000 | Canvas rendering + memory |
| Max keyframes per clip | 100 | Evaluation performance |
| Max overlay layers | 4 | Hard cap in Preview (MAX_OVERLAYS = 4) |
| Max undo stack depth | 20 | Memory limit (useProject) |
| Max thumbnail cache | 500 entries | Memory limit (useMediaLibrary) |
| Max audio buffer cache | 512MB | AudioEngine LRU eviction |

## 2.3 Rate Limits

| Endpoint | Free | Pro | Business |
|---|---|---|---|
| API requests | 100/min | 300/min | 1000/min |
| Media uploads | 10/min | 30/min | 100/min |
| Export jobs | 3/min | 10/min | 30/min |
| Transcription jobs | 3/min | 10/min | 30/min |
| Concurrent exports | 1 | 3 | 10 |
| WebSocket connections | 1 | 3 | 10 |
| Project saves | 10/min | 30/min | 60/min |

## 2.4 Storage Limits

| Plan | Media Storage | Export Storage | Max Projects | Max Export Duration |
|---|---|---|---|---|
| Free | 1 GB | 100 MB (last 3) | 3 | 10 min/month |
| Pro | 50 GB | 5 GB (last 50) | Unlimited | Unlimited |
| Business | 500 GB | 50 GB (last 200) | Unlimited | Unlimited |

---

# 3. SCALING TRIGGERS

## When to scale infrastructure:

| Metric | Trigger | Action |
|---|---|---|
| API p95 latency > 500ms | Sustained for 5 min | Add Next.js server instance |
| WebSocket connections > 5,000 | Per server | Add Socket.io server + Redis adapter |
| BullMQ queue depth > 20 | Sustained for 10 min | Add worker instance |
| GPU worker utilization > 80% | Sustained for 30 min | Add GPU worker |
| PostgreSQL CPU > 70% | Sustained for 15 min | Add read replica |
| R2 storage > 80% of plan | N/A | Alert user, offer upgrade |
| Memory per tab > 600MB | User reports | Investigate memory leak |
| Export failure rate > 5% | Per hour | Alert engineering |

---

# 4. MONITORING DASHBOARDS

## 4.1 Real-time Dashboard
```
- Active users (WebSocket connections)
- API request rate + error rate
- Export queue depth + processing time
- Transcription queue depth + processing time
- Database connection count
- R2 storage growth
```

## 4.2 Daily Dashboard
```
- New signups / churn
- Revenue (MRR)
- Export jobs completed / failed
- Transcription jobs completed / failed
- Storage usage per user (top 100)
- API latency percentiles (p50, p95, p99)
- Error rate by endpoint
```

## 4.3 Weekly Dashboard
```
- User growth rate
- Feature usage (caption modes, export presets, effects)
- Revenue growth rate
- Infrastructure cost per user
- Bug report count + resolution time
- Performance regression check
```

---

# 5. ERROR HANDLING STRATEGY

## 5.1 Client-Side Error Handling

| Error Type | Handling | User Experience |
|---|---|---|
| API 401 (unauthorized) | Redirect to login | "Session expired, please log in" |
| API 403 (forbidden) | Show error toast | "You don't have access" |
| API 404 (not found) | Show 404 page | "Project not found" |
| API 429 (rate limited) | Retry with backoff | "Too many requests, please wait" |
| API 500 (server error) | Show error toast + Sentry | "Something went wrong, please retry" |
| WebSocket disconnect | Auto-reconnect + toast | "Connection lost, reconnecting..." |
| Video load failure | Show error overlay | "Failed to load video" |
| Audio decode failure | Skip track + toast | "Failed to load audio" |
| Canvas render error | ErrorBoundary fallback | "Preview error, please refresh" |
| Upload failure | Retry 3x + toast | "Upload failed, please retry" |
| Quota exceeded | Show upgrade prompt | "Storage limit reached, upgrade?" |

## 5.2 Server-Side Error Handling

| Error Type | Handling | Response |
|---|---|---|
| Validation error (Zod) | Return 400 with field errors | `{ "error": "Validation failed", "fields": {...} }` |
| Auth error | Return 401 | `{ "error": "Unauthorized" }` |
| Not found | Return 404 | `{ "error": "Resource not found" }` |
| Conflict | Return 409 | `{ "error": "Resource already exists" }` |
| Rate limited | Return 429 + Retry-After header | `{ "error": "Rate limited", "retryAfter": 60 }` |
| FFmpeg error | Classify + return 500 | Use `FFmpegService.classifyFfmpegError()` logic |
| Whisper error | Return 500 with context | `{ "error": "Transcription failed: ..." }` |
| R2 error | Retry 3x + return 500 | `{ "error": "Storage error, please retry" }` |
| Database error | Return 500 + alert | `{ "error": "Internal error" }` |
| Stripe error | Log + return 500 | `{ "error": "Payment error" }` |

---

# 6. DATA MIGRATION STRATEGY (For Existing Electron Users)

## When a user migrates from Electron to Web:

```
1. User opens web app → "Import from Desktop" option
2. User selects local .ecp project file
3. Web app reads .ecp JSON (same schema)
4. For each media reference in the project:
   a. Prompt user to upload local media files
   b. Upload to R2 via presigned URL
   c. Replace local paths with CDN URLs in project state
5. Save migrated project to web backend
6. Project is now available in web editor
```

### .ecp Format Compatibility:
```
The .ecp JSON format is ALREADY the same shape as the web project state.
The ONLY field that changes: clip.path → clip.url, audioTrack.path → audioTrack.url

Migration script (run in browser):
  function migrateEcpToWeb(ecpJson: object, urlMap: Map<string, string>): object {
    return JSON.parse(JSON.stringify(ecpJson), (key, value) => {
      if (key === 'path' && typeof value === 'string') {
        return urlMap.get(value) || value;  // Replace local path with CDN URL
      }
      return value;
    });
  }
```

---

# 7. OFFLINE SUPPORT (PWA)

## Service Worker Strategy:
```
Cache-first for static assets:
  - JS bundles, CSS, fonts → Cache indefinitely
  - SFX files → Cache indefinitely

Network-first for API:
  - Project state → Try network, fall back to IndexedDB cache
  - Media metadata → Try network, fall back to IndexedDB cache

Not cacheable:
  - Video/audio streams (too large, use CDN caching)
  - Export output (download directly)
```

## IndexedDB Local Cache:
```
Tables:
  - projects: Full project state (for offline editing)
  - media-metadata: Media info (without actual media files)
  - thumbnails: Blob URLs for cached thumbnails

Sync on reconnect:
  - Push local changes to server
  - Pull server changes to local
  - Resolve conflicts (server wins for autosave, merge for edits)
```
