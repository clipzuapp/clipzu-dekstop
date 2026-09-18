/**
 * encoding.ts — Global UTF-8 policy helpers (Phase 9, task.txt).
 *
 * Pure, zero-dependency. Importable from main, renderer, preload, and tests.
 *
 * Policy:
 * - All text read/written with explicit 'utf-8' (call sites pass the encoding;
 *   these helpers normalize the CONTENT).
 * - Byte-stream decoding must never split multi-byte sequences mid-character:
 *   Node call sites use StringDecoder (see FFmpegService/WhisperService);
 *   these helpers cover the string-level half (BOM, line endings, NFC).
 * - Hash inputs are NFC-normalized BEFORE hashing so the same file hashes
 *   identically on macOS (NFD) and Windows (NFC).
 */

/** Strip a leading UTF-8 BOM if present. Idempotent. */
export function stripBOM(content: string): string {
  return content.length > 0 && content.charCodeAt(0) === 0xfeff
    ? content.slice(1)
    : content
}

/** Normalize all line endings to LF. Idempotent. */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Prepare foreign text (SRT/VTT captions, project JSON, whisper JSON) for
 * parsing: strip BOM + normalize line endings. Never throws.
 */
export function normalizeImportedText(content: string): string {
  return normalizeLineEndings(stripBOM(content))
}

/** NFC-normalize a string (no-op for already-normalized input). */
export function normalizeNFC(value: string): string {
  return value.normalize('NFC')
}

/**
 * UTF-8 byte length of a string (NOT UTF-16 code units). Size guards MUST use
 * this: CJK/emoji take 2-4x more bytes than `.length` reports, so a `.length`
 * guard under-protects by that factor.
 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Returns true if decoding `bytes` as UTF-8 round-trips cleanly (no U+FFFD
 * replacement). Use to detect files saved in a legacy single-byte encoding
 * before JSON.parse/SRT parse mangles them silently.
 */
export function isCleanUtf8(bytes: Uint8Array): boolean {
  return !new TextDecoder('utf-8', { fatal: false }).decode(bytes).includes('�')
}
