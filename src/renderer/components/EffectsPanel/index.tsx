// ---------------------------------------------------------------------------
// EffectsPanel — Browse and apply effects to clips
// ---------------------------------------------------------------------------
//
// Search bar, category tabs, effect cards. Click to add modifier to selected
// clip. When clip selected: show active modifiers list with parameter sliders.

import React, { useState, useCallback, useMemo } from 'react'
import { useTimeline } from '../../store/useTimeline'
import { builtinEffectRegistry } from '../../effects/definitions/builtinEffects'
import type { Modifier } from '../../effects/types/Modifier'
import type { EffectDefinition } from '../../effects/types/Effect'
import { Search, Wand2, X, SlidersHorizontal, ChevronDown, ChevronRight } from 'lucide-react'
import { SliderInputField } from '../SliderInputField/index'

const CATEGORIES = ['all', 'blur', 'color', 'style', 'utility'] as const

/** CSS-based preview thumbnail for effect cards. */
function EffectPreview({ effect }: { effect: EffectDefinition }): JSX.Element {
  const style: React.CSSProperties = {}
  const id = effect.id
  if (id === 'blur') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'blur(2px)'
  } else if (id === 'brightness') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'brightness(1.4)'
  } else if (id === 'contrast') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'contrast(1.5)'
  } else if (id === 'saturation') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'saturate(1.8)'
  } else if (id === 'exposure') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'brightness(1.2) saturate(1.2)'
  } else if (id === 'hue-rotate') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'hue-rotate(90deg)'
  } else if (id === 'sepia') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'sepia(80%)'
  } else if (id === 'grayscale') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'grayscale(100%)'
  } else if (id === 'invert') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'invert(100%)'
  } else if (id === 'sharpen') {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
    style.filter = 'contrast(1.3)'
  } else {
    style.background = 'linear-gradient(135deg, #667eea, #764ba2)'
  }
  return <div className="w-full aspect-square rounded mb-1" style={style} />
}

/** Collapsible per-modifier control — avoids visual overlap when many effects are active. */
function ModifierControl({
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
      {/* Header — always visible, click to toggle */}
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
          title="Remove effect"
        >
          <X size={10} />
        </button>
      </div>
      {/* Parameters — collapsible */}
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

export function EffectsPanel(): JSX.Element {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')

  const selectedIds = useTimeline((s) => s.selectedIds)
  const clips = useTimeline((s) => s.clips)
  const addClipModifier = useTimeline((s) => s.addClipModifier)
  const removeClipModifier = useTimeline((s) => s.removeClipModifier)
  const updateClipModifier = useTimeline((s) => s.updateClipModifier)

  const selectedClipId = selectedIds[0]
  const selectedClip = clips.find((c) => c.id === selectedClipId)
  const activeModifiers = selectedClip?.modifiers ?? []

  // Filter effects by search + category
  const allEffects = useMemo(() => {
    const all = builtinEffectRegistry.list()
    let filtered = all
    if (category !== 'all') {
      filtered = filtered.filter((e) => e.category === category)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter((e) => e.displayName.toLowerCase().includes(q))
    }
    return filtered
  }, [search, category])

  const handleAddEffect = useCallback(
    (effect: EffectDefinition) => {
      if (!selectedClipId) return
      // Build default parameters from effect definition
      const params: Record<string, number | string | boolean> = {}
      for (const p of effect.parameters) {
        params[p.name] = p.descriptor.default
      }
      const modifier: Modifier = {
        id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'effect',
        presetId: effect.id,
        enabled: true,
        parameters: params,
        keyframes: [],
        version: 1
      }
      addClipModifier(selectedClipId, modifier)
    },
    [selectedClipId, addClipModifier]
  )

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

  return (
    <div className="p-3 space-y-3 overflow-y-auto h-full">
      <div className="flex items-center gap-1.5">
        <Wand2 size={12} className="text-purple-400" />
        <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">Effects</span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search effects..."
          className="w-full bg-gray-800 border border-gray-700 rounded pl-6 pr-2 py-1 text-[11px] text-white placeholder-gray-500 outline-none focus:border-purple-500"
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
              category === cat
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Effect grid — CSS previews */}
      <div className="grid grid-cols-3 gap-1.5">
        {allEffects.map((effect) => (
          <button
            key={effect.id}
            onClick={() => handleAddEffect(effect)}
            disabled={!selectedClipId}
            className="p-1.5 bg-gray-800/60 border border-gray-700/50 rounded hover:border-purple-500/50 transition-colors text-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <EffectPreview effect={effect} />
            <div className="text-[10px] text-gray-400 truncate">{effect.displayName}</div>
          </button>
        ))}
      </div>

      {/* Active modifiers on selected clip — collapsible per modifier */}
      {selectedClip && activeModifiers.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-700 pt-3">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal size={10} className="text-gray-400" />
            <span className="text-[11px] font-semibold text-gray-300 uppercase">Active Effects ({activeModifiers.length})</span>
          </div>
          {activeModifiers.map((mod) => {
            const effect = builtinEffectRegistry.get(mod.presetId)
            if (!effect) return null
            return (
              <ModifierControl
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
          Select a clip to add effects.
        </div>
      )}
    </div>
  )
}
