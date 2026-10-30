import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { renderSVG } from 'uqr';
import { AlertTriangle, CheckCircle2, Copy, Download, ExternalLink, Globe, Lock, Mail, Ticket } from 'lucide-react';
import { ApiError, patch, post } from '../../lib/api';
import { Badge, Button, Dialog, Field, Input, Select, Segmented, Textarea } from '../../components/ui';
import { toast } from '../../stores/toast';
import { useEditor } from './store';
import { fmtDateTime, isoToLocalInput, localInputToIso, browserTz } from '../../lib/format';

function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} className="font-mono text-[12.5px]" />
      <Button icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(value); toast.success('Copied'); }}>Copy</Button>
    </div>
  );
}

export function ShareContent({ url, title }: { url: string; title: string }) {
  const svg = renderSVG(url, { border: 2 });
  const embed = `<iframe src="${url}" title="${title.replace(/"/g, '&quot;')}" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>`;
  const enc = encodeURIComponent;
  const shares = [
    ['WhatsApp', `https://wa.me/?text=${enc(`${title} ${url}`)}`],
    ['X', `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`],
    ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`],
  ];
  const downloadQr = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = 'form-qr.svg';
    a.click();
  };
  return (
    <div className="space-y-5">
      <Field label="Public link"><CopyField value={url} label="Public link" /></Field>
      <div className="grid sm:grid-cols-[150px_1fr] gap-5 items-start">
        <div className="text-center">
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="QR code for the form" className="size-[150px] rounded-lg border border-line bg-white p-1" />
          <Button size="sm" variant="ghost" className="mt-1" icon={<Download className="size-3.5" />} onClick={downloadQr}>Download QR</Button>
        </div>
        <div className="space-y-4">
          <Field label="Embed on your website" hint="Paste into any HTML page or website builder."><Textarea readOnly rows={3} value={embed} className="font-mono text-[11.5px]" onFocus={(e) => e.target.select()} /></Field>
          <div>
            <p className="label">Share</p>
            <div className="flex flex-wrap gap-2">
              {shares.map(([name, href]) => <a key={name} href={href} target="_blank" rel="noopener noreferrer"><Button size="sm">{name}</Button></a>)}
              <a href={`mailto:?subject=${enc(title)}&body=${enc(url)}`}><Button size="sm" icon={<Mail className="size-3.5" />}>Email</Button></a>
              <a href={url} target="_blank" rel="noopener noreferrer"><Button size="sm" icon={<ExternalLink className="size-3.5" />}>Open</Button></a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PublishDialog({ open, onOpenChange, path, flush }: { open: boolean; onOpenChange: (v: boolean) => void; path: string; flush: () => Promise<void> }) {
  const meta = useEditor((s) => s.meta)!;
  const setMeta = useEditor((s) => s.setMeta);
  const title = useEditor((s) => s.schema!.form.title);
  const [state, setState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const url = `${location.origin}/f/${meta.slug}`;

  useEffect(() => { if (open) { setState('idle'); setIssues([]); setError(null); } }, [open]);

  const publish = async () => {
    setState('publishing');
    try {
      await flush();
      if (useEditor.getState().saveState === 'conflict') throw new ApiError(409, 'conflict', 'Resolve the editing conflict before publishing');
      const r = await post<{ version: number; versionId: string; publishedAt: string; unchanged?: boolean }>(`${path}/publish`);
      setMeta({ status: 'published', hasUnpublishedChanges: false, published: { id: r.versionId, version: r.version ?? meta.published?.version ?? 1, published_at: r.publishedAt ?? new Date().toISOString() } });
      setState('done');
    } catch (e) {
      setState('error');
      if (e instanceof ApiError && e.code === 'invalid_schema' && Array.isArray(e.details)) setIssues(e.details);
      setError(e instanceof ApiError ? e : new ApiError(0, 'error', String(e)));
    }
  };

  const AccessIcon = meta.access === 'public' ? Globe : meta.access === 'password' ? Lock : Ticket;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={state === 'done' ? 'Your form is live' : 'Publish form'}
      description={state === 'done' ? 'Share it anywhere. Future edits stay in draft until you publish again.' : 'Publishing creates a new immutable version. Existing responses keep pointing at the version they answered.'}
      footer={state === 'done' ? <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button> : <><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={state === 'publishing'} onClick={publish}>{meta.published ? `Publish version ${meta.published.version + 1}` : 'Publish'}</Button></>}>
      {state === 'done' ? (
        <div>
          <div className="flex items-center gap-2 mb-5 text-[13px]"><CheckCircle2 className="size-4 text-success" />Version {meta.published?.version} published<Badge tone="neutral"><AccessIcon className="size-3" />{meta.access === 'public' ? 'Public' : meta.access === 'password' ? 'Password protected' : 'Invitation only'}</Badge></div>
          {meta.access === 'invite_only'
            ? <p className="text-[13px] text-ink-2">This form only accepts guests with a personal invitation link. Send invitations from the linked event’s Guests tab.{meta.events[0] && <> <Link className="text-brand-600 font-medium" to={`/events/${meta.events[0].id}`}>Open {meta.events[0].name}</Link></>}</p>
            : <ShareContent url={url} title={title} />}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-line p-3.5 flex items-center gap-3 text-[13px]">
            <AccessIcon className="size-4 text-muted" />
            <div className="flex-1"><p className="font-medium">{meta.access === 'public' ? 'Anyone with the link' : meta.access === 'password' ? 'Anyone with the link and password' : 'Invited guests only'}</p><p className="text-muted text-[12.5px]">/f/{meta.slug}{meta.closes_at ? ` · closes ${fmtDateTime(meta.closes_at)}` : ''}</p></div>
          </div>
          {meta.published && <p className="text-[12.5px] text-muted">Currently live: version {meta.published.version}, published {fmtDateTime(meta.published.published_at)}.</p>}
          {state === 'error' && error && (
            <div className="rounded-lg border border-danger/25 bg-danger-50 p-3.5 text-[13px]">
              <p className="font-medium text-danger flex items-center gap-2"><AlertTriangle className="size-4" />{error.message}</p>
              {error.code === 'upgrade_required' && <p className="mt-1 text-ink-2">Remove the logic rules or <Link to="/settings/billing" className="text-brand-600 font-medium">upgrade your plan</Link>.</p>}
              {issues.length > 0 && <ul className="mt-2 list-disc pl-5 text-ink-2 space-y-0.5">{issues.slice(0, 8).map((i, k) => <li key={k}>{i.message} <span className="text-faint">({i.path})</span></li>)}</ul>}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function AccessDialog({ open, onOpenChange, path }: { open: boolean; onOpenChange: (v: boolean) => void; path: string }) {
  const meta = useEditor((s) => s.meta)!;
  const setMeta = useEditor((s) => s.setMeta);
  const tz = browserTz();
  const [form, setForm] = useState({ slug: meta.slug, access: meta.access, password: '', closesAt: isoToLocalInput(meta.closes_at, tz), latePolicy: meta.late_policy, closedMessage: meta.closed_message ?? '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setForm({ slug: meta.slug, access: meta.access, password: '', closesAt: isoToLocalInput(meta.closes_at, tz), latePolicy: meta.late_policy, closedMessage: meta.closed_message ?? '' }); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const closesAt = form.closesAt ? localInputToIso(form.closesAt, tz) : null;
      await patch(path, { slug: form.slug, access: form.access, ...(form.password ? { password: form.password } : {}), closesAt, latePolicy: form.latePolicy, closedMessage: form.closedMessage || null });
      setMeta({ slug: form.slug, access: form.access, hasPassword: meta.hasPassword || Boolean(form.password), closes_at: closesAt, late_policy: form.latePolicy, closed_message: form.closedMessage || null });
      toast.success('Settings saved');
      onOpenChange(false);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); } finally { setBusy(false); }
  };
  const toggleClosed = async () => {
    try { const status = meta.status === 'closed' ? 'published' : 'closed'; await patch(path, { status }); setMeta({ status }); toast.success(status === 'closed' ? 'Form closed to new responses' : 'Form reopened'); } catch (e) { toast.error(e); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" title="Access & deadline" description="Control who can respond and until when."
      footer={<>{err && <span className="mr-auto self-center text-[12.5px] text-danger">{err}</span>}<Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Link" hint="Lowercase letters, numbers and dashes">
          <div className="flex items-center rounded-md border border-line-strong focus-within:border-brand-500 bg-surface overflow-hidden">
            <span className="pl-3 text-[13px] text-faint whitespace-nowrap">{location.host}/f/</span>
            <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} className="h-9 flex-1 min-w-0 pr-3 text-[13.5px] outline-none bg-transparent" aria-label="URL slug" />
          </div>
        </Field>
        <Field label="Who can respond">
          <Segmented value={form.access} onChange={(v) => setForm({ ...form, access: v })} items={[{ value: 'public', label: 'Anyone' }, { value: 'password', label: 'Password' }, { value: 'invite_only', label: 'Invited guests' }]} />
        </Field>
        {form.access === 'password' && <Field label={meta.hasPassword ? 'New password (leave blank to keep current)' : 'Password'}><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></Field>}
        {form.access === 'invite_only' && <p className="hint">Only people with a personal invitation link (from an event’s guest list) can open and submit this form.</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Deadline" hint={`Your time zone (${tz})`}><Input type="datetime-local" value={form.closesAt} onChange={(e) => setForm({ ...form, closesAt: e.target.value })} /></Field>
          <Field label="After the deadline"><Select value={form.latePolicy} onChange={(e) => setForm({ ...form, latePolicy: e.target.value as 'block' })}><option value="block">Stop accepting responses</option><option value="flag">Accept, but flag as late</option><option value="allow">Keep accepting</option></Select></Field>
        </div>
        <Field label="Closed message"><Textarea rows={2} placeholder="This form is no longer accepting responses." value={form.closedMessage} onChange={(e) => setForm({ ...form, closedMessage: e.target.value })} /></Field>
        {meta.published && (
          <div className="flex items-center justify-between rounded-lg border border-line p-3">
            <div className="text-[13px]"><p className="font-medium">{meta.status === 'closed' ? 'Closed to new responses' : 'Accepting responses'}</p><p className="text-muted text-[12.5px]">Close the form at any time without unpublishing.</p></div>
            <Button size="sm" onClick={toggleClosed}>{meta.status === 'closed' ? 'Reopen' : 'Close form'}</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
