/**
 * NotificationSound — Lightweight UI sound player for toast notifications
 * and other app events. Uses HTMLAudioElement (not Web Audio API) to avoid
 * interfering with the timeline AudioEngine.
 *
 * Sound files are resolved via IPC from assets/sfx/ directory.
 * Paths are cached after first resolution to avoid repeated IPC calls.
 *
 * SSOT: All notification sounds go through this module.
 */

/** Maps toast/event types to sound names resolved by sfx:getNotificationSound IPC */
const SOUND_MAP: Record<string, string> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
  click: 'click',
  delete: 'delete',
  save: 'save'
}

/** Cached absolute paths: soundName → filePath */
const _pathCache = new Map<string, string | null>()

/** Max simultaneous plays of the same sound (overlap prevention) */
const MAX_OVERLAP = 2

/** Active Audio instances per sound name */
const _active = new Map<string, HTMLAudioElement[]>()

/**
 * Resolve the file path for a sound name (cached after first call).
 */
async function resolvePath(soundName: string): Promise<string | null> {
  const cached = _pathCache.get(soundName)
  if (cached !== undefined) return cached

  const path = await window.electron.ipcRenderer.invoke('sfx:getNotificationSound', soundName) as string | null
  _pathCache.set(soundName, path)
  return path
}

/**
 * Play a notification sound by event name.
 * Non-blocking — returns immediately. Sound plays asynchronously.
 *
 * @param eventName - One of: 'success' | 'error' | 'warning' | 'info' | 'click' | 'delete' | 'save'
 */
export async function playNotification(eventName: string): Promise<void> {
  const soundName = SOUND_MAP[eventName]
  if (!soundName) return

  try {
    const filePath = await resolvePath(soundName)
    if (!filePath) return

    // Clean up finished instances
    const activeList = _active.get(soundName) ?? []
    const live = activeList.filter((a) => !a.ended && !a.paused)
    _active.set(soundName, live)

    // Prevent overlap spam
    if (live.length >= MAX_OVERLAP) return

    const audio = new Audio(`file://${filePath}`)
    audio.volume = 0.5 // Keep UI sounds subtle
    _active.set(soundName, [...live, audio])

    audio.onended = (): void => {
      const list = _active.get(soundName) ?? []
      _active.set(soundName, list.filter((a) => a !== audio))
    }

    await audio.play()
  } catch {
    // Notification sounds are best-effort — never throw
  }
}

/**
 * Pre-load all notification sounds for instant playback.
 * Call once at app startup after the first user interaction
 * (browsers require user gesture before audio playback).
 */
export async function preloadSounds(): Promise<void> {
  const names = Object.keys(SOUND_MAP)
  await Promise.allSettled(names.map(resolvePath))
}
