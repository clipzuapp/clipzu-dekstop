/**
 * projectSchemaCompat.ts — compile-time drift guard (WEB PROJECT ONLY).
 *
 * The canonical file-format types in src/shared/project/projectSchema.ts
 * deliberately do NOT import these renderer domain types (tsconfig.node.json
 * excludes src/renderer/**, so even `import type` would drag zustand,
 * window.electron, … into the main-process build and break it with TS6307).
 *
 * Instead, this file asserts BIDIRECTIONAL assignability between the renderer
 * runtime types and their canonical mirrors. Change either side
 * incompatibly and `npm run typecheck:web` fails here — loudly, before any
 * save/load drift can silently ship.
 *
 * This file has no runtime code and is never imported. It exists only to be
 * typechecked (src/renderer/** is included in tsconfig.web.json).
 */

import type {
  Clip,
  ClipTransform,
  AudioTrack,
  TextClip,
  Track,
  TimelineMarker,
  BlendMode,
} from './useTimeline'
import type {
  KeyframeTrack,
  Keyframe,
  EasingType,
} from '../effects/types/Keyframe'
import type {
  Modifier,
  ModifierParameterValue,
} from '../effects/types/Modifier'
import type { ExportState } from './useExport'
import type {
  CanonicalClip,
  CanonicalTransform,
  CanonicalAudioTrack,
  CanonicalTextClip,
  CanonicalWord,
  CanonicalTrack,
  CanonicalMarker,
  CanonicalBlendMode,
  CanonicalKeyframeTrack,
  CanonicalKeyframe,
  CanonicalEasing,
  CanonicalModifier,
  CanonicalExportConfig,
} from '../../shared/project/projectSchema'

type MutuallyAssignable<A, B> = A extends B ? (B extends A ? true : never) : never
type AssertTrue<T extends true> = T

type CheckClip = AssertTrue<MutuallyAssignable<Clip, CanonicalClip>>
type CheckTransform = AssertTrue<MutuallyAssignable<ClipTransform, CanonicalTransform>>
type CheckAudioTrack = AssertTrue<MutuallyAssignable<AudioTrack, CanonicalAudioTrack>>
type CheckTextClip = AssertTrue<MutuallyAssignable<TextClip, CanonicalTextClip>>
type CheckTrack = AssertTrue<MutuallyAssignable<Track, CanonicalTrack>>
type CheckMarker = AssertTrue<MutuallyAssignable<TimelineMarker, CanonicalMarker>>
type CheckBlendMode = AssertTrue<MutuallyAssignable<BlendMode, CanonicalBlendMode>>
type CheckKeyframeTrack = AssertTrue<MutuallyAssignable<KeyframeTrack, CanonicalKeyframeTrack>>
type CheckKeyframe = AssertTrue<MutuallyAssignable<Keyframe, CanonicalKeyframe>>
type CheckEasing = AssertTrue<MutuallyAssignable<EasingType, CanonicalEasing>>
type CheckModifier = AssertTrue<MutuallyAssignable<Modifier, CanonicalModifier>>
type CheckModifierParams = AssertTrue<
  MutuallyAssignable<
    Record<string, ModifierParameterValue>,
    CanonicalModifier['parameters']
  >
>
type CheckWord = AssertTrue<
  MutuallyAssignable<
    { word: string; startMs: number; endMs: number },
    CanonicalWord
  >
>
// Export config: the canonical envelope shape must stay identical to the
// persisted slice of ExportState. queue/isExporting are session-only and
// deliberately excluded on both sides.
type ExportConfigFields = Pick<
  ExportState,
  | 'preset' | 'customWidth' | 'customHeight'
  | 'upscaleEnabled' | 'upscaleAlgorithm'
  | 'codec' | 'qualityPreset'
  | 'bitrateKbps' | 'bitrateMode' | 'exportFrameRange'
  | 'audioOnly' | 'fps' | 'hardwareAccel'
>
type CheckExportConfig = AssertTrue<MutuallyAssignable<ExportConfigFields, CanonicalExportConfig>>

// Keep the checks referenced so no tooling prunes them as dead types.
export type {
  CheckClip,
  CheckTransform,
  CheckAudioTrack,
  CheckTextClip,
  CheckTrack,
  CheckMarker,
  CheckBlendMode,
  CheckKeyframeTrack,
  CheckKeyframe,
  CheckEasing,
  CheckModifier,
  CheckModifierParams,
  CheckWord,
  CheckExportConfig,
}
