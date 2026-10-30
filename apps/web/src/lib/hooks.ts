import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get } from './api';

export interface Query<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  refetch: () => Promise<void>;
  setData: (fn: (d: T | undefined) => T | undefined) => void;
}

/** Minimal data-fetching hook (no extra dependency). Re-fetches when the path changes. */
export function useApi<T = any>(path: string | null): Query<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    try {
      const d = await get<T>(path, c.signal);
      if (!c.signal.aborted) { setDataState(d); setError(null); }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'error', String(e)));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [path]);

  useEffect(() => { void load(); return () => ctrl.current?.abort(); }, [load]);
  const setData = useCallback((fn: (d: T | undefined) => T | undefined) => setDataState(fn), []);
  return { data, error, loading, refetch: load, setData };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts.pop()!;
    const mod = parts.includes('mod');
    const shift = parts.includes('shift');
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key) return;
      if (mod !== (e.metaKey || e.ctrlKey)) return;
      if (shift !== e.shiftKey) return;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, enabled]);
}
