import { useEffect, useRef } from 'react';
import { ApiError, patch } from '../../lib/api';
import { useEditor } from './store';

const DEBOUNCE_MS = 900;
const MAX_BACKOFF_MS = 30_000;

/**
 * Autosave with:
 *  - debouncing (waits for a pause in editing),
 *  - serialization (only one request in flight; edits made meanwhile trigger a follow-up save),
 *  - retry with exponential backoff on network/server errors,
 *  - conflict protection via optimistic concurrency (baseRevision → 409 → user chooses).
 */
export function useAutosave(path: string | null) {
  const changeSeq = useEditor((s) => s.changeSeq);
  const saveState = useEditor((s) => s.saveState);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const attempt = useRef(0);

  const save = useRef<() => Promise<void>>(async () => undefined);
  save.current = async () => {
    const st = useEditor.getState();
    if (!path || !st.schema || inFlight.current || st.saveState === 'conflict') return;
    if (st.changeSeq === st.savedSeq) return;
    inFlight.current = true;
    const seq = st.changeSeq;
    st.markSaving();
    try {
      const res = await patch<{ revision: number }>(path, { schema: st.schema, baseRevision: st.revision });
      attempt.current = 0;
      useEditor.getState().markSaved(res.revision, seq);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.details?.schema) {
        useEditor.getState().markConflict({ revision: e.details.revision, schema: e.details.schema });
      } else if (e instanceof ApiError && e.status === 422) {
        // Invalid schema is a client bug; surface it rather than retrying forever.
        useEditor.getState().markFailed(e.details?.[0]?.message ? `${e.message}: ${e.details[0].message}` : e.message);
      } else {
        useEditor.getState().markFailed(e instanceof Error ? e.message : 'Save failed');
        attempt.current++;
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt.current - 1));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void save.current(), delay);
      }
    } finally {
      inFlight.current = false;
      const now = useEditor.getState();
      if (now.saveState === 'unsaved' && now.changeSeq !== now.savedSeq) {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void save.current(), DEBOUNCE_MS);
      }
    }
  };

  useEffect(() => {
    const st = useEditor.getState();
    if (st.changeSeq === st.savedSeq || st.saveState === 'conflict') return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save.current(), DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [changeSeq]);

  // Warn before closing the tab with unsaved changes; flush when the tab is hidden.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useEditor.getState();
      if (s.changeSeq !== s.savedSeq) { e.preventDefault(); e.returnValue = ''; }
    };
    const onHide = () => { if (document.visibilityState === 'hidden') void save.current(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); document.removeEventListener('visibilitychange', onHide); };
  }, []);

  return { saveNow: () => { clearTimeout(timer.current); attempt.current = 0; return save.current(); }, saveState };
}
