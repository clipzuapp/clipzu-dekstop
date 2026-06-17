import { useExport, EXPORT_PRESETS } from '../../store/useExport'
import type { PresetKey } from '../../store/useExport'

/**
 * PresetPicker - Export dimension preset selector
 */
export function PresetPicker(): JSX.Element {
  const preset = useExport((s) => s.preset)
  const setPreset = useExport((s) => s.setPreset)
  const customWidth = useExport((s) => s.customWidth)
  const customHeight = useExport((s) => s.customHeight)
  const setCustomResolution = useExport((s) => s.setCustomResolution)

  return (
    <div className="space-y-2">
      <select
        value={preset}
        onChange={(e) => setPreset(e.target.value as PresetKey)}
        className="input w-full"
      >
        {Object.entries(EXPORT_PRESETS).map(([key, val]) => (
          <option key={key} value={key}>
            {val.label}
          </option>
        ))}
      </select>

      {preset === 'custom' && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-gray-500">Width</label>
            <input
              type="number"
              value={customWidth}
              onChange={(e) => setCustomResolution(parseInt(e.target.value) || 0, customHeight)}
              className="input w-full"
              min={100}
              max={7680}
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-gray-500">Height</label>
            <input
              type="number"
              value={customHeight}
              onChange={(e) => setCustomResolution(customWidth, parseInt(e.target.value) || 0)}
              className="input w-full"
              min={100}
              max={7680}
            />
          </div>
        </div>
      )}

      {preset !== 'custom' && (
        <p className="text-[10px] text-gray-500">
          Output: {EXPORT_PRESETS[preset].width} x {EXPORT_PRESETS[preset].height}
        </p>
      )}
    </div>
  )
}

export default PresetPicker
