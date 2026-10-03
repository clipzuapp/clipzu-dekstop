import { create } from 'zustand'

export interface ConfirmInputSpec {
  /** Pre-filled value shown when the dialog opens. */
  initialValue?: string
  /** Placeholder when the field is empty. */
  placeholder?: string
}

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  /**
   * When present, the dialog renders a text input (P1.5 rename dialogs).
   * Confirm resolves via showWithInput; plain show() ignores the field.
   */
  input?: ConfirmInputSpec
}

interface ConfirmState {
  isOpen: boolean
  options: ConfirmOptions | null
  /** Resolve function held in closure until user responds */
  _resolve: ((value: boolean) => void) | null
  /** Resolve function for input-mode dialogs (string|null). */
  _resolveInput: ((value: string | null) => void) | null
  show: (options: ConfirmOptions) => Promise<boolean>
  /**
   * Input-mode dialog (P1.5): resolves with the trimmed field value, or
   * null when cancelled. Empty-string submissions resolve null (no-op),
   * so callers only need a null check.
   */
  showWithInput: (options: ConfirmOptions & { input: ConfirmInputSpec }) => Promise<string | null>
  _close: (result: boolean) => void
  _closeWithInput: (value: string | null) => void
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  isOpen: false,
  options: null,
  _resolve: null,
  _resolveInput: null,

  show: (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      set({ isOpen: true, options, _resolve: resolve, _resolveInput: null })
    })
  },

  showWithInput: (options: ConfirmOptions & { input: ConfirmInputSpec }): Promise<string | null> => {
    return new Promise((resolve) => {
      set({ isOpen: true, options, _resolve: null, _resolveInput: resolve })
    })
  },

  _close: (result: boolean) => {
    const { _resolve } = get()
    set({ isOpen: false, options: null, _resolve: null, _resolveInput: null })
    if (_resolve) _resolve(result)
  },

  _closeWithInput: (value: string | null) => {
    const { _resolveInput } = get()
    set({ isOpen: false, options: null, _resolve: null, _resolveInput: null })
    if (_resolveInput) _resolveInput(value)
  },
}))
