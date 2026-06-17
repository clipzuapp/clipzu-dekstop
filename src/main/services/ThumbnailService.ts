import Database from 'better-sqlite3'
import { FFmpegService } from './FFmpegService'

/**
 * ThumbnailService - SQLite LRU cache for video frame thumbnails.
 * Uses better-sqlite3 (synchronous native SQLite) with WAL mode.
 * OOP class with constructor DI — no module-level mutable state.
 */

const MAX_CACHE_SIZE = 5000

export class ThumbnailService {
  private db: Database.Database | null = null

  constructor(
    private readonly dbPath: string,
    private readonly ffmpeg: FFmpegService
  ) {}

  /** Initialize database with WAL mode */
  private init(): Database.Database {
    if (this.db) return this.db

    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thumbnails (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        access_count INTEGER NOT NULL DEFAULT 1
      )
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_thumbnails_access
      ON thumbnails(access_count, created_at)
    `)

    return this.db
  }

  /** Get cached thumbnail or extract and cache it (async) */
  async getOrCreateThumbnail(clipPath: string, frameMs: number, width = 160): Promise<string> {
    const db = this.init()
    const key = `${clipPath}:${frameMs}`

    const row = db.prepare('SELECT data FROM thumbnails WHERE key = ?').get(key) as { data: string } | undefined
    if (row) {
      db.prepare('UPDATE thumbnails SET access_count = access_count + 1 WHERE key = ?').run(key)
      return row.data
    }

    const base64 = await this.ffmpeg.extractFrame(clipPath, frameMs, width)

    db.prepare(
      "INSERT OR REPLACE INTO thumbnails (key, data, created_at, access_count) VALUES (?, ?, strftime('%s','now'), 1)"
    ).run(key, base64)

    this.evictLRU()
    return base64
  }

  /** Get multiple thumbnails (strip of frames) */
  async getThumbnailStrip(
    clipPath: string, durationMs: number, frameCount = 10, width = 80
  ): Promise<string[]> {
    const interval = durationMs / frameCount
    const promises: Promise<string>[] = []
    for (let i = 0; i < frameCount; i++) {
      promises.push(this.getOrCreateThumbnail(clipPath, Math.round(i * interval), width))
    }
    return Promise.all(promises)
  }

  /** Evict oldest/least-accessed entries when over the max cache size */
  private evictLRU(): void {
    if (!this.db) return
    const row = this.db.prepare('SELECT COUNT(*) as count FROM thumbnails').get() as { count: number }
    if (row.count > MAX_CACHE_SIZE) {
      const deleteCount = row.count - Math.floor(MAX_CACHE_SIZE * 0.8)
      this.db.prepare(`
        DELETE FROM thumbnails WHERE key IN (
          SELECT key FROM thumbnails
          ORDER BY access_count ASC, created_at ASC
          LIMIT ?
        )
      `).run(deleteCount)
    }
  }

  /** Clear all cached thumbnails */
  clearCache(): void {
    const db = this.init()
    db.exec('DELETE FROM thumbnails; VACUUM')
  }

  /** Get cache statistics */
  getCacheStats(): { size: number; count: number } {
    const db = this.init()
    const row = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(LENGTH(data)), 0) as size FROM thumbnails').get() as { count: number; size: number }
    return { count: row.count, size: row.size }
  }

  /** Close the database connection */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
