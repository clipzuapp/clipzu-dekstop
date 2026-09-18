/**
 * concurrency.ts — Bounded-parallelism primitives (Phase 8, task.txt).
 *
 * Pure, zero-dependency. Importable from main, renderer, and tests.
 *
 * Problem fixed: thumbnail strips, media imports, waveform extraction, and
 * proxy generation fanned out N parallel ffmpeg spawns with no limit (one
 * import of 500 images = 500 concurrent ffmpeg processes). Every fan-out now
 * goes through a limiter.
 */

/** A function that runs `task` when a slot frees, resolving with its result. */
export type LimitedRun = <T>(task: () => Promise<T>) => Promise<T>

/**
 * Create a concurrency limiter allowing at most `maxConcurrent` tasks in
 * flight. Additional tasks queue FIFO. Rejections propagate to the caller
 * only; the limiter never breaks (a settled slot always releases).
 */
export function createLimiter(maxConcurrent: number): LimitedRun {
  const max = Math.max(1, Math.floor(maxConcurrent))
  let inFlight = 0
  const queue: Array<() => void> = []

  const release = (): void => {
    inFlight -= 1
    const next = queue.shift()
    if (next) {
      inFlight += 1
      next()
    }
  }

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        task().then(
          (value) => {
            release()
            resolve(value)
          },
          (err: unknown) => {
            release()
            reject(err)
          }
        )
      }
      if (inFlight < max) {
        inFlight += 1
        run()
      } else {
        queue.push(run)
      }
    })
}

/**
 * Map `items` through async `fn` with at most `maxConcurrent` in flight.
 * Results keep input order. Rejects on the first failure (like Promise.all).
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  maxConcurrent: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = createLimiter(maxConcurrent)
  return Promise.all(items.map((item, index) => limit(() => fn(item, index))))
}

/** Default ceiling for ffmpeg/media fan-out (tuned for 4-8 core desktops). */
export const MEDIA_FANOUT_LIMIT = 4
