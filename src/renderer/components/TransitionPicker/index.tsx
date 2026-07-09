// ---------------------------------------------------------------------------
// TransitionPicker — Popover for selecting transitions
// ---------------------------------------------------------------------------
//
// Shows a grid of transition thumbnails (icon + name). Click to apply to
// selected clip's outTransition. Duration editable inline.

import { useState, useCallback } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { builtinTransitionRegistry } from '../../effects/definitions/transitions'
import { X } from 'lucide-react'

interface TransitionPickerProps {
  clipId: string
  onClose: () => void
}

export function TransitionPicker({ clipId, onClose }: TransitionPickerProps): JSX.Element {
  const clip = useTimeline((s) => s.clips.find((c) => c.id === clipId))
  const setClipOutTransition = useTimeline((s) => s.setClipOutTransition)

  const [selectedType, setSelectedType] = useState<string>(
    clip?.outTransition?.type || 'crossfade'
  )
  const [durationMs, setDurationMs] = useState<number>(
    clip?.outTransition?.durationMs || 500
  )

  const transitions = builtinTransitionRegistry.list()

  const handleApply = useCallback(() => {
    setClipOutTransition(clipId, { type: selectedType, durationMs })
    onClose()
  }, [clipId, selectedType, durationMs, setClipOutTransition, onClose])

  const handleRemove = useCallback(() => {
    setClipOutTransition(clipId, null)
    onClose()
  }, [clipId, setClipOutTransition, onClose])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-4 max-w-2xl w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Select Transition</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Transition grid */}
        <div className="grid grid-cols-4 gap-2 mb-4 max-h-80 overflow-y-auto">
          {transitions.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedType(t.id)}
              className={`p-3 rounded border transition-colors ${
                selectedType === t.id
                  ? 'bg-purple-600 border-purple-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
              }`}
            >
              <div className="text-2xl mb-1">{t.category === 'dissolve' ? '✧' : t.category === 'slide' ? '⇢' : t.category === 'wipe' ? '▮' : '⊕'}</div>
              <div className="text-[10px] font-medium">{t.displayName}</div>
            </button>
          ))}
        </div>

        {/* Duration input */}
        <div className="flex items-center gap-3 mb-4">
          <label className="text-[11px] text-gray-400">Duration:</label>
          <input
            type="number"
            value={durationMs}
            onChange={(e) => setDurationMs(Math.max(100, Number(e.target.value)))}
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
            min={100}
            step={100}
          />
          <span className="text-[10px] text-gray-500">ms</span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleRemove}
            className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Remove Transition
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
