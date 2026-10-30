import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '@rsvp/renderer/renderer.css';
import { FormRenderer, SubmitError, ThemeScope, EventDetails, QrCode, type PublicEventInfo, type SubmitResult } from '@rsvp/renderer';
import type { Answers, FileRef, FormSchema, FormTheme } from '@rsvp/core';

/**
 * Public renderer entry (public.html). Deliberately independent from the dashboard bundle:
 * no router, no dashboard state, no editor code — just the renderer and a few fetches.
 */

interface PublicForm {
  form: { slug: string; name: string; version: number };
  schema: FormSchema; event: (PublicEventInfo & { slug: string; status: string }) | null; access: string;
  closed: boolean; closedMessage: string | null; deadline: string | null; hideBranding: boolean;
}
type Locked = { locked: 'password' | 'invite_only'; form: { slug: string; name: string }; theme?: FormTheme; event?: PublicEventInfo | null };

class HttpError extends Error { constructor(public status: number, message: string, public details?: any) { super(message); } }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/public${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  } catch { throw new HttpError(0, 'You appear to be offline. Please check your connection and try again.'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, json?.error?.message ?? 'Something went wrong', json?.error?.details);
  return json as T;
}

const device = (): 'desktop' | 'mobile' | 'tablet' => (/iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop');
const query = () => Object.fromEntries(new URLSearchParams(location.search));
const checkinUrl = (t: string) => `${location.origin}/c/${t}`;
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function Shell({ theme, children }: { theme?: FormTheme; children: React.ReactNode }) {
  return <ThemeScope theme={theme} fullPage style={{ minHeight: '100vh' }}><div className="fr-shell"><div className="fr-card">{children}</div></div></ThemeScope>;
}

function Message({ title, body, theme }: { title: string; body?: string; theme?: FormTheme }) {
  return <Shell theme={theme}><div className="fr-locked"><h1 className="fr-title">{title}</h1>{body && <p className="fr-desc">{body}</p>}</div></Shell>;
}

function Loading() {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', color: '#777' }} aria-busy="true"><span className="fr-spinner" style={{ display: 'inline-block', color: '#999' }} /></div>;
}

function usePublicSubmit(slug: string, version: number | undefined, invitationToken?: string) {
  const visitId = useRef<string | null>(null);
  const idemKey = useRef(newKey());
  useEffect(() => {
    if (!version) return;
    api<{ visitId: string }>(`/forms/${encodeURIComponent(slug)}/visits`, { method: 'POST', body: JSON.stringify({ device: device() }) }).then((r) => { visitId.current = r.visitId; }).catch(() => undefined);
  }, [slug, version]);
  const onStart = useCallback(() => { if (visitId.current) void api(`/visits/${visitId.current}/start`, { method: 'POST', body: '{}' }).catch(() => undefined); }, []);
  const upload = useCallback(async (fieldId: string, file: File): Promise<FileRef> => {
    const fd = new FormData();
    fd.set('fieldId', fieldId);
    fd.set('file', file);
    const res = await fetch(`/api/v1/public/forms/${encodeURIComponent(slug)}/uploads`, { method: 'POST', body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? 'Upload failed');
    return json as FileRef;
  }, [slug]);
  const onSubmit = useCallback(async (answers: Answers, meta: { startedAt: number; honeypot: string }): Promise<SubmitResult> => {
    try {
      // The same idempotency key is reused for retries so a flaky connection never creates duplicates.
      const r = await api<SubmitResult>(`/forms/${encodeURIComponent(slug)}/submissions`, {
        method: 'POST',
        body: JSON.stringify({ answers, invitationToken, accessToken: sessionStorage.getItem(`access:${slug}`) ?? undefined, visitId: visitId.current ?? undefined, idempotencyKey: idemKey.current, query: query(), website_url: meta.honeypot || undefined, startedAt: meta.startedAt, device: device() }),
      });
      idemKey.current = newKey();
      return r;
    } catch (e) {
      if (e instanceof HttpError && e.status === 422) throw new SubmitError(e.message, e.details?.fields);
      if (e instanceof HttpError && e.status >= 400 && e.status < 500) idemKey.current = newKey();
      throw new SubmitError(e instanceof Error ? e.message : 'Submission failed');
    }
  }, [slug, invitationToken]);
  return { onStart, upload, onSubmit };
}

function PasswordGate({ data, onUnlocked }: { data: Locked; onUnlocked: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api<{ accessToken: string }>(`/forms/${encodeURIComponent(data.form.slug)}/unlock`, { method: 'POST', body: JSON.stringify({ password: pw }) }); sessionStorage.setItem(`access:${data.form.slug}`, r.accessToken); onUnlocked(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Incorrect password'); } finally { setBusy(false); }
  };
  return (
    <Shell theme={data.theme}>
      <div className="fr-locked">
        <h1 className="fr-title">{data.form.name}</h1>
        <p className="fr-desc">This form is password protected.</p>
        <form onSubmit={submit}><input className="fr-input" type="password" aria-label="Password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /><button className="fr-btn" disabled={busy || !pw}>{busy ? <span className="fr-spinner" /> : 'Open'}</button></form>
        {err && <p className="fr-error" style={{ justifyContent: 'center' }} role="alert">{err}</p>}
      </div>
    </Shell>
  );
}

function LiveForm({ data, invitationToken, initialAnswers, storage = true }: { data: PublicForm; invitationToken?: string; initialAnswers?: Answers; storage?: boolean }) {
  const { onStart, upload, onSubmit } = usePublicSubmit(data.form.slug, data.form.version, invitationToken);
  if (data.closed) return <Message theme={data.schema.theme} title={data.schema.form.title} body={data.closedMessage ?? 'This form is no longer accepting responses.'} />;
  const persist = storage && !invitationToken && data.schema.settings.layout !== 'standard';
  return (
    <FormRenderer schema={data.schema} mode="live" event={data.event} deadline={data.deadline} initialAnswers={initialAnswers} query={query()}
      storageKey={persist ? `invitely:${data.form.slug}:v${data.form.version}` : undefined}
      onSubmit={onSubmit} onStart={onStart} upload={upload} checkinUrl={checkinUrl} hideBranding={data.hideBranding} allowEdit={Boolean(invitationToken)} />
  );
}

function FormPage({ slug }: { slug: string }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'form'; data: PublicForm } | { kind: 'locked'; data: Locked } | { kind: 'error'; status: number; message: string }>({ kind: 'loading' });
  const load = useCallback(async () => {
    try {
      const token = sessionStorage.getItem(`access:${slug}`);
      const r = await api<PublicForm | Locked>(`/forms/${encodeURIComponent(slug)}`, token ? { headers: { 'x-form-access': token } } : undefined);
      if ('locked' in r) setState({ kind: 'locked', data: r }); else { setState({ kind: 'form', data: r }); document.title = r.schema.form.title; }
    } catch (e) { setState({ kind: 'error', status: e instanceof HttpError ? e.status : 0, message: e instanceof Error ? e.message : 'Error' }); }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);
  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <Message title={state.status === 404 ? 'Form not found' : 'Something went wrong'} body={state.status === 404 ? 'This form doesn’t exist or hasn’t been published yet.' : state.message} />;
  if (state.kind === 'locked') {
    if (state.data.locked === 'password') return <PasswordGate data={state.data} onUnlocked={load} />;
    return <Message theme={state.data.theme} title={state.data.form.name} body="This form is by invitation only. Please use the personal link from your invitation." />;
  }
  return <LiveForm data={state.data} />;
}

function EventPage({ slug }: { slug: string }) {
  const [data, setData] = useState<{ event: PublicEventInfo & { description: string; coverImage: string | null }; form: { slug: string; inviteOnly: boolean } | null } | null>(null);
  const [form, setForm] = useState<PublicForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<typeof data>(`/events/${encodeURIComponent(slug)}`).then(async (d) => {
      setData(d);
      document.title = d!.event.name;
      if (d!.form && !d!.form.inviteOnly) {
        const f = await api<PublicForm | Locked>(`/forms/${encodeURIComponent(d!.form.slug)}`).catch(() => null);
        if (f && !('locked' in f)) setForm(f);
      }
    }).catch((e) => setError(e instanceof HttpError && e.status === 404 ? 'This event doesn’t exist or isn’t public yet.' : 'Something went wrong'));
  }, [slug]);
  if (error) return <Message title="Event not found" body={error} />;
  if (!data) return <Loading />;
  const theme = form?.schema.theme;
  return (
    <ThemeScope theme={theme} fullPage style={{ minHeight: '100vh' }}>
      <div className="fr-shell">
        {data.event.coverImage && <img className="fr-cover" src={data.event.coverImage} alt="" />}
        <div className="fr-card">
          <p className="fr-help" style={{ textTransform: 'uppercase', letterSpacing: '.14em', fontSize: '.75em' }}>You’re invited</p>
          <h1 className="fr-title">{data.event.name}</h1>
          {data.event.description && <p className="fr-desc">{data.event.description}</p>}
          <EventDetails event={data.event} />
          {!data.form && <p className="fr-help" style={{ marginTop: 20 }}>RSVPs open soon.</p>}
          {data.form?.inviteOnly && <p className="fr-notice" style={{ marginTop: 20 }}>RSVPs are by invitation. Please use the personal link from your invitation to respond.</p>}
          {form?.form.slug && <p style={{ marginTop: 24 }}><a className="fr-btn" href="#rsvp">RSVP now</a></p>}
        </div>
      </div>
      {form && <div id="rsvp"><LiveForm data={{ ...form, schema: { ...form.schema, settings: { ...form.schema.settings, coverImage: undefined } } }} /></div>}
    </ThemeScope>
  );
}

interface InvitationData {
  guest: { name: string; email: string | null }; rsvpStatus: string; event: PublicEventInfo & { description: string; coverImage: string | null };
  form: PublicForm | null; previousAnswers: Answers | null; checkinToken: string | null;
}

function InvitationPage({ token }: { token: string }) {
  const [data, setData] = useState<InvitationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => { api<InvitationData>(`/invitations/${encodeURIComponent(token)}`).then((d) => { setData(d); document.title = d.event.name; }).catch((e) => setError(e instanceof HttpError && e.status === 404 ? 'This invitation link is not valid.' : 'Something went wrong')); }, [token]);
  const initial = useMemo(() => {
    if (!data?.form) return undefined;
    if (data.previousAnswers) return data.previousAnswers;
    // Prefill name/email fields from the guest record.
    const out: Answers = {};
    for (const el of data.form.schema.pages.flatMap((p) => p.elements)) {
      if (el.type === 'email' && data.guest.email && !out[el.id]) out[el.id] = data.guest.email;
      if (el.type === 'short_text' && /name/i.test(el.id + el.label) && !Object.values(out).includes(data.guest.name)) out[el.id] = data.guest.name;
    }
    return out;
  }, [data]);
  if (error) return <Message title="Invitation not found" body={error} />;
  if (!data) return <Loading />;
  if (!data.form) return <Message title={data.event.name} body="RSVPs for this event aren’t open yet." />;
  const responded = data.rsvpStatus !== 'pending' && !editing;
  if (responded) {
    const label = data.rsvpStatus === 'accepted' ? 'You’re attending' : data.rsvpStatus === 'declined' ? 'You’ve declined' : 'You’ve replied maybe';
    return (
      <Shell theme={data.form.schema.theme}>
        <div className="fr-confirm">
          <p className="fr-help">Hi {data.guest.name.split(' ')[0]},</p>
          <h1 className="fr-title">{label}</h1>
          <p className="fr-desc">Thanks for responding to {data.event.name}.</p>
          {data.checkinToken && <QrCode value={checkinUrl(data.checkinToken)} caption="Show this code at the entrance" />}
          <EventDetails event={data.event} />
          {!data.form.closed && <p style={{ marginTop: 20 }}><button className="fr-btn" onClick={() => setEditing(true)}>Change my response</button></p>}
        </div>
      </Shell>
    );
  }
  return <LiveForm data={data.form} invitationToken={token} initialAnswers={initial} storage={false} />;
}

function App() {
  const [, kind, id] = location.pathname.split('/');
  const slug = decodeURIComponent(id ?? '');
  if (kind === 'f' && slug) return <FormPage slug={slug} />;
  if (kind === 'e' && slug) return <EventPage slug={slug} />;
  if (kind === 'i' && slug) return <InvitationPage token={slug} />;
  return <Message title="Page not found" />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
