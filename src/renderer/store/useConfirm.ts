import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
}

interface ConfirmState {
  isOpen: boolean
  options: ConfirmOptions | null
  /** Resolve function held in closure until user responds */
  _resolve: ((value: boolean) => void) | null
  show: (options: ConfirmOptions) => Promise<boolean>
  _close: (result: boolean) => void
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  isOpen: false,
  options: null,
  _resolve: null,

  show: (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      set({ isOpen: true, options, _resolve: resolve })
    })
  },

  _close: (result: boolean) => {
    const { _resolve } = get()
    set({ isOpen: false, options: null, _resolve: null })
    if (_resolve) _resolve(result)
  }
}))
