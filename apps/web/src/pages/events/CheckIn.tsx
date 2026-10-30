import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Camera, CameraOff, CheckCircle2, ScanLine, Search, Undo2, UserCheck, Users, XCircle } from 'lucide-react';
import { useWpath, useCan } from '../../stores/session';
import { useApi, useDebounced } from '../../lib/hooks';
import { ApiError, del, post, qs } from '../../lib/api';
import { Badge, Button, Input, Segmented, Select, Spinner, cn } from '../../components/ui';
import { fmtDateTime, n } from '../../lib/format';
import { toast } from '../../stores/toast';
import { RsvpBadge, humanize } from '../shared';

type Result =
  | { kind: 'ready'; guest: any; checkins: any[]; code: string }
  | { kind: 'success'; guest: any; at: string; id: string }
  | { kind: 'duplicate'; guest: any; at?: string; by?: string }
  | { kind: 'override'; guest: any; code?: string; eventGuestId?: string; message: string }
  | { kind: 'error'; message: string };

/** Camera scanner: native BarcodeDetector when available, otherwise jsQR (loaded on demand). */
function Scanner({ onCode, active }: { onCode: (code: string) => void; active: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const last = useRef<{ code: string; at: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const native = Detector ? new Detector({ formats: ['qr_code'] }) : null;
        const jsQR = native ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const tick = async () => {
          if (stopped || !video.current) return;
          let value: string | null = null;
          try {
            if (native) value = (await native.detect(video.current))[0]?.rawValue ?? null;
            else if (jsQR && ctx && video.current.videoWidth) {
              canvas.width = video.current.videoWidth; canvas.height = video.current.videoHeight;
              ctx.drawImage(video.current, 0, 0);
              value = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data ?? null;
            }
          } catch { /* frame not ready */ }
          // De-bounce the same code for 3s so one pass isn't scanned repeatedly.
          if (value && !(last.current && last.current.code === value && Date.now() - last.current.at < 3000)) { last.current = { code: value, at: Date.now() }; onCode(value); }
          raf = window.setTimeout(() => void tick(), 220) as unknown as number;
        };
        void tick();
      } catch (e) {
        setErr(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser settings or enter codes manually.' : 'No camera available. Enter codes manually or search guests.');
      }
    })();
    return () => { stopped = true; clearTimeout(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [active, onCode]);
  if (err) return <div className="aspect-square rounded-2xl bg-ink/90 text-white/80 grid place-items-center text-center p-6 text-[13px]"><div><CameraOff className="size-6 mx-auto mb-2" />{err}</div></div>;
  return (
    <div className="relative aspect-square rounded-2xl overflow-hidden bg-ink">
      <video ref={video} playsInline muted className="w-full h-full object-cover" />
      <div className="absolute inset-[18%] border-2 border-white/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      <p className="absolute bottom-3 inset-x-0 text-center text-white/90 text-[12.5px]">Point the camera at the guest’s QR code</p>
    </div>
  );
}

export default function CheckIn() {
  const { eventId } = useParams();
  const [params] = useSearchParams();
  const wp = useWpath();
  const can = useCan();
  const ev = useApi<any>(wp(`/events/${eventId}`));
  const [mode, setMode] = useState<'scan' | 'search'>(params.get('code') ? 'scan' : 'scan');
  const [sessionId, setSessionId] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useApi<{ items: any[]; stats: any }>(wp(`/checkins/events/${eventId}${qs({ search: q, sessionId })}`));
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [auto, setAuto] = useState(true);

  const checkIn = useCallback(async (args: { code?: string; eventGuestId?: string; override?: boolean }) => {
    setBusy(true);
    try {
      const r = await post(wp('/checkins')!, { ...args, eventId, sessionId: sessionId || null });
      setResult({ kind: 'success', guest: r.guest, at: r.checkedInAt, id: r.id });
      navigator.vibrate?.(60);
      void list.refetch();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_checked_in') setResult({ kind: 'duplicate', guest: e.details?.guest, at: e.details?.checkin?.created_at, by: e.details?.checkin?.checked_in_by_name });
      else if (e instanceof ApiError && e.code === 'needs_override') setResult({ kind: 'override', guest: e.details?.guest, message: e.message, ...args });
      else setResult({ kind: 'error', message: e instanceof Error ? e.message : 'Check-in failed' });
      navigator.vibrate?.([40, 60, 40]);
    } finally { setBusy(false); }
  }, [wp, eventId, sessionId, list]);

  const onCode = useCallback(async (code: string) => {
    if (auto) { await checkIn({ code }); return; }
    try { const r = await post(wp('/checkins/lookup')!, { code, eventId }); setResult({ kind: 'ready', guest: r.guest, checkins: r.checkins, code }); }
    catch (e) { setResult({ kind: 'error', message: e instanceof Error ? e.message : 'Invalid code' }); }
  }, [auto, checkIn, wp, eventId]);

  useEffect(() => { const code = params.get('code'); if (code && ev.data) void onCode(code); }, [ev.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can.write) return <div className="p-8 text-center text-[13px]">You don’t have permission to check guests in.</div>;
  const e = ev.data;
  const stats = list.data?.stats;
  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-line">
        <div className="max-w-[560px] mx-auto px-4 h-14 flex items-center gap-3">
          <Link to={`/events/${eventId}`} aria-label="Back to event"><Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button></Link>
          <div className="flex-1 min-w-0"><p className="text-[14px] font-semibold truncate">{e?.name ?? 'Check-in'}</p><p className="text-[11.5px] text-muted">Check-in</p></div>
          {stats && <div className="text-right tabular"><p className="text-[15px] font-semibold">{n(stats.attendees)}<span className="text-muted font-normal text-[12px]"> / {n(stats.expected)}</span></p><p className="text-[11px] text-muted">arrived / expected</p></div>}
        </div>
      </header>
      <div className="max-w-[560px] mx-auto p-4 space-y-4">
        {e?.sessions?.length > 0 && <Select value={sessionId} onChange={(x) => { setSessionId(x.target.value); setResult(null); }} aria-label="Session"><option value="">Whole event</option>{e.sessions.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
        <div className="flex justify-between items-center"><Segmented value={mode} onChange={setMode} items={[{ value: 'scan', label: <><ScanLine />Scan</> }, { value: 'search', label: <><Search />Guest list</> }]} />
          {mode === 'scan' && <label className="flex items-center gap-2 text-[12.5px] text-ink-2"><input type="checkbox" className="accent-brand-500" checked={auto} onChange={(x) => setAuto(x.target.checked)} />Check in on scan</label>}</div>

        {result && <ResultCard result={result} busy={busy} onClose={() => setResult(null)}
          onConfirm={(r) => r.kind === 'ready' ? void checkIn({ code: r.code }) : r.kind === 'override' ? void checkIn({ code: r.code, eventGuestId: r.eventGuestId ?? r.guest?.event_guest_id, override: true }) : undefined}
          onUndo={async (id) => { try { await del(wp(`/checkins/${id}`)!); toast.success('Check-in undone'); setResult(null); void list.refetch(); } catch (err) { toast.error(err); } }} />}

        {mode === 'scan' ? (
          <div className="space-y-3">
            <Scanner active={mode === 'scan'} onCode={onCode} />
            <form className="flex gap-2" onSubmit={(x) => { x.preventDefault(); if (manual.trim()) { void onCode(manual.trim()); setManual(''); } }}>
              <Input value={manual} onChange={(x) => setManual(x.target.value)} placeholder="Or paste / type a pass code" aria-label="Pass code" />
              <Button type="submit" disabled={!manual.trim()}>Check</Button>
            </form>
          </div>
        ) : (
          <div className="space-y-3">
            <Input icon={<Search />} value={search} onChange={(x) => setSearch(x.target.value)} placeholder="Search by name or email" autoFocus />
            <div className="card divide-y divide-line">
              {list.loading && !list.data && <div className="p-6 grid place-items-center"><Spinner /></div>}
              {(list.data?.items ?? []).map((g) => (
                <div key={g.event_guest_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0"><p className="text-[14px] font-medium truncate">{g.name}</p><p className="text-[12px] text-muted flex items-center gap-2"><RsvpBadge status={g.rsvp_status} />{g.party_size > 0 && <span className="flex items-center gap-1"><Users className="size-3" />{g.party_size}</span>}{g.group_name && <span>{g.group_name}</span>}</p></div>
                  {g.checkin_id ? (
                    <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={async () => { await del(wp(`/checkins/${g.checkin_id}`)!); void list.refetch(); }}>Undo</Button>
                  ) : (
                    <Button size="sm" variant={g.rsvp_status === 'accepted' || g.rsvp_status === 'maybe' ? 'primary' : 'secondary'} icon={<UserCheck className="size-3.5" />} onClick={() => checkIn({ eventGuestId: g.event_guest_id })}>Check in</Button>
                  )}
                </div>
              ))}
              {list.data && !list.data.items.length && <p className="p-6 text-center text-[13px] text-muted">No guests found.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GuestSummary({ g }: { g: any }) {
  if (!g) return null;
  return (
    <div className="mt-1">
      <p className="text-[18px] font-semibold">{g.name}</p>
      <div className="flex flex-wrap gap-2 mt-2 text-[12.5px]">
        <RsvpBadge status={g.rsvp_status} />
        {g.party_size > 0 && <Badge><Users className="size-3" />Party of {g.party_size}{g.children ? ` (${g.children} kids)` : ''}</Badge>}
        {g.group_name && <Badge>{g.group_name}</Badge>}
        {g.meal && <Badge tone="coral">{humanize(g.meal)}</Badge>}
      </div>
      {g.dietary && <p className="text-[12.5px] text-muted mt-2">Dietary: {g.dietary}</p>}
    </div>
  );
}

function ResultCard({ result, busy, onClose, onConfirm, onUndo }: { result: Result; busy: boolean; onClose: () => void; onConfirm: (r: Result) => void; onUndo: (id: string) => void }) {
  const tone = result.kind === 'success' ? 'border-success/30 bg-success-50' : result.kind === 'ready' ? 'border-brand-100 bg-brand-50' : result.kind === 'error' ? 'border-danger/30 bg-danger-50' : 'border-warning/30 bg-warning-50';
  return (
    <div className={cn('rounded-2xl border p-4 animate-slide-up', tone)} role="status" aria-live="assertive">
      <div className="flex items-start gap-3">
        <span className="mt-0.5">
          {result.kind === 'success' ? <CheckCircle2 className="size-6 text-success" /> : result.kind === 'error' ? <XCircle className="size-6 text-danger" /> : result.kind === 'ready' ? <Camera className="size-6 text-brand-500" /> : <AlertTriangle className="size-6 text-warning" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold">{result.kind === 'success' ? 'Checked in' : result.kind === 'duplicate' ? 'Already checked in' : result.kind === 'override' ? 'Needs confirmation' : result.kind === 'ready' ? 'Valid pass' : 'Not valid'}</p>
          {result.kind === 'error' && <p className="text-[13px] text-ink-2 mt-0.5">{result.message}</p>}
          {result.kind === 'override' && <p className="text-[13px] text-ink-2 mt-0.5">{result.message}</p>}
          {result.kind === 'duplicate' && result.at && <p className="text-[12.5px] text-ink-2 mt-0.5">at {fmtDateTime(result.at)}{result.by ? ` by ${result.by}` : ''}</p>}
          {'guest' in result && <GuestSummary g={result.guest} />}
          {result.kind === 'ready' && result.checkins.length > 0 && <p className="text-[12.5px] text-warning mt-2">Previously checked in {fmtDateTime(result.checkins[0].created_at)}</p>}
        </div>
      </div>
      <div className="flex gap-2 mt-4 justify-end">
        {result.kind === 'success' && <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => onUndo(result.id)}>Undo</Button>}
        {result.kind === 'ready' && <Button variant="primary" loading={busy} onClick={() => onConfirm(result)}>Check in</Button>}
        {result.kind === 'override' && <Button variant="primary" loading={busy} onClick={() => onConfirm(result)}>Check in anyway</Button>}
        <Button size="sm" onClick={onClose}>{result.kind === 'success' ? 'Next guest' : 'Dismiss'}</Button>
      </div>
    </div>
  );
}
