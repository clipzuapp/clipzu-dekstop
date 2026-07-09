// ---------------------------------------------------------------------------
// CaptionPresetPanel — Browse and apply caption presets
// ---------------------------------------------------------------------------
//
// Grid of preset cards showing preview text styled with the preset.
// Click to apply to selected captions, "Apply to All" button.

import { useCallback, useState } from 'react'
import { useCaption } from '../../store/useCaption'
import { CAPTION_PRESETS, type CaptionPreset } from '../../effects/definitions/captionPresets'
import { useTimeline } from '../../store/useTimeline'
import { Check, Palette } from 'lucide-react'

export function CaptionPresetPanel(): JSX.Element {
  const applyPresetToSelection = useCaption((s) => s.applyPresetToSelection)
  const applyPresetToAll = useCaption((s) => s.applyPresetToAll)
  const selectedIds = useTimeline((s) => s.selectedIds)
  const textClips = useTimeline((s) => s.textClips)

  const [appliedId, setAppliedId] = useState<string | null>(null)

  const selectedTextCount = selectedIds.filter((id) =>
    textClips.some((tc) => tc.id === id)
  ).length

  const handleApply = useCallback(
    (preset: CaptionPreset) => {
      applyPresetToSelection(preset.style)
      setAppliedId(preset.id)
      setTimeout(() => setAppliedId(null), 1200)
    },
    [applyPresetToSelection]
  )

  const handleApplyAll = useCallback(
    (preset: CaptionPreset) => {
      applyPresetToAll(preset.style)
      setAppliedId(preset.id)
      setTimeout(() => setAppliedId(null), 1200)
    },
    [applyPresetToAll]
  )

  return (
    <div className="p-3 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
          <Palette size={12} />
          Caption Presets
        </span>
        {selectedTextCount > 0 && (
          <span className="text-[10px] text-gray-500">
            {selectedTextCount} selected
          </span>
        )}
      </div>

      {selectedTextCount === 0 && (
        <div className="text-[10px] text-yellow-500/80 bg-yellow-500/10 rounded px-2 py-1.5">
          Select text clips on the timeline to apply presets.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {CAPTION_PRESETS.map((preset) => {
          const s = preset.style
          return (
            <div
              key={preset.id}
              className="group relative bg-gray-800/60 border border-gray-700/50 rounded-lg p-2 hover-hover:border-purple-500/50 transition-colors cursor-pointer overflow-hidden"
              onClick={() => handleApply(preset)}
            >
              {/* Dark backdrop for better text visibility */}
              <div
                className="rounded mb-1.5 flex items-center justify-center"
                style={{
                  height: '40px',
                  background: s.bgOpacity
                    ? `rgba(0,0,0,${Math.min(s.bgOpacity, 0.7)})`
                    : 'linear-gradient(135deg, rgba(30,30,40,0.8), rgba(20,20,30,0.9))',
                }}
              >
                <span
                  style={{
                    fontFamily: s.fontFamily || 'Inter',
                    fontSize: `${Math.min(s.fontSize ?? 28, 22)}px`,
                    fontWeight: s.fontWeight || 700,
                    color: s.color || '#fff',
                    textShadow: [
                      s.strokeWidth && s.strokeWidth > 0 ? `0 0 ${s.strokeWidth}px ${s.strokeColor || '#000'}` : '',
                      '0 1px 2px rgba(0,0,0,0.5)',
                    ].filter(Boolean).join(', ') || undefined,
                    WebkitTextStroke: s.strokeWidth && s.strokeWidth > 1
                      ? `${s.strokeWidth * 0.5}px ${s.strokeColor || '#000'}`
                      : undefined,
                    lineHeight: 1,
                    letterSpacing: '-0.02em',
                  }}
                >
                  Aa
                </span>
              </div>

              <div className="text-[10px] text-gray-400 text-center truncate">{preset.displayName}</div>

              {/* Applied indicator */}
              {appliedId === preset.id && (
                <div className="absolute inset-0 bg-purple-600/20 rounded-lg flex items-center justify-center">
                  <Check size={16} className="text-purple-400" />
                </div>
              )}

              {/* Apply to All on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleApplyAll(preset)
                }}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-[8px] bg-gray-900/80 text-gray-400 hover:text-white rounded px-1 py-0.5 transition-opacity"
                title="Apply to all text clips"
              >
                All
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
