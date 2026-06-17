/**
 * Shared formatting utilities — Single Source of Truth
 * Used by all renderer components that display time/duration
 */

/**
 * Format milliseconds to M:SS.mm (for Timeline ruler, CaptionEditor entries)
 */
export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  const millis = Math.floor((ms % 1000) / 10)
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(2, '0')}`
}

/**
 * Format milliseconds to M:SS (for duration labels in Preview, MediaPanel, ExportDialog)
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
