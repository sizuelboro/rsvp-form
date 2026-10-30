import { useEffect, useState } from 'react';
import { Input } from '../../components/ui';

/**
 * Keeps a local draft while typing and only commits a valid https:// URL (or empty) on blur/Enter,
 * so partially typed URLs are never wiped by validation.
 */
export function UrlInput({ value, onCommit, placeholder = 'https://', className, allowHttp = false }: { value: string | undefined; onCommit: (v: string | undefined) => void; placeholder?: string; className?: string; allowHttp?: boolean }) {
  const [draft, setDraft] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  const commit = () => {
    const v = draft.trim();
    if (!v) { setInvalid(false); onCommit(undefined); return; }
    try {
      const u = new URL(v);
      const ok = u.protocol === 'https:' || (allowHttp && u.protocol === 'http:');
      setInvalid(!ok);
      if (ok) onCommit(u.toString());
    } catch { setInvalid(true); }
  };
  return <Input value={draft} placeholder={placeholder} aria-invalid={invalid} className={className} onChange={(e) => { setDraft(e.target.value); setInvalid(false); }} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}
