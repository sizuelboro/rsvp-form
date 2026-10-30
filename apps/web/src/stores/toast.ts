import { create } from 'zustand';
import { ApiError } from '../lib/api';

export interface Toast { id: number; title: string; description?: string; tone: 'default' | 'success' | 'error'; action?: { label: string; onClick: () => void } }

interface ToastState { toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }

let seq = 0;
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === 'error' ? 6500 : 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'success' }),
  error: (e: unknown, fallback = 'Something went wrong') => {
    const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback;
    const description = e instanceof ApiError && e.code === 'upgrade_required' ? 'Upgrade your plan in Settings → Billing to unlock this.' : e instanceof ApiError && e.code === 'limit_reached' ? 'Upgrade your plan or remove items to continue.' : undefined;
    useToasts.getState().push({ title: msg, description, tone: 'error' });
  },
  info: (title: string, description?: string) => useToasts.getState().push({ title, description, tone: 'default' }),
};
