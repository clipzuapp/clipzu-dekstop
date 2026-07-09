// ---------------------------------------------------------------------------
// FiltersPanel — Pre-composed filter presets with intensity control
// ---------------------------------------------------------------------------
//
// Grid of filter thumbnails (pre-composed modifier presets). Click to apply
// to selected clip. Intensity slider scales modifier parameters.

import { useState, useCallback, useMemo } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { builtinEffectRegistry } from '../../effects/definitions/builtinEffects'
import type { Modifier } from '../../effects/types/Modifier'
import type { EffectDefinition } from '../../effects/types/Effect'
import { SlidersHorizontal, ChevronDown, ChevronRight, X } from 'lucide-react'
import { SliderInputField } from '../SliderInputField/index'

/** Pre-composed filter presets — each is a set of effect ID + parameter overrides. */
interface FilterPreset {
  id: string
  name: string
  icon: string
  modifiers: Array<{ effectId: string; params: Record<string, number> }>
}

const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', name: 'Original', icon: '○', modifiers: [] },
  { id: 'vivid', name: 'Vivid', icon: '◐', modifiers: [
    { effectId: 'saturation', params: { level: 30 } },
    { effectId: 'contrast', params: { level: 15 } },
  ]},
  { id: 'warm', name: 'Warm', icon: '◑', modifiers: [
    { effectId: 'brightness', params: { level: 10 } },
    { effectId: 'saturation', params: { level: 15 } },
    { effectId: 'hue-rotate', params: { angle: 10 } },
  ]},
  { id: 'cool', name: 'Cool', icon: '◒', modifiers: [
    { effectId: 'brightness', params: { level: -5 } },
    { effectId: 'hue-rotate', params: { angle: 200 } },
  ]},
  { id: 'noir', name: 'Noir', icon: '◓', modifiers: [
    { effectId: 'grayscale', params: { amount: 100 } },
    { effectId: 'contrast', params: { level: 30 } },
  ]},
  { id: 'vintage', name: 'Vintage', icon: '◔', modifiers: [
    { effectId: 'sepia', params: { amount: 50 } },
    { effectId: 'contrast', params: { level: 10 } },
    { effectId: 'brightness', params: { level: -5 } },
  ]},
  { id: 'fade', name: 'Fade', icon: '◕', modifiers: [
    { effectId: 'contrast', params: { level: -20 } },
    { effectId: 'brightness', params: { level: 10 } },
    { effectId: 'saturation', params: { level: -20 } },
  ]},
  { id: 'sharp', name: 'Sharp', icon: '◖', modifiers: [
    { effectId: 'sharpen', params: { amount: 60 } },
    { effectId: 'contrast', params: { level: 10 } },
  ]},
  { id: 'dreamy', name: 'Dreamy', icon: '◗', modifiers: [
    { effectId: 'blur', params: { amount: 2 } },
    { effectId: 'brightness', params: { level: 15 } },
    { effectId: 'saturation', params: { level: -10 } },
  ]},
]

/** Collapsible per-filter control for active filters list. */
function FilterControl({
  modifier,
  effect,
  onRemove,
  onParamChange
}: {
  modifier: Modifier
  effect: EffectDefinition
  onRemove: () => void
  onParamChange: (paramId: string, value: number) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const numParams = effect.parameters.filter((p) => p.descriptor.valueType === 'number').length

  return (
    <div className="bg-gray-800/50 rounded overflow-hidden">
      <div
        className="flex items-center justify-between px-2 py-1.5 cursor-pointer hover:bg-gray-700/30 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? <ChevronDown size={10} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={10} className="text-gray-500 flex-shrink-0" />}
          <span className="text-[11px] text-gray-300 truncate">{effect.displayName}</span>
          {numParams > 0 && (
            <span className="text-[9px] text-gray-600 flex-shrink-0">{numParams} param{numParams > 1 ? 's' : ''}</span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="text-gray-600 hover:text-red-400 flex-shrink-0 transition-colors"
          title="Remove filter"
        >
          <X size={10} />
        </button>
      </div>
      {expanded && numParams > 0 && (
        <div className="px-2 pb-1.5 space-y-0.5 border-t border-gray-700/30 pt-1">
          {effect.parameters.map((paramDef) => {
            const isNum = paramDef.descriptor.valueType === 'number'
            if (!isNum) return null
            const currentVal = typeof modifier.parameters[paramDef.name] === 'number'
              ? modifier.parameters[paramDef.name] as number
              : (paramDef.descriptor as any).default ?? 0
            const desc = paramDef.descriptor as { min: number; max: number; step: number }
            return (
              <SliderInputField key={paramDef.name} label={paramDef.name}
                value={currentVal} min={desc.min} max={desc.max}
                step={desc.step || (desc.max - desc.min) / 100}
                onChange={(v) => onParamChange(paramDef.name, v)} />
            )
          })}
        </div>
      )}
    </div>
  )
}

/** CSS filter preview thumbnail for a filter preset. */
function FilterPreview({ preset }: { preset: FilterPreset }): JSX.Element {
  // Build a CSS filter string from the preset's modifier params
  const cssFilter = useMemo(() => {
    const parts: string[] = []
    for (const { effectId, params } of preset.modifiers) {
      switch (effectId) {
        case 'blur': parts.push(`blur(${params.amount ?? 0}px)`); break
        case 'brightness': parts.push(`brightness(${100 + (params.level ?? 0)}%)`); break
        case 'contrast': parts.push(`contrast(${100 + (params.level ?? 0)}%)`); break
        case 'saturation': parts.push(`saturate(${100 + (params.level ?? 0)}%)`); break
        case 'hue-rotate': parts.push(`hue-rotate(${params.angle ?? 0}deg)`); break
        case 'sepia': parts.push(`sepia(${(params.amount ?? 0)}%)`); break
        case 'grayscale': parts.push(`grayscale(${(params.amount ?? 0)}%)`); break
        case 'sharpen': break // no pure CSS sharpen
        default: break
      }
    }
    return parts.join(' ') || 'none'
  }, [preset.modifiers])

  return (
    <div
      className="w-full aspect-square rounded mb-1"
      style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
        filter: cssFilter,
      }}
    />
  )
}

export function FiltersPanel(): JSX.Element {
  const [intensity, setIntensity] = useState(100)
  const selectedIds = useTimeline((s) => s.selectedIds)
  const clips = useTimeline((s) => s.clips)
  const addClipModifier = useTimeline((s) => s.addClipModifier)
  const removeClipModifier = useTimeline((s) => s.removeClipModifier)
  const updateClipModifier = useTimeline((s) => s.updateClipModifier)

  const selectedClipId = selectedIds[0]
  const selectedClip = clips.find((c) => c.id === selectedClipId)
  const activeModifiers = selectedClip?.modifiers ?? []

  const handleRemoveModifier = useCallback(
    (modifierId: string) => {
      if (!selectedClipId) return
      removeClipModifier(selectedClipId, modifierId)
    },
    [selectedClipId, removeClipModifier]
  )

  const handleParamChange = useCallback(
    (modifierId: string, paramId: string, value: number) => {
      if (!selectedClipId) return
      updateClipModifier(selectedClipId, modifierId, {
        parameters: { [paramId]: value }
      })
    },
    [selectedClipId, updateClipModifier]
  )

  const handleApplyFilter = useCallback(
    (preset: FilterPreset) => {
      if (!selectedClipId) return
      // Remove only filter-added modifiers (ID prefix 'flt_'), preserve user-added effects
      const existing = selectedClip?.modifiers ?? []
      for (const mod of existing) {
        if (mod.id.startsWith('flt_')) {
          removeClipModifier(selectedClipId, mod.id)
        }
      }
      // Add new modifiers with intensity scaling
      const scale = intensity / 100
      for (const { effectId, params } of preset.modifiers) {
        const effect = builtinEffectRegistry.get(effectId)
        if (!effect) continue
        const scaledParams: Record<string, number> = {}
        for (const [key, val] of Object.entries(params)) {
          const paramDef = effect.parameters.find((p) => p.name === key)
          const defaultVal = paramDef?.descriptor.valueType === 'number'
            ? (paramDef.descriptor as any).default ?? 0
            : 0
          // Scale the delta from default
          scaledParams[key] = Math.round(defaultVal + (val - defaultVal) * scale)
        }
        const modifier: Modifier = {
          id: `flt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'effect',
          presetId: effectId,
          enabled: true,
          parameters: scaledParams,
          keyframes: [],
          version: 1
        }
        addClipModifier(selectedClipId, modifier)
      }
    },
    [selectedClipId, selectedClip, intensity, addClipModifier, removeClipModifier]
  )

  return (
    <div className="p-3 space-y-3 overflow-y-auto h-full">
      <div className="flex items-center gap-1.5">
        <SlidersHorizontal size={12} className="text-blue-400" />
        <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">Filters</span>
      </div>

      {/* Intensity slider */}
      <SliderInputField label="Intensity" value={intensity} min={0} max={100} step={1} unit="%"
        onChange={setIntensity} />

      {/* Filter grid — real CSS previews */}
      <div className="grid grid-cols-3 gap-1.5">
        {FILTER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handleApplyFilter(preset)}
            disabled={!selectedClipId}
            className="p-1.5 bg-gray-800/60 border border-gray-700/50 rounded hover:border-blue-500/50 transition-colors text-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FilterPreview preset={preset} />
            <div className="text-[10px] text-gray-400">{preset.name}</div>
          </button>
        ))}
      </div>

      {/* Active filters on selected clip — collapsible per filter */}
      {selectedClip && activeModifiers.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-700 pt-3">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal size={10} className="text-blue-400" />
            <span className="text-[11px] font-semibold text-gray-300 uppercase">Active Filters ({activeModifiers.length})</span>
          </div>
          {activeModifiers.map((mod) => {
            const effect = builtinEffectRegistry.get(mod.presetId)
            if (!effect) return null
            return (
              <FilterControl
                key={mod.id}
                modifier={mod}
                effect={effect}
                onRemove={() => handleRemoveModifier(mod.id)}
                onParamChange={(paramId, value) => handleParamChange(mod.id, paramId, value)}
              />
            )
          })}
        </div>
      )}

      {!selectedClipId && (
        <div className="text-[11px] text-yellow-500/80 bg-yellow-500/10 rounded px-2 py-1.5">
          Select a clip to apply filters.
        </div>
      )}
    </div>
  )
}
