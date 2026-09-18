/**
 * relink.ts — Missing-media relink protocol (shared, pure).
 *
 * When a project load fails on missing media, main STASHES the failed load
 * (document + probed locations) under a one-time token and throws an Error
 * whose message carries that token — Electron IPC rejections only transport
 * `message`, never structured data. The renderer parses the token, opens the
 * RelinkDialog, and drives locate/scan/retry calls against it.
 *
 * Wire format: `MISSING_MEDIA:<token>\n<human detail>` where token is a UUID.
 * parseMissingMediaToken returns null for any other error (cancel, corrupt,
 * …) so unrelated failures never open the dialog.
 */

export const MISSING_MEDIA_PREFIX = 'MISSING_MEDIA:'

const TOKEN_PATTERN = /^MISSING_MEDIA:([0-9a-fA-F-]{8,64})\b/

/** Build the throwable message for a stashed relink session. */
export function formatMissingMediaError(token: string, detail: string): string {
  return `${MISSING_MEDIA_PREFIX}${token}\n${detail}`
}

/** Extract the relink token from a load failure message, or null. */
export function parseMissingMediaToken(message: string): string | null {
  const match = TOKEN_PATTERN.exec(message)
  return match ? match[1] : null
}

/** A single unresolvable asset as the dialog lists it. */
export interface RelinkMissingEntry {
  /** Asset id (.clipzu) or `clip:<id>` / `audio:<id>` (legacy .ecp). */
  id: string
  filename: string
  /** Every location probed, in order. */
  expected: string[]
}

export interface RelinkListResult {
  projectFile: string
  format: 'clipzu' | 'ecp-legacy'
  missing: RelinkMissingEntry[]
}
