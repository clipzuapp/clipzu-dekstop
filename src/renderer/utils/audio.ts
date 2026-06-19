/**
 * Audio utility helpers — dB ↔ linear conversion.
 * SSOT for all volume slider ↔ store mapping.
 *
 * dB scale: 0 dB = unity gain (linear 1.0)
 *           +6 dB = 2× amplitude (linear 2.0, boost cap)
 *           -30 dB ≈ 0.032 (near-silence floor)
 *           -∞ dB = 0.0 (silence, clamped separately)
 */

const DB_MIN = -30
const DB_MAX = 6

/** Convert dB to linear amplitude (0.0–2.0). Values below DB_MIN clamp to 0. */
export function dbToLinear(db: number): number {
  if (db <= DB_MIN) return 0
  return Math.pow(10, db / 20)
}

/** Convert linear amplitude (0.0–2.0) to dB. 0 → -∞ (clamped to DB_MIN). */
export function linearToDb(linear: number): number {
  if (linear <= 0) return DB_MIN
  const db = 20 * Math.log10(linear)
  return Math.max(DB_MIN, Math.min(DB_MAX, db))
}

/** Format a dB value for display (e.g. "0.0 dB", "-6.5 dB", "--∞ dB" for silence). */
export function formatDb(db: number): string {
  if (db <= DB_MIN) return '-\u221E dB'
  return `${db.toFixed(1)} dB`
}
