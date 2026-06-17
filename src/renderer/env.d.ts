/// <reference types="vite/client" />

interface ElectronAPI {
  ipcRenderer: {
    invoke: (channel: string, ...args: any[]) => Promise<any>
    on: (channel: string, listener: (event: any, ...args: any[]) => void) => () => void
    send: (channel: string, ...args: any[]) => void
    removeAllListeners: (channel: string) => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
