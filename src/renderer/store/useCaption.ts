import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { parseSRT, type CaptionEntry } from '../../shared/utils/srt'
import { useTimeline, pushUndoSnapshot, type TextClip } from './useTimeline'
import { useToast } from './useToast'

export interface CaptionStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  strokeColor: string
  strokeWidth: number
  bgColor: string
  bgOpacity: number
  alignment: 'left' | 'center' | 'right'
  position: 'top' | 'center' | 'bottom'
  x: number
  y: number
  /** Rotation in degrees (0 = upright) */
  rotation: number
  /** Uniform scale multiplier (1.0 = native size) */
  scale: number
  animation: 'none' | 'pop' | 'fade' | 'slide-up' | 'karaoke' | 'typewriter'
  /** Word-level caption display mode (independent from entry animation) */
  captionMode: 'full-phrase' | 'word-reveal' | 'karaoke' | 'single-word'
  /** Smooth fade-in for words in word-reveal mode (ms). 0 = instant (default). 80-120ms recommended. */
  revealFadeMs?: number
}

interface CaptionState {
  status: 'idle' | 'transcribing' | 'done' | 'error'
  progress: number
  activeStyle: CaptionStyle
  language: string
  error: string | null
}

interface CaptionActions {
  transcribe: (audioPath: string, language?: string) => Promise<void>
  transcribeClip: (clipId: string, language?: string) => Promise<void>
  transcribeTrack: (trackIndex: number, language?: string) => Promise<void>
  transcribeTimeline: (language?: string) => Promise<void>
  cancelTranscription: () => Promise<void>
  editEntry: (id: string, text: string) => void
  deleteEntry: (id: string) => void
  duplicateEntry: (id: string) => void
  setEntryTiming: (id: string, startMs: number, endMs: number) => void
  applyStyle: (style: Partial<CaptionStyle>) => void
  importSRT: (content: string) => void
  selectEntry: (id: string | null) => void
  setLanguage: (language: string) => void
  clearCaptions: () => void
  loadCaptions: (data: { entries: CaptionEntry[]; style?: Partial<CaptionStyle>; language?: string }) => void
  setProgress: (progress: number) => void
  splitEntry: (id: string, splitAtMs: number) => void
  splitEntryWithText: (id: string, firstText: string, secondText: string, splitAtMs: number) => void
  mergeEntries: (id1: string, id2: string) => void
  reformatForShorts: () => void
  detectAndStoreSilences: (gapThresholdMs?: number) => Array<{ startMs: number; endMs: number; durationMs: number }>
}

const defaultStyle: CaptionStyle = {
  fontFamily: 'Inter',
  fontSize: 48,
  fontWeight: 500,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0,
  bgColor: '#000000',
  bgOpacity: 0.5,
  alignment: 'center',
  position: 'bottom',
  x: 50,
  y: 90,
  rotation: 0,
  scale: 1,
  animation: 'pop',
  captionMode: 'full-phrase',
  revealFadeMs: 0
}

const initialState: CaptionState = {
  status: 'idle',
  progress: 0,
  activeStyle: defaultStyle,
  language: 'auto',
  error: null
}

/** Module-level cleanup for whisper:progress listener to prevent leaks */
let whisperProgressCleanup: (() => void) | null = null

export const useCaption = create<CaptionState & CaptionActions>()(
  immer((set) => ({
    ...initialState,

    transcribe: async (audioPath: string, language?: string) => {
      set((state) => {
        state.status = 'transcribing'
        state.progress = 0
        state.error = null
      })

      // Clean up previous listener before registering a new one
      if (whisperProgressCleanup) {
        whisperProgressCleanup()
        whisperProgressCleanup = null
      }

      try {
        // Listen for progress updates
        const handler = (_event: any, percent: number) => {
          useCaption.getState().setProgress(percent)
        }
        whisperProgressCleanup = window.electron.ipcRenderer.on('whisper:progress', handler)

        const result = await window.electron.ipcRenderer.invoke(
          'whisper:transcribe',
          audioPath,
          language || 'auto',
          true
        ) as { entries?: CaptionEntry[]; language?: string }

        if (!result.entries || result.entries.length === 0) {
          useToast.getState().warning('Transcription produced no captions — check audio track or model.')
        }

        // Create TextClips from transcription result (same flow as transcribeClip)
        if (result.entries && result.entries.length > 0) {
          const { addTextClips } = useTimeline.getState()
          const activeStyle = useCaption.getState().activeStyle
          const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const newClips: TextClip[] = result.entries.map((entry, idx) => ({
            id: `text_${Date.now()}_${idx}`,
            startMs: entry.startMs,
            durationMs: entry.endMs - entry.startMs,
            endMs: entry.endMs,
            trackIndex: 0,
            text: entry.text,
            style: { ...activeStyle },
            words: entry.words,
            wordTimestampsSource: entry.wordTimestampsSource,
            sourceId: audioPath,
            sourceType: 'clip' as const,
            transcriptionJobId: jobId
          }))
          addTextClips(newClips)
          useToast.getState().success(`Transcription complete — ${newClips.length} captions`)
        }

        set((state) => {
          state.status = 'done'
          state.progress = 100
          state.language = result.language || language || 'auto'
        })

        // Auto-detect silence gaps and add timeline markers
        try {
          const { useTimeline } = await import('./useTimeline')
          const captionState = useCaption.getState()
          const silences = captionState.detectAndStoreSilences(1500)
          silences.forEach((s) => {
            useTimeline.getState().addMarker({
              timeMs: s.startMs,
              label: `Silence ${Math.round(s.durationMs / 100) / 10}s`,
              color: '#FF6B6B'
            })
          })
        } catch { /* non-critical */ }
      } catch (err) {
        set((state) => {
          state.status = 'error'
          state.error = (err as Error).message
        })
      } finally {
        if (whisperProgressCleanup) {
          whisperProgressCleanup()
          whisperProgressCleanup = null
        }
      }
    },

    cancelTranscription: async () => {
      await window.electron.ipcRenderer.invoke('whisper:cancel')
      set((state) => {
        state.status = 'idle'
        state.progress = 0
      })
    },

    transcribeClip: async (clipId: string, language?: string) => {
      const timeline = useTimeline.getState()
      const clip = timeline.clips.find((c) => c.id === clipId)
      if (!clip) {
        set((state) => {
          state.status = 'error'
          state.error = 'Clip not found'
        })
        return
      }

      set((state) => {
        state.status = 'transcribing'
        state.progress = 0
        state.error = null
      })

      if (whisperProgressCleanup) {
        whisperProgressCleanup()
        whisperProgressCleanup = null
      }

      try {
        const handler = (_event: any, percent: number) => {
          useCaption.getState().setProgress(percent)
        }
        whisperProgressCleanup = window.electron.ipcRenderer.on('whisper:progress', handler)

        const result = await window.electron.ipcRenderer.invoke(
          'whisper:transcribeFromTimeline',
          {
            type: 'clip',
            clipPath: clip.path,
            trimStartMs: clip.trimStart,
            trimEndMs: clip.trimEnd,
            sourceDurationMs: clip.sourceDurationMs,
            language: language || 'auto'
          }
        ) as { entries?: CaptionEntry[]; language?: string }

        // Create TextClips from transcription result in a single batch
        const { addTextClips } = useTimeline.getState()
        const activeStyle = useCaption.getState().activeStyle
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        
        if (result.entries) {
          const newClips: TextClip[] = result.entries.map((entry, idx) => ({
            id: `text_${Date.now()}_${idx}`,
            startMs: entry.startMs,
            durationMs: entry.endMs - entry.startMs,
            endMs: entry.endMs,
            trackIndex: 0,
            text: entry.text,
            style: { ...activeStyle },
            words: entry.words,
            wordTimestampsSource: entry.wordTimestampsSource,
            sourceId: clipId,
            sourceType: 'clip' as const,
            transcriptionJobId: jobId
          }))
          addTextClips(newClips)
        }

        if (!result.entries || result.entries.length === 0) {
          useToast.getState().warning('Transcription produced no captions — check audio track or model.')
        }

        set((state) => {
          state.status = 'done'
          state.progress = 100
          state.language = result.language || language || 'auto'
        })
      } catch (err) {
        set((state) => {
          state.status = 'error'
          state.error = (err as Error).message
        })
      } finally {
        if (whisperProgressCleanup) {
          whisperProgressCleanup()
          whisperProgressCleanup = null
        }
      }
    },

    transcribeTrack: async (trackIndex: number, language?: string) => {
      const timeline = useTimeline.getState()
      // Filter clips and audio tracks that belong to this track index
      const trackClips = timeline.clips.filter((c) => c.trackIndex === trackIndex)
      
      if (trackClips.length === 0) {
        set((state) => {
          state.status = 'error'
          state.error = 'No clips on this track to transcribe'
        })
        return
      }

      set((state) => {
        state.status = 'transcribing'
        state.progress = 0
        state.error = null
      })

      if (whisperProgressCleanup) {
        whisperProgressCleanup()
        whisperProgressCleanup = null
      }

      try {
        const handler = (_event: any, percent: number) => {
          useCaption.getState().setProgress(percent)
        }
        whisperProgressCleanup = window.electron.ipcRenderer.on('whisper:progress', handler)

        // Build mix sources scoped to this track only
        const mixSources = trackClips.map((c) => ({
          path: c.path, startMs: c.startMs, durationMs: c.durationMs
        }))
        const allPaths = trackClips.map((c) => c.path)

        const result = await window.electron.ipcRenderer.invoke(
          'whisper:transcribeFromTimeline',
          {
            type: 'timeline',
            mixPaths: allPaths,
            mixSources,
            language: language || 'auto'
          }
        ) as { entries?: CaptionEntry[]; language?: string }

        const { addTextClips } = useTimeline.getState()
        const activeStyle = useCaption.getState().activeStyle
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        
        if (result.entries) {
          const newClips: TextClip[] = result.entries.map((entry, idx) => ({
            id: `text_${Date.now()}_${idx}`,
            startMs: entry.startMs,
            durationMs: entry.endMs - entry.startMs,
            endMs: entry.endMs,
            trackIndex: 0,
            text: entry.text,
            style: { ...activeStyle },
            words: entry.words,
            wordTimestampsSource: entry.wordTimestampsSource,
            sourceId: `track_${trackIndex}`,
            sourceType: 'audioTrack' as const,
            transcriptionJobId: jobId
          }))
          addTextClips(newClips)
        }

        if (!result.entries || result.entries.length === 0) {
          useToast.getState().warning('Transcription produced no captions — check audio track or model.')
        }

        set((state) => {
          state.status = 'done'
          state.progress = 100
          state.language = result.language || language || 'auto'
        })
      } catch (err) {
        set((state) => {
          state.status = 'error'
          state.error = (err as Error).message
        })
      } finally {
        if (whisperProgressCleanup) {
          whisperProgressCleanup()
          whisperProgressCleanup = null
        }
      }
    },

    transcribeTimeline: async (language?: string) => {
      const timeline = useTimeline.getState()
      if (timeline.clips.length === 0 && timeline.audioTracks.length === 0) {
        set((state) => {
          state.status = 'error'
          state.error = 'No media on timeline to transcribe'
        })
        return
      }

      set((state) => {
        state.status = 'transcribing'
        state.progress = 0
        state.error = null
      })

      if (whisperProgressCleanup) {
        whisperProgressCleanup()
        whisperProgressCleanup = null
      }

      try {
        const handler = (_event: any, percent: number) => {
          useCaption.getState().setProgress(percent)
        }
        whisperProgressCleanup = window.electron.ipcRenderer.on('whisper:progress', handler)

        // Filter to voice-only tracks + video clip audio for transcription.
        // Music, SFX, and ambient tracks are excluded to avoid garbled captions.
        const clipAudioPaths = timeline.clips.map((c) => c.path)
        const voiceAudioPaths = timeline.audioTracks
          .filter((a) => a.role === 'voice')
          .map((a) => a.path)
        const allPaths = [...clipAudioPaths, ...voiceAudioPaths]

        // Build timing metadata for time-offset audio mixing
        const mixSources = [
          ...timeline.clips.map((c) => ({ path: c.path, startMs: c.startMs, durationMs: c.durationMs })),
          ...timeline.audioTracks
            .filter((a) => a.role === 'voice')
            .map((a) => ({ path: a.path, startMs: a.startMs, durationMs: a.durationMs }))
        ]

        const result = await window.electron.ipcRenderer.invoke(
          'whisper:transcribeFromTimeline',
          {
            type: 'timeline',
            mixPaths: allPaths,
            mixSources,
            language: language || 'auto'
          }
        ) as { entries?: CaptionEntry[]; language?: string }

        const { addTextClips } = useTimeline.getState()
        const activeStyle = useCaption.getState().activeStyle
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        
        if (result.entries) {
          const newClips: TextClip[] = result.entries.map((entry, idx) => ({
            id: `text_${Date.now()}_${idx}`,
            startMs: entry.startMs,
            durationMs: entry.endMs - entry.startMs,
            endMs: entry.endMs,
            trackIndex: 0,
            text: entry.text,
            style: { ...activeStyle },
            words: entry.words,
            wordTimestampsSource: entry.wordTimestampsSource,
            sourceId: 'timeline',
            sourceType: 'timeline' as const,
            transcriptionJobId: jobId
          }))
          addTextClips(newClips)
        }

        if (!result.entries || result.entries.length === 0) {
          useToast.getState().warning('Transcription produced no captions — check audio track or model.')
        }

        set((state) => {
          state.status = 'done'
          state.progress = 100
          state.language = result.language || language || 'auto'
        })
      } catch (err) {
        set((state) => {
          state.status = 'error'
          state.error = (err as Error).message
        })
      } finally {
        if (whisperProgressCleanup) {
          whisperProgressCleanup()
          whisperProgressCleanup = null
        }
      }
    },

    editEntry: (id, text) => {
      // updateTextClip already pushes undo snapshot
      useTimeline.getState().updateTextClip(id, { text })
    },

    deleteEntry: (id) => {
      // deleteTextClip already pushes undo snapshot
      useTimeline.getState().deleteTextClip(id)
    },

    duplicateEntry: (id) => {
      // addTextClip already pushes undo snapshot
      const timeline = useTimeline.getState()
      const orig = timeline.textClips.find((tc) => tc.id === id)
      if (!orig) return
      const newClip: TextClip = {
        ...orig,
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        startMs: orig.endMs + 50,
        durationMs: orig.durationMs,
        endMs: orig.endMs + 50 + orig.durationMs,
        style: orig.style ? { ...orig.style } : undefined,
        words: orig.words ? orig.words.map((w) => ({ ...w })) : undefined
      }
      timeline.addTextClip(newClip)
      timeline.selectTextClip(newClip.id)
    },

    setEntryTiming: (id, startMs, endMs) => {
      // updateTextClip already pushes undo snapshot
      useTimeline.getState().updateTextClip(id, {
        startMs,
        durationMs: endMs - startMs,
        endMs
      })
    },

    applyStyle: (style) =>
      set((state) => {
        Object.assign(state.activeStyle, style)
      }),

    importSRT: (content) => {
      const parsedEntries = parseSRT(content)
      const activeStyle = useCaption.getState().activeStyle
      const batch: TextClip[] = parsedEntries.map((entry, idx) => ({
        id: `text_${Date.now()}_${idx}`,
        startMs: entry.startMs,
        durationMs: entry.endMs - entry.startMs,
        endMs: entry.endMs,
        trackIndex: 0,
        text: entry.text,
        style: { ...activeStyle },
        sourceType: 'import' as const
      }))
      // Single undo snapshot + single Zustand commit for all entries
      useTimeline.getState().addTextClips(batch)
      set((state) => { state.status = 'done' })
    },

    selectEntry: (id) => {
      useTimeline.getState().selectTextClip(id)
    },

    setLanguage: (language) =>
      set((state) => {
        state.language = language
      }),

    clearCaptions: () => {
      pushUndoSnapshot()
      set((state) => {
        state.status = 'idle'
        state.progress = 0
        state.error = null
      })
      useTimeline.setState({ textClips: [] })
    },

    loadCaptions: (data) => {
      set((state) => {
        if (data.style) Object.assign(state.activeStyle, data.style)
        if (data.language) state.language = data.language
      })
      // TextClips are loaded separately via useTimeline.loadTimeline
    },

    setProgress: (progress) =>
      set((state) => {
        state.progress = progress
      }),

    splitEntry: (id, splitAtMs) => {
      // splitTextClip already pushes undo snapshot
      useTimeline.getState().splitTextClip(id, splitAtMs)
    },

    splitEntryWithText: (id, firstText, secondText, splitAtMs) => {
      pushUndoSnapshot()
      useTimeline.getState().splitTextClip(id, splitAtMs)
      // Re-read fresh state AFTER split — the previous snapshot is stale
      const timeline = useTimeline.getState()
      const parts = timeline.textClips.filter((tc) => tc.id.startsWith(`${id}_`))
      if (parts.length >= 2) {
        timeline.updateTextClipLive(parts[0].id, { text: firstText })
        timeline.updateTextClipLive(parts[1].id, { text: secondText })
        timeline.selectTextClip(parts[1].id)
      }
    },

    mergeEntries: (id1, id2) => {
      pushUndoSnapshot()
      const timeline = useTimeline.getState()
      const a = timeline.textClips.find((tc) => tc.id === id1)
      const b = timeline.textClips.find((tc) => tc.id === id2)
      if (!a || !b) return

      // Normalize b's word timestamps to be relative to the merged clip's startMs
      const bOffset = b.startMs - a.startMs
      const mergedWords: TextClip['words'] = [
        ...(a.words ?? []),
        ...(b.words ?? []).map((w) => ({
          ...w,
          startMs: w.startMs + bOffset,
          endMs: w.endMs + bOffset
        }))
      ]

      // Preserve wordTimestampsSource: whisper wins over synthetic
      const mergedSource: TextClip['wordTimestampsSource'] =
        a.wordTimestampsSource === 'whisper' || b.wordTimestampsSource === 'whisper'
          ? 'whisper'
          : a.wordTimestampsSource ?? b.wordTimestampsSource

      const mergedId = `${id1}_merged`
      const mergedClip: TextClip = {
        id: mergedId,
        startMs: Math.min(a.startMs, b.startMs),
        durationMs: Math.max(a.endMs, b.endMs) - Math.min(a.startMs, b.startMs),
        endMs: Math.max(a.endMs, b.endMs),
        trackIndex: a.trackIndex,
        text: `${a.text} ${b.text}`.trim(),
        style: a.style,
        words: mergedWords.length > 0 ? mergedWords : undefined,
        wordTimestampsSource: mergedSource,
        sourceId: a.sourceId ?? b.sourceId,
        sourceType: a.sourceType ?? b.sourceType,
        transcriptionJobId: a.transcriptionJobId ?? b.transcriptionJobId
      }
      // Atomic: add merged + remove originals + select in one setState (no extra snapshots)
      useTimeline.setState((state) => {
        state.textClips = state.textClips
          .filter((tc) => tc.id !== id1 && tc.id !== id2)
        state.textClips.push(mergedClip)
        state.selectedTextClipId = mergedId
      })
    },

    reformatForShorts: () => {
      pushUndoSnapshot()
      const timeline = useTimeline.getState()
      const clips = [...timeline.textClips].sort((a, b) => a.startMs - b.startMs)

      const newClips: TextClip[] = []

      for (const clip of clips) {
        // --- PATH A: Real word timestamps — one clip per word, timecode-driven ---
        if (clip.words && clip.words.length > 0) {
          const words = clip.words

          for (let i = 0; i < words.length; i++) {
            const w = words[i]
            newClips.push({
              id: `${clip.id}_short_${i}`,
              startMs: Math.round(clip.startMs + w.startMs),
              durationMs: Math.round(w.endMs - w.startMs),
              endMs: Math.round(clip.startMs + w.endMs),
              trackIndex: clip.trackIndex,
              text: w.word,
              style: clip.style,
              words: [{ ...w, startMs: 0, endMs: w.endMs - w.startMs }],
              wordTimestampsSource: clip.wordTimestampsSource ?? undefined,
              sourceId: clip.sourceId,
              sourceType: clip.sourceType,
              transcriptionJobId: clip.transcriptionJobId
            })
          }
          continue
        }

        // --- PATH B: No word timestamps — split text by spaces equally across duration ---
        const textWords = clip.text.trim().split(/\s+/).filter(Boolean)
        if (textWords.length === 0) continue

        const durationMs = clip.endMs - clip.startMs
        const msPerWord = durationMs / textWords.length
        for (let i = 0; i < textWords.length; i++) {
          newClips.push({
            id: `${clip.id}_short_${i}`,
            startMs: Math.round(clip.startMs + i * msPerWord),
            durationMs: Math.round(msPerWord),
            endMs: Math.round(clip.startMs + (i + 1) * msPerWord),
            trackIndex: clip.trackIndex,
            text: textWords[i],
            style: clip.style,
            wordTimestampsSource: clip.wordTimestampsSource ?? undefined,
            sourceId: clip.sourceId,
            sourceType: clip.sourceType,
            transcriptionJobId: clip.transcriptionJobId
          })
        }
      }

      useTimeline.setState({ textClips: newClips })
    },

    detectAndStoreSilences: (gapThresholdMs = 1500) => {
      const clips = [...useTimeline.getState().textClips].sort((a, b) => a.startMs - b.startMs)
      const silences: Array<{ startMs: number; endMs: number; durationMs: number }> = []

      for (let i = 0; i < clips.length - 1; i++) {
        const gapStart = clips[i].endMs
        const gapEnd = clips[i + 1].startMs
        const gapDuration = gapEnd - gapStart
        if (gapDuration >= gapThresholdMs) {
          silences.push({ startMs: gapStart, endMs: gapEnd, durationMs: gapDuration })
        }
      }

      return silences
    }
  }))
)
