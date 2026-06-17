import { useCaption } from '../../store/useCaption'

/**
 * StylePanel - Font, color, background, position, animation controls
 */
export function StylePanel(): JSX.Element {
  const activeStyle = useCaption((s) => s.activeStyle)
  const applyStyle = useCaption((s) => s.applyStyle)

  return (
    <div className="p-3 space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">Caption Style</h3>

      {/* Font Family */}
      <div className="space-y-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">Font</label>
        <select
          value={activeStyle.fontFamily}
          onChange={(e) => applyStyle({ fontFamily: e.target.value })}
          className="input w-full text-xs"
        >
          <option value="Inter">Inter</option>
          <option value="Arial">Arial</option>
          <option value="Helvetica">Helvetica</option>
          <option value="Georgia">Georgia</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Impact">Impact</option>
          <option value="Comic Sans MS">Comic Sans MS</option>
        </select>
      </div>

      {/* Font Size */}
      <div className="space-y-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">
          Size: {activeStyle.fontSize}px
        </label>
        <input
          type="range"
          min={16}
          max={120}
          value={activeStyle.fontSize}
          onChange={(e) => applyStyle({ fontSize: parseInt(e.target.value) })}
          className="w-full accent-accent"
        />
      </div>

      {/* Text Color */}
      <div className="space-y-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">Text Color</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={activeStyle.color}
            onChange={(e) => applyStyle({ color: e.target.value })}
            className="w-8 h-8 rounded border border-editor-border cursor-pointer"
          />
          <input
            type="text"
            value={activeStyle.color}
            onChange={(e) => applyStyle({ color: e.target.value })}
            className="input flex-1 text-xs"
          />
        </div>
      </div>

      {/* Background Color */}
      <div className="space-y-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">Background</label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={activeStyle.bgColor}
            onChange={(e) => applyStyle({ bgColor: e.target.value })}
            className="w-8 h-8 rounded border border-editor-border cursor-pointer"
          />
          <input
            type="text"
            value={activeStyle.bgColor}
            onChange={(e) => applyStyle({ bgColor: e.target.value })}
            className="input flex-1 text-xs"
          />
        </div>
      </div>

      {/* Background Opacity */}
      <div className="space-y-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">
          BG Opacity: {Math.round(activeStyle.bgOpacity * 100)}%
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={activeStyle.bgOpacity * 100}
          onChange={(e) => applyStyle({ bgOpacity: parseInt(e.target.value) / 100 })}
          className="w-full accent-accent"
        />
      </div>

      {/* Position */}
      <div className="space-y-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">Position</label>
        <div className="flex gap-1">
          {(['top', 'center', 'bottom'] as const).map((pos) => (
            <button
              key={pos}
              className={`btn flex-1 text-xs capitalize ${
                activeStyle.position === pos ? 'btn-primary' : 'btn-secondary'
              }`}
              onClick={() => applyStyle({ position: pos })}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      {/* Caption Mode */}
      <div className="space-y-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">Caption Mode</label>
        <div className="grid grid-cols-2 gap-1">
          {(['full-phrase', 'word-reveal', 'karaoke', 'single-word'] as const).map((mode) => (
            <button
              key={mode}
              className={`btn text-xs capitalize ${
                activeStyle.captionMode === mode ? 'btn-primary' : 'btn-secondary'
              }`}
              onClick={() => applyStyle({ captionMode: mode })}
            >
              {mode.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Word Reveal Fade (only shown in word-reveal mode) */}
      {activeStyle.captionMode === 'word-reveal' && (
        <div className="space-y-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider">
            Reveal Fade: {activeStyle.revealFadeMs ?? 0}ms
          </label>
          <input
            type="range"
            min={0}
            max={200}
            step={10}
            value={activeStyle.revealFadeMs ?? 0}
            onChange={(e) => applyStyle({ revealFadeMs: parseInt(e.target.value) })}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[9px] text-gray-600">
            <span>Instant</span>
            <span>Smooth</span>
          </div>
        </div>
      )}

      {/* Animation */}
      <div className="space-y-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">Animation</label>
        <div className="grid grid-cols-3 gap-1">
          {(['none', 'pop', 'fade', 'slide-up', 'karaoke', 'typewriter'] as const).map((anim) => (
            <button
              key={anim}
              className={`btn text-xs capitalize ${
                activeStyle.animation === anim ? 'btn-primary' : 'btn-secondary'
              }`}
              onClick={() => applyStyle({ animation: anim })}
            >
              {anim}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-1">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider">Preview</label>
        <div className="bg-black rounded p-4 flex items-center justify-center min-h-[80px]">
          <div
            className="text-center"
            style={{
              fontFamily: activeStyle.fontFamily,
              fontSize: `${Math.min(activeStyle.fontSize * 0.4, 32)}px`,
              color: activeStyle.color,
              backgroundColor: `${activeStyle.bgColor}${Math.round(activeStyle.bgOpacity * 255).toString(16).padStart(2, '0')}`,
              padding: '4px 8px',
              borderRadius: '4px'
            }}
          >
            Sample Caption Text
          </div>
        </div>
      </div>
    </div>
  )
}

export default StylePanel
