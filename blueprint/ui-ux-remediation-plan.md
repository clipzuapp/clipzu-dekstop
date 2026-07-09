# Capcraft UI/UX Remediation Plan — Production Grade

> **STATUS: READY FOR IMPLEMENTATION**
> **PREREQUISITE: Read full audit in conversation context above**

---

## 1. Current Architecture State

### File Map — All Affected Components

```
src/renderer/
├── app/
│   ├── globals.css                          ← Font faces, reset, root vars
│   ├── page.tsx                             ← Layout shell (571 lines, ~200 inline styles)
│   └── layout.tsx                           ← HTML shell
├── styles/
│   └── editor.css                           ← Design system SSOT (459 lines)
├── components/
│   ├── Inspector/
│   │   ├── index.tsx                        ← 1040 lines — 16 range sliders, heavy inline styles
│   │   └── useCaptionStyleBinding.ts        ← Caption style SSOT hook
│   ├── InspectorHeader/index.tsx            ← Context-sensitive header (157 lines)
│   ├── LeftRail/index.tsx                   ← Icon rail (81 lines)
│   ├── RightRail/index.tsx                  ← Icon rail (74 lines)
│   ├── MediaPanel/index.tsx                 ← Media browser (845 lines)
│   ├── Preview/
│   │   ├── index.tsx                        ← Canvas preview (1702 lines)
│   │   ├── PlaybackControls.tsx             ← Transport bar (397 lines, 1 range slider)
│   │   ├── CaptionStrip.tsx                 ← Caption pills (236 lines)
│   │   ├── TransformOverlay.tsx             ← Canvas transform handles (535 lines)
│   │   └── GuideOverlay.tsx                 ← Safe-area guides (180 lines)
│   ├── Timeline/index.tsx                   ← Canvas timeline (1107 lines)
│   ├── EffectsPanel/index.tsx               ← Effect browser + modifier sliders (195 lines, 1 range)
│   ├── FiltersPanel/index.tsx               ← Filter presets + intensity (155 lines, 1 range)
│   ├── KeyframeEditor/index.tsx             ← Keyframe value editor (186 lines)
│   ├── AudioPanel/index.tsx                 ← Audio browser (319 lines)
│   ├── ExportDialog/index.tsx               ← Export drawer (450 lines)
│   ├── Toast/index.tsx                      ← Notification toasts (113 lines)
│   ├── ContextMenu/index.tsx                ← Right-click menu (160 lines)
│   ├── TextPanel/index.tsx                  ← Text overlay creator (169 lines)
│   ├── CaptionEditor/index.tsx              ← Caption text editor (598 lines)
│   ├── CaptionPresetPanel/index.tsx         ← Preset management (116 lines)
│   ├── ComingSoonPanel/index.tsx            ← Placeholder (39 lines)
│   ├── ConfirmDialog/index.tsx              ← Modal confirm (91 lines)
│   ├── ErrorBoundary/index.tsx              ← Error boundary (63 lines)
│   ├── HotkeyManager.tsx                    ← Keyboard shortcuts (588 lines)
│   └── ShortcutsDialog/index.tsx            ← Shortcut reference (147 lines)
├── store/
│   ├── useTimeline.ts                       ← Timeline SSOT (1598 lines)
│   ├── useCaption.ts                        ← Caption SSOT (652 lines)
│   ├── useProject.ts                        ← Project settings SSOT (191 lines)
│   ├── useSelectedEntity.ts                 ← Selection resolver (58 lines)
│   ├── usePreviewView.ts                    ← Preview state (143 lines)
│   ├── useExport.ts                         ← Export state (256 lines)
│   ├── useMediaLibrary.ts                   ← Media library (201 lines)
│   ├── useToast.ts                          ← Toast notifications (58 lines)
│   ├── useConfirm.ts                        ← Confirm dialog (36 lines)
│   └── useStartup.ts                        ← Startup validation (47 lines)
├── services/
│   ├── AudioEngine.ts                       ← Web Audio mixing (464 lines)
│   ├── WaveformService.ts                   ← Waveform rendering (239 lines)
│   ├── FilterPipeline.ts                    ← CSS filter pipeline (95 lines)
│   ├── KeyframeEvaluator.ts                 ← Keyframe interpolation (98 lines)
│   └── NotificationSound.ts                 ← UI sounds (89 lines)
├── effects/
│   ├── types/
│   │   ├── Modifier.ts                      ← Modifier type definitions
│   │   ├── Keyframe.ts                      ← Keyframe type definitions
│   │   └── easing.ts                        ← Easing functions
│   └── definitions/
│       └── builtinEffects.ts                ← Effect registry
└── utils/
    ├── format.ts                            ← Time formatting
    ├── audio.ts                             ← dB conversion utilities
    ├── geometry.ts                          ← Transform geometry
    ├── hooks.ts                             ← Shared React hooks
    └── wordActivation.ts                    ← Caption word activation
```

### Design System SSOT: `editor.css`

```
CSS Custom Properties (root):
  --bg0..--bg4        → 5-stop surface elevation (warm tint)
  --border/--border2  → Hairline borders
  --text1..--text4    → Text hierarchy
  --accent/--accent2  → Brand + caption track
  --green/--amber/--red → Track coding
  --font-sans/--font-mono → Font stacks
  --ease-*            → Motion curves

Utility Classes:
  .panel, .input-field, .btn, .btn-primary, .btn-secondary
  .slider, .separator, .rail-btn, .resize-handle
  .clip-selected, .section-title, .clip-label, .inspector-label
  .export-drawer, .empty-state, .toolbar-btn
```

### State Flow — Inspector Data Path

```
useTimeline (SSOT)
  ├── clips[]           → ClipBasicTab reads clip.transform, clip.volume
  ├── textClips[]       → CaptionStyleTab reads via useCaptionStyleBinding
  ├── audioTracks[]     → AudioTab reads track.volume, track.muted
  ├── focusedId         → useSelectedEntity resolves entity type
  └── selectedIds[]     → Multi-select for effects/filters

useCaption (SSOT)
  └── entries[]         → CaptionStyleTab reads style via useCaptionStyleBinding

useProject (SSOT)
  └── resolution/fps/aspectRatio/backgroundColor → ProjectSettings

Data flow for slider changes:
  User drags slider → onChange → store action (e.g. setClipTransform)
  → Zustand mutation → React re-render → component reads new value
  CaptionStyleTab uses debounce(50ms) + local state for smooth sliders
```

---

## 2. Root Cause Analysis

### Problem 1: Slider-Only Controls
**Root cause:** `SliderRow` component in Inspector (line 48-63) only renders `<input type="range">`. No numeric input field. Users cannot type exact values.

**Affected locations (16 range sliders):**
| Component | Lines | Slider Count | Has Input Field? |
|---|---|---|---|
| `Inspector/index.tsx` → `SliderRow` | 48-63 | 1 (reused 10x) | NO |
| `Inspector/index.tsx` → Clip volume | 307-328 | 1 | YES (inline) |
| `Inspector/index.tsx` → CaptionStyleTab | 454-637 | 7 | NO |
| `Inspector/index.tsx` → AudioTab | 756-775 | 1 | YES (inline) |
| `Inspector/index.tsx` → SpeedTab | 821-826 | 1 | NO |
| `Inspector/index.tsx` → AudioTrackBasicTab | 909-925 | 1 | YES (inline) |
| `EffectsPanel/index.tsx` | 166-177 | dynamic | NO |
| `FiltersPanel/index.tsx` | 119-130 | 1 | NO |
| `PlaybackControls.tsx` | 258 | 1 | NO |

**Pattern inconsistency:** Audio volume controls already have dual slider+input (lines 307-328, 756-775, 909-925) but implemented as ad-hoc inline code — NOT reusable. Caption style, transform, speed, effects, filters all lack numeric input.

### Problem 2: Inline Style Proliferation
**Root cause:** `page.tsx` has ~200 lines of inline `style={{}}`. Inspector has ~900 lines of inline styles. This bypasses the design system in `editor.css`.

### Problem 3: Typography Too Small
**Root cause:** Mockup spec uses 9-10px for clip labels, timecodes. `editor.css` uses 11-12px (better) but some components still use 10px (InspectorHeader, EffectsPanel, FiltersPanel, KeyframeEditor).

### Problem 4: Missing Micro-Interactions
**Root cause:** No `:active` scale feedback, no playhead glow, no clip hover animation in CSS. Spring curves defined but unused.

### Problem 5: No Brand Identity
**Root cause:** `--accent: #4f7fff` is generic. No brand gradient, no custom icon set, no visual signature.

---

## 3. Targeted Changes — Implementation Plan

### PHASE 1: Foundation — New Shared Component (SSOT for dual controls)

#### 1.1 Create `SliderInputField` Component

**New file:** `src/renderer/components/SliderInputField/index.tsx`

**Contract:**
```typescript
interface SliderInputFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string                    // 'px' | '%' | '°' | 'dB' | 's' | 'ms' | '×'
  onChange: (value: number) => void
  debounceMs?: number              // default 0 (immediate). CaptionStyleTab passes 50
  disabled?: boolean
  className?: string
}
```

**Behavior spec:**
- Renders: `[label] [====slider====] [__input__] [unit]`
- Slider and input are **bidirectionally synced** — dragging slider updates input, typing in input updates slider
- Input field validates: clamps to `[min, max]`, respects `step`
- On input: updates local state immediately (visual feedback), calls `onChange` debounced
- Input field is `type="number"` with arrow keys support
- Input width: fixed `52px`, right-aligned, monospace font
- Slider uses `accentColor: var(--accent)`
- Unit label: `11px`, `var(--text3)`, appended after input (e.g., "px", "%", "°")

**SSOT principle:** Single component replaces ALL 16 range-only sliders. The 3 existing dual-controls (audio volume at lines 307-328, 756-775, 909-925) also migrate to this component.

**DRY principle:** Debounce logic extracted from CaptionStyleTab's 6 duplicate `useMemo(() => debounce(...))` blocks into the component itself via `debounceMs` prop.

#### 1.2 Add CSS Classes to `editor.css`

**New classes to add:**
```css
/* SliderInputField — dual slider + numeric input */
.sif-row { display: flex; align-items: center; gap: 8px; padding: 0 12px; }
.sif-label { width: 90px; font-size: 12px; color: var(--text3); flex-shrink: 0; font-family: var(--font-mono); }
.sif-slider { flex: 1; accent-color: var(--accent); height: 4px; }
.sif-input {
  width: 52px; padding: 1px 3px; font-size: 12px; border-radius: 3px;
  background: var(--bg2); color: var(--text1); border: 0.5px solid var(--border);
  font-family: var(--font-mono); text-align: right;
}
.sif-input:focus { border-color: var(--accent); }
.sif-unit { font-size: 11px; color: var(--text3); margin-left: 2px; }
```

---

### PHASE 2: Inspector Migration — Replace All SliderRow + Ad-hoc Sliders

#### 2.1 Refactor `Inspector/index.tsx`

**Changes by section:**

**A. Remove `SliderRow` component (lines 48-63)**
- Replace with `SliderInputField` import

**B. `ClipBasicTab` (lines 245-395)**
Replace 7 `SliderRow` calls with `SliderInputField`:
| Current | New |
|---|---|
| `SliderRow label={`${Math.round(t.scaleX * 100)}%`}` | `<SliderInputField label="Scale" value={Math.round(t.scaleX*100)} min={5} max={400} step={1} unit="%" onChange={...} />` |
| `SliderRow label={`Rot ${t.rotation.toFixed(1)}°`}` | `<SliderInputField label="Rotation" value={t.rotation} min={-180} max={180} step={0.5} unit="°" onChange={...} />` |
| `SliderRow label={`Opacity ...`}` | `<SliderInputField label="Opacity" value={...} min={0} max={100} step={1} unit="%" onChange={...} />` |
| `SliderRow label={`Top ...`}` | `<SliderInputField label="Crop Top" value={...} min={0} max={50} step={1} unit="%" onChange={...} />` |
| `SliderRow label={`Bot ...`}` | `<SliderInputField label="Crop Bottom" ... />` |
| `SliderRow label={`Left ...`}` | `<SliderInputField label="Crop Left" ... />` |
| `SliderRow label={`Right ...`}` | `<SliderInputField label="Crop Right" ... />` |

Replace ad-hoc clip volume dual-control (lines 307-328) with:
```tsx
<SliderInputField label="Volume" value={clipDb} min={-30} max={6} step={0.5} unit="dB"
  onChange={(v) => selectedClipId && setClipVolume(selectedClipId, dbToLinear(v))} />
```

**C. `CaptionStyleTab` (lines 406-656)**
Remove ALL 6 local state + debounce blocks (lines 410-430). Replace with `SliderInputField` using `debounceMs={50}`:
| Current | New |
|---|---|
| localFontSize + debouncedFontSize + range | `<SliderInputField label="Font Size" value={effectiveStyle.fontSize} min={12} max={120} step={1} unit="px" debounceMs={50} onChange={...} />` |
| localFontWeight + debouncedFontWeight + range | `<SliderInputField label="Font Weight" value={effectiveStyle.fontWeight} min={300} max={900} step={100} debounceMs={50} onChange={...} />` |
| localStrokeWidth + debouncedStrokeWidth + range | `<SliderInputField label="Stroke Width" value={effectiveStyle.strokeWidth} min={0} max={10} step={0.5} unit="px" debounceMs={50} onChange={...} />` |
| localBgOpacity + debouncedBgOpacity + range | `<SliderInputField label="BG Opacity" value={Math.round(effectiveStyle.bgOpacity*100)} min={0} max={100} step={1} unit="%" debounceMs={50} onChange={...} />` |
| localX + debouncedX + range | `<SliderInputField label="Position X" value={effectiveStyle.x} min={0} max={100} step={1} unit="%" debounceMs={50} onChange={...} />` |
| localY + debouncedY + range | `<SliderInputField label="Position Y" value={effectiveStyle.y} min={0} max={100} step={1} unit="%" debounceMs={50} onChange={...} />` |
| revealFadeMs range (no local state) | `<SliderInputField label="Fade Duration" value={effectiveStyle.revealFadeMs} min={0} max={200} step={10} unit="ms" onChange={...} />` |
| activeScale range | `<SliderInputField label="Active Scale" value={...} min={50} max={200} step={5} unit="%" onChange={...} />` |

**Net reduction:** ~40 lines of local state + debounce boilerplate eliminated.

**D. `SpeedTab` (lines 788-849)**
Replace speed range (line 821-826) with:
```tsx
<SliderInputField label="Speed" value={Math.round(speed * 100)} min={25} max={400} step={1} unit="×"
  onChange={(v) => setClipSpeed(selectedClipId!, v / 100)} />
```

**E. `AudioTab` (lines 710-782)**
Replace ad-hoc dual-control (lines 756-775) with `SliderInputField`.

**F. `AudioTrackBasicTab` (lines 855-982)**
Replace ad-hoc dual-control (lines 909-925) with `SliderInputField`.

#### 2.2 Refactor `EffectsPanel/index.tsx`

Replace dynamic parameter sliders (lines 166-177) with `SliderInputField`:
```tsx
<SliderInputField label={paramDef.name} value={currentVal}
  min={desc.min} max={desc.max} step={desc.step || (desc.max - desc.min) / 100}
  onChange={(v) => handleParamChange(mod.id, paramDef.name, v)} />
```

#### 2.3 Refactor `FiltersPanel/index.tsx`

Replace intensity slider (lines 119-130) with `SliderInputField`:
```tsx
<SliderInputField label="Intensity" value={intensity} min={0} max={100} step={1} unit="%"
  onChange={setIntensity} />
```

#### 2.4 Refactor `PlaybackControls.tsx`

Replace volume slider (line 258) with `SliderInputField` (compact variant — no label in this context).

**Note:** PlaybackControls uses a different layout (horizontal bar). May need a `compact` prop on `SliderInputField` that hides the label and renders just slider + input.

---

### PHASE 3: Typography Scale Correction

#### 3.1 Update `editor.css` Typography Classes

| Class | Current | New |
|---|---|---|
| `.section-title` | 12px / 500 | **11px** / 500, `letter-spacing: 0.08em` |
| `.clip-label` | 11px / 400 | **11px** / 400 (keep) |
| `.inspector-label` | 12px / 400 | **12px** / 400 (keep) |
| `.timecode` | 12px / 400 | **12px** / 400 (keep) |
| `.tab-label` | 12px / 400 | **11px** / 400 |
| `.toolbar-btn` | 13px / 400 | **12px** / 400 |

#### 3.2 Update Inline Font Sizes in Components

**Files to update:**
- `InspectorHeader/index.tsx` — 10px → **11px** for section headers
- `EffectsPanel/index.tsx` — 9px → **11px** for labels, 10px → **11px** for text
- `FiltersPanel/index.tsx` — 9px → **11px**, 10px → **11px**
- `KeyframeEditor/index.tsx` — 10px → **11px** for all text
- `Inspector/index.tsx` — SectionHeader 12px → **11px**, all `fontSize: '12px'` labels → keep 12px

---

### PHASE 4: Micro-Interaction System

#### 4.1 Add to `editor.css`

```css
/* Button press feedback — tactile scale */
.btn:active, .rail-btn:active, .toolbar-btn:active {
  transform: scale(0.97);
}

/* Playhead glow — always findable */
.playhead-glow {
  box-shadow: 0 0 6px var(--red), 0 0 12px rgba(239, 68, 68, 0.3);
}

/* Panel depth — inner top highlight */
.panel-depth {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 8px rgba(0, 0, 0, 0.6);
}

/* Clip hover brightness */
.clip-hoverable:hover {
  filter: brightness(1.15);
  transition: filter 100ms ease;
}

/* Resize handle — accent line on hover (not full fill) */
.resize-handle:hover {
  background: rgba(79, 127, 255, 0.3);  /* was full var(--accent) */
  box-shadow: 0 0 8px rgba(79, 127, 255, 0.2);
}

/* Caption pill active glow */
.cap-pill-glow {
  box-shadow: 0 0 8px rgba(79, 127, 255, 0.3);
}

/* Smooth caption strip scroll */
.caption-strip-smooth {
  scroll-behavior: smooth;
}
```

#### 4.2 Update Existing Rules in `editor.css`

**Modify `.resize-handle:hover`** (line 187-190):
- Change `background: var(--accent)` → `background: rgba(79, 127, 255, 0.3)`
- Change `box-shadow: 0 0 8px rgba(79, 127, 255, 0.4)` → `box-shadow: 0 0 8px rgba(79, 127, 255, 0.2)`

---

### PHASE 5: Inline Style → CSS Class Migration

#### 5.1 `page.tsx` → Extract to `editor.css`

**New CSS classes needed:**
```css
.layout-shell        { /* main flex column, 100vh/100vw */ }
.layout-toolbar      { /* header 38px */ }
.layout-main-row     { /* flex: 1, horizontal */ }
.layout-preview-col  { /* flex: 1, center content */ }
.layout-timeline     { /* bottom timeline container */ }
.tool-btn            { /* toolbar tool button */ }
.tool-btn-active     { /* active tool state */ }
.toolbar-action-btn  { /* CC, T, Export buttons */ }
.validation-banner   { /* startup warning banner */ }
.fullscreen-overlay   { /* fullscreen preview */ }
```

**Estimated inline style removals in page.tsx:** ~150 lines of inline styles replaced by class names.

#### 5.2 `Inspector/index.tsx` → Extract to `editor.css`

The new `SliderInputField` component handles its own styling via CSS classes (`.sif-*`). Remaining inline styles in Inspector sections (padding, gap, flex) should be extracted to:

```css
.inspector-body       { /* padding: 12px, flex column, gap */ }
.inspector-section    { /* section wrapper */ }
.inspector-grid-2col  { /* 2-column grid for aspect presets */ }
.inspector-anim-grid  { /* animation preset grid */ }
```

---

### PHASE 6: Visual Polish

#### 6.1 Update `editor.css` Root Variables

```css
:root {
  /* Add brand gradient (used sparingly — export button, active states) */
  --brand-gradient: linear-gradient(135deg, #4f7fff 0%, #7c5cfc 100%);

  /* Add OLED-friendly near-black option */
  --bg0-oled: #000000;

  /* Add glassmorphic surface for floating elements */
  --glass-bg: rgba(26, 24, 22, 0.85);
  --glass-blur: blur(12px);
  --glass-border: rgba(255, 255, 255, 0.08);
}
```

#### 6.2 Update `tailwind.config.ts`

Add new tokens to `extend.colors`:
```typescript
brand: {
  DEFAULT: '#4f7fff',
  purple: '#7c5cfc',
  gradient: 'var(--brand-gradient)'
}
```

---

## 4. Unchanged Contracts

These are **NOT modified** — they remain stable:

| Contract | File | Reason |
|---|---|---|
| `useTimeline` store API | `store/useTimeline.ts` | No state shape changes — only UI layer changes |
| `useCaption` store API | `store/useCaption.ts` | Caption style interface unchanged |
| `useProject` store API | `store/useProject.ts` | Project settings interface unchanged |
| `useSelectedEntity` hook | `store/useSelectedEntity.ts` | Selection resolution unchanged |
| `ClipTransform` type | `store/useTimeline.ts` | Transform shape unchanged |
| `CaptionStyle` type | `store/useCaption.ts` | Style interface unchanged |
| `Modifier` type | `effects/types/Modifier.ts` | Effect modifier shape unchanged |
| `EffectDefinition` type | `effects/types/Effect.ts` | Effect definition unchanged |
| `KeyframeTrack` type | `effects/types/Keyframe.ts` | Keyframe shape unchanged |
| IPC contracts | `preload/`, `main/` | No main process changes |
| `formatTime`, `formatDb` | `utils/format.ts`, `utils/audio.ts` | Utility functions unchanged |
| `AudioEngine` service | `services/AudioEngine.ts` | Audio service unchanged |
| `WaveformService` | `services/WaveformService.ts` | Waveform service unchanged |
| `builtinEffectRegistry` | `effects/definitions/builtinEffects.ts` | Registry pattern unchanged |
| `useCaptionStyleBinding` | `Inspector/useCaptionStyleBinding.ts` | Hook interface unchanged |

---

## 5. Implementation Order & Dependencies

```
PHASE 1 (Foundation)
  1.1 Create SliderInputField component
  1.2 Add CSS classes to editor.css
  ↓
PHASE 2 (Inspector Migration) — depends on Phase 1
  2.1 Refactor Inspector/index.tsx (replace SliderRow, ad-hoc sliders, debounce blocks)
  2.2 Refactor EffectsPanel/index.tsx
  2.3 Refactor FiltersPanel/index.tsx
  2.4 Refactor PlaybackControls.tsx
  ↓
PHASE 3 (Typography) — independent, can parallel with Phase 2
  3.1 Update editor.css typography classes
  3.2 Update inline font sizes in components
  ↓
PHASE 4 (Micro-Interactions) — independent
  4.1 Add new CSS rules to editor.css
  4.2 Update existing CSS rules
  ↓
PHASE 5 (Inline Style Migration) — depends on Phase 2 (Inspector must be clean first)
  5.1 Extract page.tsx inline styles to editor.css
  5.2 Extract remaining Inspector inline styles
  ↓
PHASE 6 (Visual Polish) — last, after structural changes are stable
  6.1 Update CSS variables
  6.2 Update Tailwind config
```

---

## 6. Validation Criteria

### Functional Tests
- [ ] Every slider in Inspector can be controlled via BOTH drag and numeric input
- [ ] Numeric input clamps to min/max and respects step
- [ ] Caption style sliders still debounce at 50ms (no regression)
- [ ] Audio volume dB ↔ linear conversion still works correctly
- [ ] Effects panel parameter changes still update clip modifiers
- [ ] Filters panel intensity scaling still works
- [ ] All keyboard shortcuts still function (V, B, H, Z, Ctrl+Z, Space, etc.)
- [ ] Inspector context-switches correctly between caption/clip/audio/project

### Visual Tests
- [ ] Font sizes are readable at arm's length (minimum 11px for all readable text)
- [ ] Button press shows scale(0.97) feedback
- [ ] Playhead has subtle red glow
- [ ] Resize handles show accent line on hover (not full fill)
- [ ] All panels have consistent depth (inner top highlight)
- [ ] Caption strip active pill has glow effect

### Regression Tests
- [ ] No TypeScript errors (strict mode)
- [ ] No new dependencies added
- [ ] No store API changes — all existing `useTimeline`, `useCaption`, `useProject` calls unchanged
- [ ] No IPC contract changes
- [ ] No effect/filter registry changes
- [ ] Undo/redo still works for all modified controls
- [ ] Export still produces correct output

---

## 7. Files Changed Summary

| File | Change Type | Scope |
|---|---|---|
| `src/renderer/components/SliderInputField/index.tsx` | **NEW** | ~80 lines — dual slider+input component |
| `src/renderer/styles/editor.css` | MODIFY | +60 lines CSS classes, ~5 line modifications |
| `src/renderer/components/Inspector/index.tsx` | MODIFY | Replace 16 sliders, remove ~40 lines debounce boilerplate, extract inline styles |
| `src/renderer/components/EffectsPanel/index.tsx` | MODIFY | Replace dynamic sliders with SliderInputField |
| `src/renderer/components/FiltersPanel/index.tsx` | MODIFY | Replace intensity slider with SliderInputField |
| `src/renderer/components/Preview/PlaybackControls.tsx` | MODIFY | Replace volume slider with SliderInputField (compact) |
| `src/renderer/app/page.tsx` | MODIFY | Extract ~150 lines inline styles to CSS classes |
| `src/renderer/components/InspectorHeader/index.tsx` | MODIFY | Font size 10px → 11px |
| `src/renderer/components/KeyframeEditor/index.tsx` | MODIFY | Font size 10px → 11px |
| `src/renderer/tailwind.config.ts` | MODIFY | Add brand color tokens |
| `src/renderer/app/globals.css` | MODIFY | Add noise texture, brand gradient utility |

**Total new files:** 1
**Total modified files:** 10
**Estimated net line change:** ~+50 lines (new component) -100 lines (boilerplate removal) = net -50 lines

---

## 8. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| SliderInputField breaks undo/redo | HIGH | Test: every onChange must flow through existing store actions (setClipTransform, setClipVolume, etc.) — no new state paths |
| Debounce timing regression in CaptionStyleTab | MEDIUM | Keep debounceMs=50 exactly as current. Test: drag slider rapidly → store should only update every 50ms |
| Inline style extraction breaks layout | LOW | Visual diff each panel after extraction. Layout values (padding, gap, flex) must match exactly |
| Font size changes cause overflow | LOW | Test all panels at minimum window size (1024×768). Inspector at minimum width (200px) |
| Tailwind config changes affect existing classes | LOW | Only adding new tokens, not modifying existing ones |
