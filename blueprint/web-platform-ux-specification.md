# Capcraft Web Platform — UX & Responsive Design Specification
## Blueprint v3 Supplement: Layout Adaptations, Onboarding, Interaction Patterns

> **STATUS: PLANNING ONLY — NO CODE CHANGES**

---

# 1. RESPONSIVE LAYOUT BREAKPOINTS

## 1.1 Breakpoint Definitions

| Breakpoint | Width | Target | Layout |
|---|---|---|---|
| `mobile` | < 768px | Phone | Simplified single-column, bottom sheet panels |
| `tablet-portrait` | 768-1023px | iPad portrait | 2-column, collapsible side panels |
| `tablet-landscape` | 1024-1279px | iPad landscape | Full editor (compact) |
| `desktop` | 1280-1919px | Laptop/desktop | Full editor (current layout) |
| `desktop-wide` | 1920px+ | Large monitor | Full editor with extra padding |

## 1.2 Layout Per Breakpoint

### Desktop (1280px+) — CURRENT LAYOUT (unchanged)
```
┌──────┬────────┬──────────────────────┬──────────┬──────┐
│Left  │ Media  │                      │Inspector │Right │
│Rail  │ Panel  │      Preview         │          │Rail  │
│64px  │ 18%    │       (flex)         │  20%     │64px  │
├──────┴────────┴──────────────────────┴──────────┴──────┤
│                    Timeline 25%                         │
└────────────────────────────────────────────────────────┘
Toolbar: 38px fixed at top
```
- LeftRail: 64px, always visible
- RightRail: 64px, always visible
- MediaPanel: 18% width (160px min, 30% max)
- Inspector: 20% width (200px min, 32% max)
- Timeline: 25% height (100px min, 45% max)
- All resize handles active

### Tablet Landscape (1024-1279px) — COMPACT EDITOR
```
┌─────┬────────┬──────────────────────┬──────────┐
│Left │ Media  │                      │Inspector │
│Rail │ Panel  │      Preview         │          │
│48px │ 16%    │       (flex)         │  22%     │
├─────┴────────┴──────────────────────┴──────────┤
│                  Timeline 28%                   │
└────────────────────────────────────────────────┘
Toolbar: 38px fixed at top
```
- LeftRail: 48px (icons only, no labels)
- RightRail: HIDDEN (inspector tabs move to Inspector header)
- MediaPanel: 16% width (140px min, 25% max)
- Inspector: 22% width (180px min, 30% max)
- Timeline: 28% height (slightly taller to compensate for narrower preview)
- All resize handles active

### Tablet Portrait (768-1023px) — FLEXIBLE EDITOR
```
┌─────┬──────────────────────────────┬──────────┐
│Left │                              │Inspector │
│Rail │         Preview              │ (toggle) │
│48px │          (flex)              │  240px   │
├─────┴──────────────────────────────┴──────────┤
│              Timeline 35%                      │
│         (expandable to 50%)                    │
└───────────────────────────────────────────────┘
Toolbar: 38px fixed at top
Media/Text/Audio: Bottom sheet (drag up from timeline)
```
- LeftRail: 48px, icons only
- RightRail: HIDDEN
- MediaPanel: Bottom sheet overlay (drag up, max 50% height)
- Inspector: Slide-in panel from right (240px, toggleable)
- Timeline: 35% height (120px min, 50% max)
- Preview: Takes full remaining width
- Resize handles: Timeline only (side panels are overlays)

### Mobile (< 768px) — SIMPLIFIED EDITOR
```
┌─────────────────────────────────────┐
│ Toolbar (compact, 44px)       [⋮]   │
├─────────────────────────────────────┤
│                                     │
│         Preview (55% height)        │
│                                     │
│    [▶] 00:00 ──────── 01:30         │
├─────────────────────────────────────┤
│ Timeline (compact, 80px collapsed)  │
│ ◀ ▶ pinch-zoom  [expand ▲]         │
├─────────────────────────────────────┤
│ Bottom Tab Bar                      │
│ [Media] [Text] [Audio] [CC] [⚙️]   │
└─────────────────────────────────────┘
```
- Toolbar: 44px (larger tap targets), compact (logo + 2 tools + export only)
- LeftRail/RightRail: HIDDEN
- Preview: 55% of screen height
- Timeline: 80px collapsed (just ruler + playhead), expand to 40% on tap
- Bottom Tab Bar: Replaces side panels entirely
- Media/Text/Audio/CC: Full-screen overlays from bottom tab
- Inspector: Accessed via gear icon ⚙️ → full-screen overlay
- No resize handles (everything is fixed or overlay)

## 1.3 Component Adaptations Per Breakpoint

### Toolbar
```
Desktop (1280px+):
  [CAPCRAFT] | [V][B][H][Z] | [↩][↪] | [CC ✦] [T] | [Export]
  Full tool labels, all buttons visible

Tablet (768-1279px):
  [CAPCRAFT] | [V][B][H][Z] | [↩][↪] | [CC ✦] [T] | [Export]
  Same as desktop but smaller padding

Mobile (< 768px):
  [CC] | [V][B] | [↩] | [⋮]
  [⋮] opens: [H][Z][↪][T][Export][Settings]
  Compact: only most-used tools visible, rest in overflow menu
```

### Timeline
```
Desktop:
  - Full ruler with dynamic intervals
  - Lane labels on left (Video 1, Audio 1, Captions)
  - Waveform display in audio lanes
  - Fade edge triangles with handles
  - Keyframe diamonds on selected clips
  - Transition icons at clip out-points
  - Context menus on right-click
  - Ctrl+wheel zoom, Shift+wheel pan

Tablet:
  - Same as desktop but smaller clip heights
  - Waveform display optional (toggle for performance)
  - Context menus as bottom sheet instead of popup

Mobile:
  - Simplified ruler (major ticks only)
  - No lane labels (icons only: 🎬 🎵 💬)
  - No waveform display (too small to be useful)
  - No fade edge triangles (use trim handles instead)
  - Pinch to zoom (replaces Ctrl+wheel)
  - Two-finger drag to pan (replaces Shift+wheel)
  - Long-press for context menu (as bottom sheet)
  - Double-tap clip to open inspector
```

### Inspector
```
Desktop:
  - Fixed right panel (20% width)
  - 6 sub-panels with tabs
  - All sliders visible with value labels
  - Color pickers as inline swatches

Tablet:
  - Slide-in panel (240px, toggleable)
  - Same sub-panels but narrower sliders
  - Color pickers as popup overlay

Mobile:
  - Full-screen overlay
  - Sub-panels as swipeable pages
  - Larger sliders (touch-friendly)
  - Color pickers as full-screen wheel
  - Section collapse/expand (don't show all at once)
```

### Preview
```
Desktop:
  - Aspect-ratio-correct video in center
  - Transform gizmo (8 handles + rotation)
  - Caption Canvas2D overlay
  - Click handle → move/rotate/scale

Tablet:
  - Same as desktop but smaller
  - Transform handles slightly larger (touch)

Mobile:
  - Video fills available width
  - No visible transform gizmo
  - Drag video directly to move
  - Pinch to scale
  - Two-finger rotate
  - Tap to select clip
```

---

# 2. ONBOARDING FLOW

## 2.1 First-Time User Experience

```
Step 1: Landing Page
  → Hero: "The browser video editor for caption-heavy content"
  → Demo video (30s showing: upload → auto-caption → karaoke style → export)
  → CTA: "Start Editing — Free" (no credit card)

Step 2: Signup
  → Email + password OR Google/GitHub OAuth
  → After signup: "What brings you here?" quick survey
    - [ ] Short-form video (TikTok/Reels/Shorts)
    - [ ] Podcast/video repurposing
    - [ ] Online course content
    - [ ] Social media management
    - [ ] Other

Step 3: Create First Project
  → Auto-create project with user's likely aspect ratio:
    - Short-form → 9:16 (1080×1920)
    - YouTube → 16:9 (1920×1080)
    - Instagram post → 1:1 (1080×1080)
  → Show empty editor with guided highlights

Step 4: Upload First Video
  → Highlighted drop zone: "Drag your video here or click to browse"
  → Show upload progress bar
  → When ready: "Drag it to the timeline" (arrow pointing to timeline)

Step 5: Auto-Transcribe
  → Highlighted CC ✦ button: "Generate captions automatically"
  → Show transcription progress
  → When done: Captions appear on preview + timeline

Step 6: Style Captions
  → Highlighted Inspector panel: "Choose a caption style"
  → Show 4 mode previews:
    - Full Phrase (classic subtitles)
    - Word Reveal (words appear one by one)
    - Karaoke (active word highlighted) ← recommended for short-form
    - Single Word (one word at a time)
  → User clicks mode → preview updates in real-time

Step 7: Export
  → Highlighted Export button: "Export your video"
  → Pre-selected preset based on project aspect ratio
  → Show estimated render time
  → Export completes → toast notification → download link

Step 8: Completion
  → "Your first video is ready! 🎉"
  → Share options: Download, Share Link, Share to Social
  → "Want to learn more? Check out these tips:"
    - [ ] Keyboard shortcuts (?)
    - [ ] Advanced caption styling
    - [ ] Multi-track editing
    - [ ] Keyframe animations
```

## 2.2 Returning User Dashboard

```
┌─────────────────────────────────────────────────────┐
│ CAPCRAFT                    [Search...]    [Avatar] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ [+ New Project]                                     │
│                                                     │
│ Recent Projects:                                    │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐               │
│ │thumb │ │thumb │ │thumb │ │thumb │               │
│ │      │ │      │ │      │ │      │               │
│ │Name  │ │Name  │ │Name  │ │Name  │               │
│ │Date  │ │Date  │ │Date  │ │Date  │               │
│ └──────┘ └──────┘ └──────┘ └──────┘               │
│                                                     │
│ Storage: 2.3 GB / 50 GB ━━━━━━━━━━━░░░░            │
│ Plan: Pro ━━━━━━━━━━━━━━━━━━━ [$12/mo]             │
│                                                     │
│ Quick Actions:                                      │
│ [Import Media] [Transcribe] [Export]                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

# 3. KEYBOARD SHORTCUT REFERENCE

## 3.1 Global Shortcuts (All Contexts)

| Shortcut | Action | Notes |
|---|---|---|
| `V` | Select tool | Timeline interaction mode |
| `B` | Blade tool | Click clip to split at playhead |
| `H` | Hand tool | Drag to pan timeline |
| `Z` | Zoom tool | Click to zoom in, Alt+click to zoom out |
| `Space` | Play / Pause | Toggle playback |
| `Ctrl+Z` | Undo | Max 20 levels |
| `Ctrl+Shift+Z` | Redo | |
| `Ctrl+C` | Copy selection | Clips + text clips |
| `Ctrl+X` | Cut selection | Copy + delete |
| `Ctrl+V` | Paste at playhead | |
| `Ctrl+A` | Select all | All clips on all tracks |
| `Ctrl+D` | Duplicate selection | |
| `Delete` / `Backspace` | Delete selection | With undo |
| `T` | Add text overlay | At playhead position |
| `Ctrl+E` | Open export dialog | |
| `?` | Open shortcuts dialog | |
| `Escape` | Deselect all / Exit fullscreen | |
| `F` | Toggle fullscreen preview | |
| `Ctrl+S` | Save project | Manual save (autosave runs every 30s) |
| `Ctrl+0` | Reset zoom to 100% | Timeline zoom |
| `Ctrl+=` / `Ctrl+-` | Zoom in / out | Timeline zoom |
| `Home` | Jump to start | Playhead to 0 |
| `End` | Jump to end | Playhead to totalDurationMs |
| `Left` / `Right` | Step 1 frame | At current FPS |
| `Shift+Left` / `Shift+Right` | Step 1 second | |
| `I` | Set in-point | Loop region start |
| `O` | Set out-point | Loop region end |
| `X` | Toggle loop | Enable/disable in-out loop |

## 3.2 Timeline-Specific Shortcuts

| Shortcut | Action |
|---|---|
| `↑` / `↓` | Move selected clip up/down one track |
| `[` | Trim clip start to playhead |
| `]` | Trim clip end to playhead |
| `Q` | Ripple delete selected clip |
| `J` | Set clip speed to 0.5x |
| `K` | Set clip speed to 1.0x |
| `L` | Set clip speed to 2.0x |
| `M` | Add marker at playhead |
| `Ctrl+M` | Mute selected track |
| `Ctrl+Shift+M` | Solo selected track |

---

# 4. CONTEXT MENU ITEMS

## 4.1 Timeline Ruler Context Menu
```
- Set In-Point
- Set Out-Point
- Clear In/Out Points
- ---
- Add Marker Here
- Delete Nearest Marker
- ---
- Fit Timeline to View
- Zoom to Selection
```

## 4.2 Clip Context Menu
```
- Split at Playhead (B)
- Duplicate (Ctrl+D)
- Delete (Del)
- Ripple Delete (Q)
- ---
- Copy (Ctrl+C)
- Cut (Ctrl+X)
- Paste (Ctrl+V)
- ---
- Speed >
    - 0.25x
    - 0.5x (J)
    - 1.0x (K)
    - 1.5x
    - 2.0x (L)
    - 4.0x
    - Custom...
- ---
- Move to Track >
    - Video 1
    - Video 2
    - Overlay 1
    - ...
- ---
- Transform >
    - Reset Position
    - Reset Scale
    - Reset All
- ---
- Clip Properties...
```

## 4.3 Audio Track Context Menu
```
- Mute (Ctrl+M)
- Solo (Ctrl+Shift+M)
- ---
- Role >
    - 🎤 Voice
    - 🎵 Music
    - 🔊 SFX
    - 🌧 Ambient
- ---
- Extract Audio as Separate Track
- Delete Track
```

## 4.4 Caption Context Menu
```
- Edit Text
- Split Caption Here
- Merge with Previous
- Merge with Next
- ---
- Delete Caption
- Delete All Captions on Track
- ---
- Apply Style to All
- Apply Preset to All
- ---
- Transcribe This Clip
- Transcribe Full Timeline
```

## 4.5 Empty Timeline Area Context Menu
```
- Paste (Ctrl+V)
- ---
- Add Text Here
- Add Audio Track
- ---
- Fit to View
- Zoom 100%
```

---

# 5. TOAST NOTIFICATION MESSAGES

| Event | Type | Message | Duration |
|---|---|---|---|
| Export completed | success | "Export job completed" | 5s |
| Export failed | error | "Export failed: {error}" | 8s |
| Transcription completed | success | "Captions generated: {count} entries" | 5s |
| Transcription failed | error | "Transcription failed: {error}" | 8s |
| Project saved | success | "Project saved" | 2s |
| Media imported | success | "Media imported: {filename}" | 3s |
| Storage limit warning | warning | "Storage 90% full. Consider upgrading." | 8s |
| Export limit warning | warning | "Export minutes limit reached this month." | 8s |
| Connection lost | error | "Connection lost. Reconnecting..." | until reconnected |
| Autosave failed | warning | "Autosave failed. Changes may be lost." | 8s |
| Clip copied | success | "Copied {count} clips" | 2s |
| No clips to paste | warning | "Clipboard is empty" | 3s |
| No clip selected | warning | "Select a clip first" | 3s |
| Add video first | warning | "Add a video clip to the timeline first." | 3s |

---

# 6. EMPTY STATES

## 6.1 Empty Project (No Media)
```
Preview: Dark canvas with centered text
  "Upload a video to get started"
  [Upload Video] button

Timeline: Empty lanes with dashed borders
  "Drag media here or click + to import"

Media Panel: Empty grid
  "No media yet"
  "Drag & drop files here or click to browse"
  [Browse Files] button
```

## 6.2 No Captions
```
Caption Lane: Empty
  "No captions. Click CC ✦ to auto-generate."

Caption Editor: Empty
  "Select a clip and click CC ✦ to transcribe"
```

## 6.3 No Export History
```
Export Dialog: 
  "Configure your export settings and click Start"
```

## 6.4 Search: No Results
```
Media Panel:
  "No media matches '{query}'"
  [Clear Search] button
```
