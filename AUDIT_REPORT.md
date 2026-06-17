# CAPCRAFT vs CAPCUT DESKTOP — FULL FEATURE GAP AUDIT

---

## EXECUTIVE SUMMARY

**CapCut Parity Score: 28 / 100**

**Editor Maturity: Late Alpha / Early Beta**

CapCraft has a solid skeleton: Electron shell, Zustand state, Canvas timeline, basic caption pipeline, and export. However, it is missing large swaths of functionality that CapCut ships by default. Multi-select, clipboard, snapping intelligence, effects, transitions, keyframes, audio waveform editing, and most interaction patterns expected by even casual editors are NOT IMPLEMENTED.

**Major Blockers:**
1. No multi-select anywhere (timeline, canvas, layers)
2. No clipboard (Ctrl+C / Ctrl+V / Ctrl+X all disabled)
3. No Ctrl+D shortcut (duplicate exists but not wired to hotkey)
4. No snapping to playhead, audio edges, or caption edges — only video clip edges
5. No effects / transitions / filters / keyframes
6. Video transform drag has no undo snapshot (canvas gizmo never calls beginDragCapture/commitDrag)
7. Timeline only renders single clip at playhead time — no multi-clip compositing
8. No audio waveform visualization
9. Speed ramping changes `clip.speed` but playback engine ignores it
10. 8 of 11 Left Rail tabs are ComingSoonPanel placeholders

---

## FEATURE GAP REPORT

### 1. MULTI-SELECT (Timeline)

**Feature:** Multi-select clips on timeline (Shift+click, Ctrl+click, box/lasso)
**Current Status:** NOT IMPLEMENTED — `selectedClipId: string | null` is singular. No `selectedClipIds` array exists in state.
**CapCut Status:** Full multi-select with Shift, Ctrl, box select, Select All (Ctrl+A)
**Gap Severity:** CRITICAL — prevents batch operations
**Files:** `src/renderer/store/useTimeline.ts` (L129), `src/renderer/components/Timeline/index.tsx`
**Root Cause:** State model only supports single selection
**Recommended Fix:** Add `selectedClipIds: string[]` to TimelineState, add `toggleClipSelection`, `rangeSelectClip`, `selectAll`, `deselectAll` actions. Update all hit-test paths.

---

### 2. CLIPBOARD (Copy / Paste / Cut)

**Feature:** Ctrl+C, Ctrl+V, Ctrl+X for clips and captions
**Current Status:** NOT IMPLEMENTED — Context menu items show `disabled: true`. No clipboard state exists.
**CapCut Status:** Full clipboard with cross-track paste, paste-at-playhead
**Gap Severity:** CRITICAL — most basic editing workflow
**Files:** `src/renderer/components/Timeline/index.tsx` (L918-920), `src/renderer/components/HotkeyManager.tsx`
**Root Cause:** No clipboard buffer in any store
**Recommended Fix:** Add `clipboard` state to useTimeline or a new `useClipboard` store. Wire Ctrl+C/V/X in HotkeyManager.

---

### 3. CTRL+D DUPLICATE SHORTCUT

**Feature:** Ctrl+D to duplicate selected clip
**Current Status:** NOT IMPLEMENTED — `duplicateClip()` exists in store but has no hotkey binding.
**CapCut Status:** Ctrl+D duplicates selected clip(s) at offset
**Gap Severity:** HIGH — power-user expectation
**Files:** `src/renderer/components/HotkeyManager.tsx`
**Recommended Fix:** Add `Ctrl+D` handler in HotkeyManager that calls `duplicateClip(selectedClipId)`.

---

### 4. SELECT ALL (Ctrl+A)

**Feature:** Select all clips on timeline
**Current Status:** NOT IMPLEMENTED
**CapCut Status:** Ctrl+A selects all clips on active track (or all tracks)
**Gap Severity:** HIGH
**Files:** HotkeyManager, useTimeline
**Recommended Fix:** Wire Ctrl+A → selectAll action.

---

### 5. TIMELINE SNAPPING — PLAYHEAD & CROSS-TYPE

**Feature:** Snap to playhead, snap audio-to-video edges, snap caption-to-clip edges
**Current Status:** PARTIALLY IMPLEMENTED — `snapToEdge()` only considers video clip start/end edges and timeline origin. Does NOT snap to: playhead position, audio track edges, caption edges, or marker positions.
**CapCut Status:** Smart snap to all edge types + playhead + markers + guides
**Gap Severity:** HIGH — critical for precision editing
**Files:** `src/renderer/components/Timeline/index.tsx` (L311-328)
**Root Cause:** `snapToEdge` iterates only `clips` array
**Recommended Fix:** Extend snap candidates to include audio track edges, text clip edges, playhead, and markers.

---

### 6. VIDEO TRANSFORM UNDO

**Feature:** Undo for video clip transform drag (move/scale/rotate via canvas gizmo)
**Current Status:** BROKEN — `handleTransformMouseDown` in Preview/index.tsx never calls `beginDragCapture()`. The window mousemove handler calls `setClipTransform` (which does NOT push undo) but there is no `commitDrag()` on mouseup. Undo stack is never populated for transform drags.
**CapCut Status:** Full undo/redo on all transform operations
**Gap Severity:** HIGH — user cannot undo transform changes
**Files:** `src/renderer/components/Preview/index.tsx` (L312-435)
**Root Cause:** Missing `beginDragCapture()` on mousedown, `commitDrag()` on mouseup
**Recommended Fix:** Add `beginDragCapture()` in `handleTransformMouseDown`, `commitDrag()` in the mouseup handler.

---

### 7. MULTI-CLIP VIDEO COMPOSITING

**Feature:** Render multiple overlapping video clips simultaneously
**Current Status:** NOT IMPLEMENTED — Preview only finds ONE clip at playhead time via `findClipAt()`. No compositing/layering of video frames.
**CapCut Status:** Full multi-layer compositing with z-order
**Gap Severity:** CRITICAL for professional editing — overlay/PIP workflows broken
**Files:** `src/renderer/components/Preview/index.tsx` (L54-57, L76-108)
**Root Cause:** Single `<video>` element, single clip loaded at a time
**Recommended Fix:** Use multiple `<video>` elements or Canvas compositing. Render all clips at current time in z-order.

---

### 8. SPEED RAMPING / PLAYBACK

**Feature:** Speed changes should affect playback
**Current Status:** PARTIALLY IMPLEMENTED — `setClipSpeed()` updates store, Inspector Speed tab works. But Preview's `clipTimeSec()` does NOT factor in `clip.speed`. Video plays at native 1× regardless.
**CapCut Status:** Speed changes alter playback rate and duration on timeline
**Gap Severity:** HIGH
**Files:** `src/renderer/components/Preview/index.tsx` (L60-64), `src/renderer/store/useTimeline.ts`
**Recommended Fix:** Apply `clip.speed` in `clipTimeSec()`: `(headMs - clip.startMs + clip.trimStart) / 1000 * clip.speed`. Also adjust `durationMs` when speed changes.

---

### 9. AUDIO WAVEFORM VISUALIZATION

**Feature:** Real audio waveform display on timeline
**Current Status:** NOT IMPLEMENTED — `drawAudioTrack()` renders fake waveform bars using `Math.sin()` pseudo-random heights. Not based on actual audio data.
**CapCut Status:** Real peak waveform from audio analysis
**Gap Severity:** MEDIUM — visual fidelity issue
**Files:** `src/renderer/components/Timeline/index.tsx` (L1147-1189)
**Recommended Fix:** Use Web Audio API `OfflineAudioContext` to extract peaks, cache per-track, render real waveform.

---

### 10. FRAME-ACCURATE SEEKING

**Feature:** Arrow keys for frame step, Shift+arrow for multi-frame
**Current Status:** NOT IMPLEMENTED — No left/right arrow handlers. J/K/L skip 5s which is far too coarse for editing.
**CapCut Status:** Left/Right = 1 frame, Shift+Left/Right = 1 second
**Gap Severity:** HIGH — precision editing impossible
**Files:** HotkeyManager
**Recommended Fix:** Add arrow key handlers using `1000 / fps` for frame step.

---

### 11. EFFECTS / TRANSITIONS / FILTERS

**Feature:** Visual effects, transitions between clips, color filters
**Current Status:** NOT IMPLEMENTED — Left rail tabs show ComingSoonPanel. No effect graph, no keyframe system.
**CapCut Status:** Hundreds of effects, drag-to-apply transitions, filter presets
**Gap Severity:** CRITICAL for CapCut parity
**Files:** `src/renderer/app/page.tsx` (L406-409)
**Recommended Fix:** Build effect pipeline (CSS filters for MVP, WebGL for production). Add keyframe system.

---

### 12. KEYFRAME ANIMATION

**Feature:** Keyframe-based property animation (position, scale, opacity, rotation)
**Current Status:** NOT IMPLEMENTED — No keyframe data model, no interpolation engine
**CapCut Status:** Full keyframe editor with bezier curves
**Gap Severity:** CRITICAL for motion graphics
**Files:** New store + component needed
**Recommended Fix:** Add `Keyframe` interface, interpolation engine, keyframe editor UI.

---

### 13. TEXT ROTATION & SCALE ON CANVAS

**Feature:** Rotate/scale text clips via TransformOverlay handles
**Current Status:** NOT IMPLEMENTED — Text clip Transform overlay shows corner handles with resize cursors but `handleTextClipMouseDown` only supports drag (move). No rotation or scale interaction.
**CapCut Status:** Full rotate/scale on text objects
**Gap Severity:** HIGH
**Files:** `src/renderer/components/Preview/TransformOverlay.tsx` (L73-119)
**Root Cause:** Text clips use `CaptionStyle` (x/y percentages) not `ClipTransform` (which has rotation/scale)
**Recommended Fix:** Extend `CaptionStyle` with rotation + scale, or add `transform` to TextClip. Wire handle interactions.

---

### 14. TIMELINE ZOOM TO CURSOR

**Feature:** Ctrl+Scroll zoom should center on mouse cursor position
**Current Status:** PARTIALLY IMPLEMENTED — Ctrl+Scroll changes zoom level but does NOT preserve the time position under the cursor. Zoom always centers on left edge.
**CapCut Status:** Zoom centers on cursor position
**Gap Severity:** MEDIUM — UX quality issue
**Files:** `src/renderer/components/Timeline/index.tsx` (L299-307)
**Recommended Fix:** Calculate time at mouse X before zoom, adjust scrollLeft to keep same time under cursor after zoom.

---

### 15. TRACK REORDERING

**Feature:** Drag track headers to reorder
**Current Status:** NOT IMPLEMENTED — Tracks are added/deleted but cannot be reordered.
**CapCut Status:** Drag to reorder tracks vertically
**Gap Severity:** MEDIUM
**Files:** Timeline track headers (L716-825)
**Recommended Fix:** Add drag-and-drop on track header sidebar.

---

### 16. AUDIO TRACK DRAG ON TIMELINE

**Feature:** Drag audio tracks horizontally to reposition
**Current Status:** PARTIALLY IMPLEMENTED — `moveAudioTrack()` exists. Drop handler moves audio. But there's NO mousedown-based drag for audio tracks (only video clips have drag-to-move in `handleMouseDown`). Audio can only be moved via HTML5 drag-drop (data transfer), not click-and-drag.
**CapCut Status:** Click and drag audio clips freely
**Gap Severity:** MEDIUM
**Files:** `src/renderer/components/Timeline/index.tsx` (handleMouseDown — no audio hit-test)
**Recommended Fix:** Add audio track hit-test in handleMouseDown, wire drag with snap.

---

### 17. CAPTION DRAG ON TIMELINE

**Feature:** Drag caption blocks to reposition on timeline
**Current Status:** NOT IMPLEMENTED — Caption mousedown only handles trim (near edges). Body click selects but does NOT start a drag-to-move operation.
**CapCut Status:** Drag captions freely on timeline
**Gap Severity:** HIGH
**Files:** `src/renderer/components/Timeline/index.tsx` (L391-446)
**Recommended Fix:** Add drag-to-move handler for caption body (between trim edges).

---

### 18. ALIGNMENT GUIDES / SMART GUIDES

**Feature:** Visual guides when objects align (center, edges)
**Current Status:** NOT IMPLEMENTED — No alignment detection or guide rendering
**CapCut Status:** Smart guides appear on alignment
**Gap Severity:** MEDIUM
**Files:** Preview canvas rendering
**Recommended Fix:** Add alignment detection in transform drag, render guide lines on canvas.

---

### 19. VOLUME SLIDER WIRING

**Feature:** Master volume control in PlaybackControls
**Current Status:** NOT WIRED — Volume slider in PlaybackControls uses `defaultValue={80}` with no onChange handler. It's a dead HTML range input.
**CapCut Status:** Master volume controls audio output
**Gap Severity:** LOW-MEDIUM
**Files:** `src/renderer/components/Preview/PlaybackControls.tsx` (L116-124)
**Recommended Fix:** Wire to a master volume state or the audio graph.

---

### 20. IN/OUT POINT TRIMMING

**Feature:** I/O keys to set trim range
**Current Status:** NOT IMPLEMENTED — HotkeyManager has TODO comments: `// TODO: implement in/out point trimming`
**CapCut Status:** I/O set in/out points for source and timeline
**Gap Severity:** MEDIUM
**Files:** `src/renderer/components/HotkeyManager.tsx` (L205-214)
**Recommended Fix:** Implement in/out point state and trim-to-range action.

---

## TIMELINE AUDIT

| # | Issue | Severity | Evidence |
|---|-------|----------|----------|
| T1 | Single select only — `selectedClipId: string \| null` | CRITICAL | useTimeline.ts L129 |
| T2 | No clipboard — Cut/Copy/Paste all `disabled: true` | CRITICAL | Timeline L918-920 |
| T3 | No Ctrl+D hotkey for duplicate | HIGH | HotkeyManager has no Ctrl+D handler |
| T4 | No Ctrl+A select all | HIGH | Not in HotkeyManager |
| T5 | Snap only to video clip edges — ignores audio, captions, playhead, markers | HIGH | Timeline snapToEdge L311-328 |
| T6 | Caption blocks cannot be dragged to reposition | HIGH | Timeline handleMouseDown L391-446 — no body drag |
| T7 | Audio tracks cannot be click-dragged (only HTML5 drop) | MEDIUM | handleMouseDown has no audio hit-test |
| T8 | Zoom does not center on cursor | MEDIUM | handleWheel L299-307 |
| T9 | No frame-step (arrow keys) | HIGH | Not in HotkeyManager |
| T10 | I/O in/out points are TODO stubs | MEDIUM | HotkeyManager L205-214 |
| T11 | No ripple delete | MEDIUM | No ripple logic anywhere |
| T12 | No track reordering via drag | MEDIUM | No drag on track headers |
| T13 | No visual overlap indicator when clips stack | LOW | No collision detection |
| T14 | Playhead drag only works when not over a clip | LOW | Timeline L550-569 |
| T15 | Timeline canvas doesn't render thumbnail strips on clips | LOW | drawClip renders flat color + hash marks |

---

## MULTI-SELECT AUDIT

| # | Issue | Severity | Evidence |
|---|-------|----------|----------|
| MS1 | No `selectedClipIds` array in state — only singular `selectedClipId` | CRITICAL | useTimeline L129 |
| MS2 | No `selectedTextClipIds` array — only singular `selectedTextClipId` | CRITICAL | useTimeline L130 |
| MS3 | No Shift+click handler anywhere | CRITICAL | Timeline handleMouseDown L459 — `selectClip(clickedClip.id)` |
| MS4 | No Ctrl+click toggle handler | CRITICAL | Same as above |
| MS5 | No box/lasso select | CRITICAL | Not implemented |
| MS6 | No multi-clip drag | CRITICAL | dragRef stores single clipId |
| MS7 | No multi-clip delete | CRITICAL | Delete handler only deletes `selectedClipIdRef.current` |
| MS8 | No multi-object transform on canvas | HIGH | TransformOverlay renders single box |
| MS9 | Selection is mutually exclusive (clip vs text) — prevents mixed selection | HIGH | selectClip clears selectedTextClipId, selectTextClip clears selectedClipId |

---

## PREVIEW/CANVAS AUDIT

| # | Issue | Severity | Evidence |
|---|-------|----------|----------|
| P1 | Only renders ONE video clip at a time — no compositing | CRITICAL | Preview L54-57 findClipAt returns first match |
| P2 | Video transform drag has no undo (beginDragCapture missing) | HIGH | Preview L312-435 |
| P3 | Speed property ignored during playback | HIGH | clipTimeSec L60-64 doesn't use speed |
| P4 | No click-to-select on canvas for text clips | HIGH | Canvas pointerEvents only enabled when selectedClipId exists |
| P5 | TransformOverlay corner handles are visual only — no resize interaction | HIGH | TransformOverlay L171-186 — handles are decorative for text |
| P6 | No rotation handle for text clips | HIGH | TransformOverlay doesn't render rotation handle for text |
| P7 | No alignment guides | MEDIUM | Not implemented |
| P8 | Fake waveform in audio track rendering | MEDIUM | drawAudioTrack uses Math.sin for bars |
| P9 | Canvas has no click handler to select/deselect text clips on canvas | HIGH | Canvas onMouseDown only handles video transform |
| P10 | Video transform gizmo blocks caption interaction when clip selected | MEDIUM | Canvas pointerEvents='auto' when selectedClipId exists |

---

## MOVABLE OBJECT AUDIT

| Object | Move | Resize | Rotate | Notes |
|--------|------|--------|--------|-------|
| Video Clip (timeline) | YES (drag + snap) | YES (trim edges) | N/A | Works well |
| Video Clip (canvas) | YES (gizmo drag) | YES (corner/edge handles) | YES (rotation handle) | **No undo** |
| Text Clip (timeline) | NO (only trim) | YES (trim edges only) | N/A | Cannot drag to reposition |
| Text Clip (canvas) | YES (TransformOverlay drag) | NO (handles decorative) | NO | Only move works |
| Audio Track (timeline) | PARTIAL (HTML5 drop only) | NO | N/A | No click-drag |
| Caption Block (timeline) | NO | YES (trim edges) | N/A | No body drag |

---

## DISCONNECT-WIRE AUDIT

**Not applicable.** CapCraft does not use node graphs, wire editors, or effect graphs. No wire-based system exists.

---

## PERFORMANCE AUDIT

| # | Issue | Severity | Evidence |
|---|-------|----------|----------|
| PF1 | Timeline re-renders entire canvas on ANY state change | MEDIUM | RAF effect depends on `[clips, audioTracks, tracks, markers, playheadMs, ...]` — playheadMs changes 30fps during playback |
| PF2 | Caption rendering is O(n) scan every frame | LOW-MEDIUM | `captionEntries.find()` every frame — should use binary search for 5000+ captions |
| PF3 | No clip virtualization on timeline canvas | MEDIUM | All clips rendered regardless of viewport (caption blocks ARE culled — good) |
| PF4 | `useShallow` used on some subscriptions but many components subscribe to full arrays | LOW | Timeline subscribes to `clips`, `audioTracks` etc. — any mutation triggers re-render |
| PF5 | No debounce on transform store writes during drag | LOW | `setClipTransform` fires on every mousemove — no throttle |
| PF6 | Undo stack stores full copies of all arrays | LOW-MEDIUM | `pushUndoSnapshot` shallow-copies each element — at 500 clips × 50 undo levels = 25K objects |
| PF7 | `recalcDuration` iterates all clips on every mutation | LOW | Called in addClip, moveClip, deleteClip, etc. |

**100 clips:** Usable — minor lag on zoom/scroll.
**500 clips:** Likely degraded — full canvas redraw per frame, no virtualization.
**1000 clips:** Probably unusable for real-time playback and timeline interaction.

---

## KEYBOARD SHORTCUTS AUDIT

| Shortcut | Expected | Status |
|----------|----------|--------|
| Space | Play/Pause | IMPLEMENTED |
| J | Rewind 5s | IMPLEMENTED |
| K | Pause | IMPLEMENTED |
| L | Forward 5s | IMPLEMENTED |
| S | Split at playhead | IMPLEMENTED |
| Delete/Backspace | Delete clip | IMPLEMENTED (with confirm dialog — CapCut doesn't confirm) |
| Ctrl+Z | Undo | IMPLEMENTED |
| Ctrl+Shift+Z | Redo | IMPLEMENTED |
| Ctrl+S | Save | IMPLEMENTED |
| Ctrl+O | Open | IMPLEMENTED |
| Ctrl+E | Export | IMPLEMENTED |
| V/B/H/Z | Tool switch | IMPLEMENTED |
| ? | Shortcuts dialog | IMPLEMENTED |
| **Ctrl+C** | Copy | **NOT IMPLEMENTED** |
| **Ctrl+V** | Paste | **NOT IMPLEMENTED** |
| **Ctrl+X** | Cut | **NOT IMPLEMENTED** |
| **Ctrl+D** | Duplicate | **NOT IMPLEMENTED** |
| **Ctrl+A** | Select All | **NOT IMPLEMENTED** |
| **Left/Right Arrow** | Frame step | **NOT IMPLEMENTED** |
| **Shift+Left/Right** | Multi-frame step | **NOT IMPLEMENTED** |
| **Home/End** | Jump to start/end | **NOT IMPLEMENTED** (buttons exist in PlaybackControls) |
| **T** | Add text | **NOT IMPLEMENTED** (button exists, no hotkey) |
| I | Set in point | **STUB** (TODO comment) |
| O | Set out point | **STUB** (TODO comment) |

---

## TOP 20 FEATURES MISSING FOR CAPCUT PARITY

Ranked by impact on professional editing workflow:

| Rank | Feature | Impact | Complexity |
|------|---------|--------|------------|
| 1 | Multi-select (timeline + canvas) | CRITICAL | L |
| 2 | Clipboard (Ctrl+C/V/X) | CRITICAL | M |
| 3 | Multi-clip compositing (overlay/PIP) | CRITICAL | XL |
| 4 | Effects / Transitions / Filters | CRITICAL | XL |
| 5 | Keyframe animation system | CRITICAL | XL |
| 6 | Caption drag on timeline | HIGH | S |
| 7 | Audio track click-drag on timeline | HIGH | S |
| 8 | Video transform undo | HIGH | XS |
| 9 | Speed ramping playback | HIGH | M |
| 10 | Frame-accurate seeking (arrow keys) | HIGH | S |
| 11 | Text resize/rotate on canvas | HIGH | M |
| 12 | Snapping to playhead + cross-type edges | HIGH | M |
| 13 | Ctrl+D duplicate shortcut | HIGH | XS |
| 14 | Real audio waveform | MEDIUM | L |
| 15 | Alignment / smart guides | MEDIUM | L |
| 16 | Zoom-to-cursor on timeline | MEDIUM | S |
| 17 | Track reordering via drag | MEDIUM | M |
| 18 | In/Out point trimming | MEDIUM | M |
| 19 | Ripple delete | MEDIUM | M |
| 20 | Timeline clip virtualization | MEDIUM | M |

---

## IMPLEMENTATION ROADMAP

### P0 — Critical (Must Have)

| # | Feature | Complexity | Files | Why |
|---|---------|-----------|-------|-----|
| 1 | Multi-select state model | L | useTimeline.ts, Timeline/index.tsx, TransformOverlay.tsx, HotkeyManager.tsx | Foundation for all batch operations |
| 2 | Clipboard (copy/paste/cut) | M | New: useClipboard store. Modify: HotkeyManager, Timeline context menu | Most basic editing workflow |
| 3 | Video transform undo | XS | Preview/index.tsx (L312, L420-428) | Data loss — users can't undo transform |
| 4 | Caption drag on timeline | S | Timeline/index.tsx (caption hit-test block L391-446) | Basic timeline editing |
| 5 | Ctrl+D duplicate | XS | HotkeyManager.tsx | Trivial fix, high user value |
| 6 | Speed playback integration | M | Preview/index.tsx (clipTimeSec), useTimeline (speed-duration coupling) | Speed tab is non-functional without this |
| 7 | Frame-step (arrow keys) | S | HotkeyManager.tsx | Precision editing impossible without |

### P1 — Important (Should Have)

| # | Feature | Complexity | Files | Why |
|---|---------|-----------|-------|-----|
| 8 | Audio track click-drag | S | Timeline/index.tsx handleMouseDown | Audio editing parity |
| 9 | Cross-type snapping | M | Timeline snapToEdge | Precision alignment |
| 10 | Text resize/rotate on canvas | M | TransformOverlay.tsx, CaptionStyle type, drawCaption | Text editing parity |
| 11 | Zoom-to-cursor | S | Timeline handleWheel | UX quality |
| 12 | In/Out point trimming | M | HotkeyManager, useTimeline (new state + action) | Editing precision |
| 13 | Ripple delete | M | useTimeline (new action), Timeline context menu | Timeline intelligence |
| 14 | Timeline clip virtualization | M | Timeline/index.tsx render loop | Performance at scale |
| 15 | Real audio waveform | L | New: audio peak extraction service, Timeline drawAudioTrack | Visual fidelity |

### P2 — Nice to Have

| # | Feature | Complexity | Files | Why |
|---|---------|-----------|-------|-----|
| 16 | Multi-clip compositing | XL | Preview (multi-video architecture) | Overlay/PIP workflows |
| 17 | Effects/Transitions engine | XL | New: effect store, keyframe system, render pipeline | CapCut's core differentiator |
| 18 | Keyframe animation | XL | New: keyframe store, interpolation, UI editor | Motion graphics |
| 19 | Alignment/smart guides | L | Preview canvas, TransformOverlay | Pro UX |
| 20 | Track reordering drag | M | Timeline track headers | Organization |

---

## DETAILED EVIDENCE LOG

### Evidence: Multi-select absent
```
useTimeline.ts L129: selectedClipId: string | null
useTimeline.ts L130: selectedTextClipId: string | null
Timeline/index.tsx L464: selectClip(clickedClip.id)  // singular, no Shift/Ctrl check
HotkeyManager.tsx: No Shift+click, Ctrl+click, or Ctrl+A handlers
```

### Evidence: Clipboard absent
```
Timeline/index.tsx L918: { label: 'Cut', shortcut: 'Ctrl+X', disabled: true }
Timeline/index.tsx L919: { label: 'Copy', shortcut: 'Ctrl+C', disabled: true }
Timeline/index.tsx L920: { label: 'Paste', shortcut: 'Ctrl+V', disabled: true }
HotkeyManager.tsx: No Ctrl+C, Ctrl+V, Ctrl+X handlers
```

### Evidence: Transform undo missing
```
Preview/index.tsx L312-334: handleTransformMouseDown — no beginDragCapture() call
Preview/index.tsx L420-428: onUp handler — no commitDrag() call
Compare TransformOverlay.tsx L80: beginDragCapture() — text clips DO have it
```

### Evidence: Speed ignored in playback
```
Preview/index.tsx L60-64:
  clipTimeSec = (headMs - clip.startMs + clip.trimStart) / 1000
  // No multiplication by clip.speed
useTimeline.ts L82: speed: number  // property exists on Clip interface
```

### Evidence: Single clip rendering
```
Preview/index.tsx L54-57:
  findClipAt = (ms) => clips.find(c => ms >= c.startMs && ms < c.startMs + c.durationMs) ?? null
  // Returns FIRST match only — only one <video> element exists
```

### Evidence: Caption no-drag on timeline
```
Timeline/index.tsx L391-446:
  // Caption hit-test: checks nearLeft and nearRight for trim
  // If neither trim edge: just returns (L445: return;)
  // No drag-to-move handler for caption body
```

### Evidence: Audio no-drag on timeline
```
Timeline/index.tsx handleMouseDown:
  // Hit-tests caption blocks first (L382)
  // Then hit-tests video clips (L450-548)
  // No hit-test for audio tracks at all
  // Falls through to playhead drag or deselect
```

### Evidence: 8/11 Left Rail tabs are placeholders
```
page.tsx L402-409:
  {activeLeftTab === 'templates' && <ComingSoonPanel label="Templates" />}
  {activeLeftTab === 'elements' && <ComingSoonPanel label="Elements" />}
  {activeLeftTab === 'audio' && <ComingSoonPanel label="Audio" />}
  {activeLeftTab === 'transcript' && <ComingSoonPanel label="Transcript" />}
  {activeLeftTab === 'effects' && <ComingSoonPanel label="Effects" />}
  {activeLeftTab === 'transitions' && <ComingSoonPanel label="Transitions" />}
  {activeLeftTab === 'filters' && <ComingSoonPanel label="Filters" />}
  {activeLeftTab === 'plugins' && <ComingSoonPanel label="Plugins" />}
```

### Evidence: Delete confirmation differs from CapCut
```
HotkeyManager.tsx L95-111:
  // Delete triggers useConfirm dialog — CapCut deletes immediately
  // This slows down rapid editing workflows significantly
```

---

## PREVIOUSLY IDENTIFIED & FIXED ISSUES

These issues were found and resolved in prior audit sessions. Listed for traceability.

| # | Issue | Root Cause | Fix | Status |
|---|-------|-----------|-----|--------|
| FIX-1 | Audio track ID mismatch — "Set as Voice/Music" never matched | Timeline constructed `audio_${indexOf(a)}` but real IDs are `audio_${ts}_${rand}` | Match on `a.id === lane.trackId` directly | FIXED |
| FIX-2 | splitTextClip shared style reference — editing one half mutated the other | Shallow copy `style: clip.style` | Deep-copy with `style: { ...clip.style }` | FIXED |
| FIX-3 | Duplicated `applyStyleToSelected` across CaptionStyleTab and CaptionAnimationTab | Copy-pasted code block | Extracted `useCaptionStyleBinding()` shared hook | FIXED |
| FIX-4 | Dead `updateCaptionPosition` no-op function | Stale code | Removed from useCaption store | FIXED |
| FIX-5 | Dead `position: string` in drawCaption type signature | Legacy enum not used | Removed from type | FIXED |
| FIX-6 | Caption split (Enter key) created duplicate text instead of splitting | `useTimeline.getState()` captured BEFORE `splitTextClip()` — stale snapshot | Re-read state AFTER split mutation | FIXED |
| FIX-7 | Stroke color, stroke width, and position sliders had no effect on canvas | `drawCaption` used hardcoded `rgba(0,0,0,0.5)` stroke and `captionBaselineY(position)` | Made `drawCaption`/`drawKaraokeCaption` use `style.strokeColor`, `style.strokeWidth`, `style.x`, `style.y` | FIXED |
| FIX-8 | TransformOverlay rectangle didn't lock to rendered caption text | Canvas used `position` enum, TransformOverlay used `style.x/y` percentages — different coordinate systems | Unified both to use `style.x/y` percentages as single source of truth | FIXED |
