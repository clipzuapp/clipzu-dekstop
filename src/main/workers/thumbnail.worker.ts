import { parentPort, workerData } from 'worker_threads'
import { spawn } from 'child_process'

/**
 * Thumbnail worker - Extracts video frame thumbnails in separate thread
 * Prevents main thread blocking during FFmpeg frame extraction
 */

interface ThumbnailWorkerData {
  ffmpegPath: string
  filePath: string
  frameMs: number
  width: number
}

async function extractFrame(): Promise<void> {
  const data = workerData as ThumbnailWorkerData

  if (!parentPort) {
    throw new Error('Worker must be run from a worker thread')
  }

  const port = parentPort
  const timeSec = data.frameMs / 1000

  try {
    const args = [
      '-ss', timeSec.toString(),
      '-i', data.filePath,
      '-vframes', '1',
      '-vf', `scale=${data.width}:-1`,
      '-f', 'image2pipe',
      '-vcodec', 'png',
      'pipe:1'
    ]

    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn(data.ffmpegPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })

      const chunks: Buffer[] = []
      let stderr = ''

      proc.stdout?.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('close', (code: number | null) => {
        if (code === 0 && chunks.length > 0) {
          const buffer = Buffer.concat(chunks)
          resolve(buffer.toString('base64'))
        } else {
          reject(new Error(`Frame extraction failed: ${stderr.slice(-200)}`))
        }
      })

      proc.on('error', (err: Error) => {
        reject(new Error(`Spawn error: ${err.message}`))
      })
    })

    port.postMessage({ type: 'result', data: result })
  } catch (err) {
    port.postMessage({
      type: 'error',
      error: (err as Error).message || 'Unknown extraction error'
    })
  }
}

extractFrame().catch((err) => {
  if (parentPort) {
    parentPort.postMessage({ type: 'error', error: err.message })
  }
})
