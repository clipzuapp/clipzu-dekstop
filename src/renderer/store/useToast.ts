import { create } from 'zustand'
import { playNotification } from '../services/NotificationSound'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  createdAt: number
}

interface ToastState {
  toasts: ToastItem[]
  toast: (message: string, type?: ToastType) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
  dismiss: (id: string) => void
}

let nextId = 0

const MAX_VISIBLE = 3
const AUTO_DISMISS_MS = 3000

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],

  toast: (message: string, type: ToastType = 'info') => {
    const id = `toast-${++nextId}`
    const item: ToastItem = { id, type, message, createdAt: Date.now() }

    set((s) => {
      const trimmed = s.toasts.length >= MAX_VISIBLE
        ? s.toasts.slice(s.toasts.length - (MAX_VISIBLE - 1))
        : s.toasts
      return { toasts: [...trimmed, item] }
    })

    // Play notification sound (non-blocking, best-effort)
    playNotification(type)

    setTimeout(() => {
      get().dismiss(id)
    }, AUTO_DISMISS_MS)
  },

  success: (message: string) => get().toast(message, 'success'),
  error: (message: string) => get().toast(message, 'error'),
  warning: (message: string) => get().toast(message, 'warning'),
  info: (message: string) => get().toast(message, 'info'),

  dismiss: (id: string) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }
}))
