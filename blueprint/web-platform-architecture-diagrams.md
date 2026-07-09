# Capcraft Web Platform — Architecture Diagrams
## Blueprint v3 Supplement: Visual System Architecture

> **STATUS: PLANNING ONLY — NO CODE CHANGES**
> Mermaid diagrams for system architecture, data flows, and infrastructure.

---

# 1. CURRENT ELECTRON ARCHITECTURE

```mermaid
graph TB
    subgraph Electron Main Process
        FFmpegService[FFmpegService<br/>947 lines<br/>spawn ffmpeg.exe]
        WhisperService[WhisperService<br/>spawn whisper-cli.exe]
        ExportQueue[ExportQueue<br/>1 concurrent job]
        MediaService[MediaService<br/>file copy, probe, thumb]
        IPCRouter[IPC Router<br/>25 channels]
    end

    subgraph Electron Renderer Process
        page[page.tsx<br/>571 lines<br/>4-column layout]
        
        subgraph Components 22 total
            Preview[Preview<br/>1701 lines<br/>video + Canvas2D captions]
            Timeline[Timeline<br/>1107 lines<br/>Canvas2D + InteractionMachine]
            Inspector[Inspector<br/>1040 lines<br/>6 sub-panels]
            MediaPanel[MediaPanel]
            ExportDialog[ExportDialog]
            Other15[15 other components]
        end

        subgraph Zustand Stores 10 total
            useTimeline[useTimeline<br/>1513 lines<br/>50+ actions]
            useCaption[useCaption<br/>653 lines<br/>4 transcription modes]
            useExport[useExport<br/>257 lines<br/>9 presets, 4 codecs]
            useProject[useProject<br/>188 lines]
            useMediaLibrary[useMediaLibrary<br/>202 lines]
            Other5[5 other stores]
        end

        subgraph Renderer Services
            AudioEngine[AudioEngine<br/>465 lines<br/>Web Audio API<br/>512MB LRU cache]
            WaveformService[WaveformService]
            NotifSound[NotificationSound]
        end

        subgraph Shared
            Effects[Effects System<br/>16 files<br/>Registry + Engine pattern]
            Utils[Utils<br/>easing, color, srt,<br/>caption-layout]
        end
    end

    subgraph Local File System
        ProjectFiles[.ecp project files]
        MediaFiles[Video/Audio files]
        FontFiles[assets/fonts/*.ttf]
        SfxFiles[assets/sfx/*.mp3]
    end

    page --> Preview
    page --> Timeline
    page --> Inspector
    page --> MediaPanel
    page --> ExportDialog

    Preview --> useTimeline
    Preview --> useCaption
    Preview --> AudioEngine
    Timeline --> useTimeline
    Inspector --> useTimeline
    Inspector --> useCaption
    ExportDialog --> useExport

    useTimeline --> IPCRouter
    useCaption --> IPCRouter
    useExport --> IPCRouter
    useProject --> IPCRouter
    useMediaLibrary --> IPCRouter

    IPCRouter --> FFmpegService
    IPCRouter --> WhisperService
    IPCRouter --> ExportQueue
    IPCRouter --> MediaService

    FFmpegService --> MediaFiles
    MediaService --> MediaFiles
    MediaService --> ProjectFiles

    AudioEngine --> MediaFiles
    Preview --> MediaFiles
```

---

# 2. TARGET WEB ARCHITECTURE

```mermaid
graph TB
    subgraph Browser
        subgraph Next.js App - CSR
            page[page.tsx<br/>layout + toolbar]
            
            subgraph Components - Same 22
                Preview[Preview<br/>clip.url instead of toFileUrl]
                Timeline[Timeline<br/>unchanged Canvas2D]
                Inspector[Inspector<br/>unchanged React forms]
                MediaPanel[MediaPanel<br/>presigned upload]
                ExportDialog[ExportDialog<br/>REST + WebSocket]
            end

            subgraph Zustand Stores - Same 10
                useTimeline[useTimeline<br/>url field instead of path]
                useCaption[useCaption<br/>REST instead of IPC]
                useExport[useExport<br/>REST instead of IPC]
                useProject[useProject<br/>REST instead of IPC]
                useMediaLibrary[useMediaLibrary<br/>CDN URLs]
            end

            subgraph Services
                AudioEngine[AudioEngine<br/>http fetch only<br/>already supports URLs]
                SocketClient[Socket.io Client<br/>replaces IPC listeners]
                ApiClient[API Client<br/>fetch wrapper + JWT]
                UploadClient[Upload Client<br/>R2 presigned POST]
            end

            subgraph Web Workers
                FFmpegWorker[FFmpeg WASM<br/>thumbnails]
                WaveformWorker[Waveform extraction<br/>Web Audio API]
            end
        end
    end

    subgraph Cloudflare
        CDN[Cloudflare CDN<br/>global edge caching]
        R2[(R2 Storage<br/>zero egress fees<br/>media + exports + thumbs)]
    end

    subgraph API Server - Hono on Node.js
        AuthAPI[Auth Routes<br/>signup, login, JWT]
        ProjectAPI[Project Routes<br/>CRUD, save, load, autosave]
        MediaAPI[Media Routes<br/>upload init, probe, complete]
        ExportAPI[Export Routes<br/>start, cancel, status]
        TranscribeAPI[Transcribe Routes<br/>start, cancel, result]
        BillingAPI[Billing Routes<br/>usage, subscribe]
        WSHandler[WebSocket Handler<br/>progress events]
    end

    subgraph Database
        PostgreSQL[(PostgreSQL<br/>via Supabase<br/>users, projects, media,<br/>export_jobs, transcription_jobs)]
        Redis[(Redis<br/>via Upstash<br/>BullMQ queues)]
    end

    subgraph Workers
        BullMQ[BullMQ Queue Manager]
        ExportWorker[Export Worker<br/>FFmpeg GPU NVENC<br/>same CRF policy]
        TranscribeWorker[Transcribe Worker<br/>faster-whisper GPU]
        MediaWorker[Media Worker<br/>probe, thumbnail, waveform]
    end

    subgraph External
        Stripe[Stripe<br/>billing + webhooks]
        SupabaseAuth[Supabase Auth<br/>email + OAuth]
    end

    page --> Preview
    page --> Timeline
    page --> Inspector

    Preview --> useTimeline
    Preview --> AudioEngine
    Timeline --> useTimeline
    Inspector --> useCaption

    useCaption --> ApiClient
    useExport --> ApiClient
    useProject --> ApiClient
    useMediaLibrary --> UploadClient

    ApiClient --> AuthAPI
    ApiClient --> ProjectAPI
    ApiClient --> MediaAPI
    ApiClient --> ExportAPI
    ApiClient --> TranscribeAPI

    WSHandler --> SocketClient

    MediaAPI --> R2
    MediaAPI --> BullMQ
    ExportAPI --> BullMQ
    TranscribeAPI --> BullMQ

    BullMQ --> ExportWorker
    BullMQ --> TranscribeWorker
    BullMQ --> MediaWorker

    ExportWorker --> R2
    TranscribeWorker --> PostgreSQL
    MediaWorker --> R2

    ProjectAPI --> PostgreSQL
    AuthAPI --> SupabaseAuth
    BillingAPI --> Stripe

    CDN --> R2
    Preview --> CDN
    AudioEngine --> CDN
```

---

# 3. DATA FLOW: MEDIA UPLOAD

```mermaid
graph LR
    User[User] -->|drag file| MediaPanel[MediaPanel]
    MediaPanel -->|POST /api/media/upload/initiate| MediaAPI[Media API]
    MediaAPI -->|generate presigned URL| R2[R2 Storage]
    MediaAPI -->|presigned POST| MediaPanel
    MediaPanel -->|direct upload| R2
    MediaPanel -->|POST /api/media/upload/complete| MediaAPI
    MediaAPI -->|queue probe job| BullMQ[BullMQ]
    BullMQ -->|pick up| MediaWorker[Media Worker]
    MediaWorker -->|ffprobe| R2
    MediaWorker -->|generate thumbnail| R2
    MediaWorker -->|extract waveform| R2
    MediaWorker -->|update metadata| PostgreSQL[(PostgreSQL)]
    MediaWorker -->|WebSocket media:ready| SocketClient[Socket Client]
    SocketClient -->|add to store| useMediaLibrary[useMediaLibrary]
    useMediaLibrary -->|render thumbnail from CDN| MediaPanel
```

---

# 4. DATA FLOW: EXPORT

```mermaid
graph LR
    User[User] -->|click Export| ExportDialog[ExportDialog]
    ExportDialog -->|configure preset/codec| useExport[useExport]
    User -->|click Start| ExportDialog
    ExportDialog -->|POST /api/export/start| ExportAPI[Export API]
    ExportAPI -->|validate + create job| PostgreSQL[(PostgreSQL)]
    ExportAPI -->|queue export job| BullMQ[BullMQ]
    BullMQ -->|pick up| ExportWorker[Export Worker<br/>GPU NVENC]
    ExportWorker -->|download sources| R2[(R2 Storage)]
    ExportWorker -->|FFmpeg render<br/>same CRF policy| TempStore[Temp Storage]
    ExportWorker -->|upload output| R2
    ExportWorker -->|WebSocket export:progress| SocketClient[Socket Client]
    SocketClient -->|update progress| useExport
    ExportWorker -->|update job status| PostgreSQL
    User -->|click Download| ExportDialog
    ExportDialog -->|GET /api/export/:id/download| ExportAPI
    ExportAPI -->|presigned URL| R2
    User -->|download| R2
```

---

# 5. DATA FLOW: TRANSCRIPTION

```mermaid
graph LR
    User[User] -->|click CC button| page[page.tsx]
    page -->|transcribeClip| useCaption[useCaption]
    useCaption -->|POST /api/transcribe/start| TranscribeAPI[Transcribe API]
    TranscribeAPI -->|create job| PostgreSQL[(PostgreSQL)]
    TranscribeAPI -->|queue job| BullMQ[BullMQ]
    BullMQ -->|pick up| TranscribeWorker[Transcribe Worker<br/>faster-whisper GPU]
    TranscribeWorker -->|download audio| R2[(R2 Storage)]
    TranscribeWorker -->|transcribe| TranscribeWorker
    TranscribeWorker -->|WebSocket transcribe:progress| SocketClient[Socket Client]
    SocketClient -->|update progress| useCaption
    TranscribeWorker -->|store result| PostgreSQL
    TranscribeWorker -->|WebSocket transcribe:result| SocketClient
    SocketClient -->|map to TextClip| useCaption
    useCaption -->|addTextClip| useTimeline[useTimeline]
    useTimeline -->|render captions| Preview[Preview<br/>Canvas2D]
```

---

# 6. INFRASTRUCTURE DEPLOYMENT DIAGRAM

```mermaid
graph TB
    subgraph Client Devices
        Browser[Web Browser<br/>Chrome/Edge/Firefox]
        TauriApp[Tauri Desktop<br/>Windows/Mac/Linux]
        MobileApp[Capacitor Mobile<br/>iOS/Android]
    end

    subgraph Cloudflare Edge
        DNS[Cloudflare DNS]
        WAF[WAF + DDoS Protection]
        CDNEdge[CDN Edge<br/>190+ locations]
        Workers[Cloudflare Workers<br/>edge functions optional]
    end

    subgraph Primary Region
        LB[Load Balancer]
        
        subgraph Application Layer
            NextServer1[Next.js Server 1<br/>SSR + API]
            NextServer2[Next.js Server 2<br/>SSR + API]
        end

        subgraph WebSocket Layer
            SocketServer1[Socket.io Server 1]
            SocketServer2[Socket.io Server 2]
        end

        subgraph Worker Layer
            ExportW1[Export Worker 1<br/>GPU NVENC]
            ExportW2[Export Worker 2<br/>GPU NVENC]
            TranscribeW1[Transcribe Worker 1<br/>GPU]
            MediaW1[Media Worker 1<br/>CPU]
        end

        subgraph Data Layer
            PrimaryDB[(PostgreSQL Primary<br/>Supabase)]
            ReplicaDB[(PostgreSQL Replica<br/>read-only)]
            RedisNode[Redis<br/>Upstash]
            R2Bucket[(R2 Storage<br/>media + exports)]
        end
    end

    subgraph External Services
        StripeExt[Stripe]
        SupabaseAuthExt[Supabase Auth]
    end

    Browser --> DNS
    TauriApp --> DNS
    MobileApp --> DNS
    DNS --> WAF
    WAF --> CDNEdge
    CDNEdge --> LB
    LB --> NextServer1
    LB --> NextServer2
    LB --> SocketServer1
    LB --> SocketServer2

    NextServer1 --> PrimaryDB
    NextServer1 --> RedisNode
    NextServer2 --> PrimaryDB
    NextServer2 --> RedisNode

    SocketServer1 --> RedisNode
    SocketServer2 --> RedisNode

    RedisNode --> ExportW1
    RedisNode --> ExportW2
    RedisNode --> TranscribeW1
    RedisNode --> MediaW1

    ExportW1 --> R2Bucket
    ExportW2 --> R2Bucket
    TranscribeW1 --> PrimaryDB
    MediaW1 --> R2Bucket

    PrimaryDB --> ReplicaDB
    CDNEdge --> R2Bucket

    NextServer1 --> StripeExt
    NextServer1 --> SupabaseAuthExt
```

---

# 7. CROSS-PLATFORM ARCHITECTURE

```mermaid
graph TB
    subgraph Shared Codebase
        ReactApp[React 19 App<br/>All 22 components<br/>All 10 stores<br/>All services]
        SharedUtils[Shared Utilities<br/>effects, easing, srt,<br/>caption-layout, color]
    end

    subgraph Web Platform
        NextJS[Next.js 15<br/>App Router]
        HonoAPI[Hono API Server]
        WebDeploy[Vercel / VPS]
    end

    subgraph Desktop Platform
        Tauri[Tauri 2.0<br/>Rust backend]
        TauriFS[Local File System<br/>offline media cache]
        TauriFFmpeg[Local FFmpeg<br/>offline export]
        TauriWhisper[Local Whisper<br/>offline transcription]
        DesktopDeploy[.msi / .dmg / .AppImage]
    end

    subgraph Mobile Platform
        Capacitor[Capacitor<br/>Native WebView]
        NativePlugins[Native Plugins<br/>camera, mic, share,<br/>filesystem, push]
        MobileDeploy[App Store / Google Play]
    end

    ReactApp --> NextJS
    ReactApp --> Tauri
    ReactApp --> Capacitor

    SharedUtils --> ReactApp

    NextJS --> HonoAPI
    NextJS --> WebDeploy

    Tauri --> TauriFS
    Tauri --> TauriFFmpeg
    Tauri --> TauriWhisper
    Tauri --> DesktopDeploy

    Capacitor --> NativePlugins
    Capacitor --> MobileDeploy

    Tauri -.->|same API| HonoAPI
    Capacitor -.->|same API| HonoAPI
```

---

# 8. STATE MANAGEMENT FLOW

```mermaid
graph LR
    subgraph User Actions
        Click[Click/Drag]
        Type[Type]
        Upload[Upload File]
    end

    subgraph React Components
        Timeline[Timeline Canvas]
        Inspector[Inspector Panel]
        Preview[Preview Player]
        MediaPanel[Media Panel]
    end

    subgraph Zustand Stores
        TL[useTimeline<br/>clips, tracks, selection<br/>playhead, undo stack]
        CAP[useCaption<br/>activeStyle, entries<br/>transcription status]
        EXP[useExport<br/>preset, codec, queue]
        PRJ[useProject<br/>width, height, fps<br/>backgroundColor]
        MED[useMediaLibrary<br/>media items, thumbnails<br/>search, selection]
    end

    subgraph Side Effects
        API[REST API<br/>fetch wrapper]
        WS[Socket.io<br/>WebSocket]
        AE[AudioEngine<br/>Web Audio API]
        CV[Canvas2D<br/>caption render]
        VID[video element<br/>HTML5 playback]
    end

    Click --> Timeline
    Click --> Inspector
    Upload --> MediaPanel

    Timeline --> TL
    Inspector --> TL
    Inspector --> CAP
    MediaPanel --> MED
    Preview --> EXP

    TL --> API
    CAP --> API
    EXP --> API
    PRJ --> API
    MED --> API

    API --> WS
    WS --> EXP
    WS --> CAP

    TL --> AE
    TL --> CV
    TL --> VID
```
