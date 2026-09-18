/**
 * testSetup.ts — Node harness globals for Electron-runtime lifecycle tests.
 *
 * Imported FIRST so the stub exists before any store module evaluates.
 * Stores only touch window.electron inside actions (transcribe/notify paths
 * this harness never invokes); the stub keeps those paths inert if reached.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any
if (!g.window) {
  g.window = {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    crypto: require('node:crypto').webcrypto,
    electron: {
      ipcRenderer: {
        invoke: async () => null,
      },
    },
  }
}
if (!g.Audio) {
  g.Audio = class {
    ended = true
    paused = true
    volume = 0.5
    onended: (() => void) | null = null
    async play(): Promise<void> {}
  }
}

export {}
