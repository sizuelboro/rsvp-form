import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, BellRing, CalendarDays, Copy, Download, ExternalLink, FileText, Link2, MailCheck, MapPin, MoreHorizontal, Pencil, Plus, QrCode,
  ScanLine, Send, Star, Trash2, Upload, UserPlus, Users, Megaphone,
} from 'lucide-react';
import { renderSVG } from 'uqr';
import { TEMPLATES } from '@rsvp/core';
import { useWpath, useCan, useSession } from '../../stores/session';
import { useApi, useDebounced } from '../../lib/hooks';
import { del, download, patch, post, put, qs } from '../../lib/api';
import {
  Badge, Button, Checkbox, ConfirmDialog, Dialog, Drawer, EmptyState, ErrorState, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger,
  Pagination, SearchInput, Select, Skeleton, Stat, Table, Tabs, Textarea, cn,
} from '../../components/ui';
import { BarList, Donut, LineChart, fillDays } from '../../components/charts';
import { fmtDate, fmtDateTime, isoToLocalInput, n, localInputToIso } from '../../lib/format';
import { toast } from '../../stores/toast';
import { InviteBadge, RsvpBadge, StatusBadge, humanize, plural } from '../shared';
import { EventForm, eventPayload, type EventDraft } from './EventsList';
import { ImportDialog } from '../guests/components';
import { createForm } from '../../app/actions';

type Tab = 'overview' | 'guests' | 'sessions' | 'forms' | 'analytics' | 'settings';

export default function EventDetail() {
  const { eventId } = useParams();
  const wp = useWpath();
  const navigate = useNavigate();
  const ev = useApi<any>(wp(`/events/${eventId}`));
  const [tab, setTab] = useState<Tab>('overview');
  if (ev.error) return <ErrorState error={ev.error} onRetry={ev.refetch} />;
  if (!ev.data) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /></div>;
  const e = ev.data;
  const primary = e.forms.find((f: any) => f.is_primary) ?? e.forms[0];
  return (
    <div>
      <Link to="/events" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink mb-3"><ArrowLeft className="size-3.5" />Events</Link>
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap"><h1 className="text-[22px] font-semibold tracking-[-0.015em]">{e.name}</h1><StatusBadge status={e.status} /></div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted mt-1.5">
            <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" />{e.starts_at ? fmtDateTime(e.starts_at, e.timezone) : 'Date TBC'} <span className="text-faint">({e.timezone})</span></span>
            {e.venue_name && <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{e.venue_name}</span>}
            {e.rsvp_deadline && <span>RSVP by {fmtDate(e.rsvp_deadline, e.timezone)}</span>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {e.status !== 'draft' && <a href={`/e/${e.slug}`} target="_blank" rel="noopener noreferrer"><Button icon={<ExternalLink className="size-3.5" />}>Event page</Button></a>}
          <Button icon={<ScanLine className="size-3.5" />} onClick={() => navigate(`/events/${e.id}/checkin`)}>Check-in</Button>
          {e.status === 'draft' && <Button variant="primary" onClick={async () => { try { await patch(wp(`/events/${e.id}`)!, { status: 'published' }); toast.success('Event published'); void ev.refetch(); } catch (err) { toast.error(err); } }}>Publish event</Button>}
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} className="mb-6" items={[
        { value: 'overview', label: 'Overview' }, { value: 'guests', label: 'Guests', count: e.invited }, { value: 'sessions', label: 'Sessions', count: e.sessions.length },
        { value: 'forms', label: 'Forms', count: e.forms.length }, { value: 'analytics', label: 'Analytics' }, { value: 'settings', label: 'Settings' },
      ]} />
      {tab === 'overview' && <OverviewTab e={e} primary={primary} goto={setTab} />}
      {tab === 'guests' && <GuestsTab e={e} onChanged={ev.refetch} />}
      {tab === 'sessions' && <SessionsTab e={e} onChanged={ev.refetch} />}
      {tab === 'forms' && <FormsTab e={e} onChanged={ev.refetch} />}
      {tab === 'analytics' && <EventAnalytics eventId={e.id} slug={e.slug} />}
      {tab === 'settings' && <SettingsTab e={e} onChanged={ev.refetch} />}
    </div>
  );
}

function OverviewTab({ e, primary, goto }: { e: any; primary: any; goto: (t: Tab) => void }) {
  const navigate = useNavigate();
  const steps = [
    { done: e.forms.length > 0, label: 'Attach an RSVP form', action: () => goto('forms') },
    { done: primary?.status === 'published', label: 'Publish the RSVP form', action: () => primary && navigate(`/forms/${primary.id}/edit`) },
    { done: e.invited > 0, label: 'Add or import guests', action: () => goto('guests') },
    { done: e.status !== 'draft', label: 'Publish the event', action: () => goto('settings') },
    { done: e.accepted + e.declined > 0, label: 'Send invitations', action: () => goto('guests') },
  ];
  const todo = steps.filter((s) => !s.done);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Invited" value={n(e.invited)} />
        <Stat label="Accepted" value={n(e.accepted)} accent="success" />
        <Stat label="Declined" value={n(e.declined)} accent="danger" />
        <Stat label="Pending" value={n(e.pending)} accent="warning" />
        <Stat label="Expected attendees" value={n(e.expected_attendees)} hint={e.capacity ? `of ${n(e.capacity)} capacity` : 'Accepted party sizes'} />
        <Stat label="Checked in" value={n(e.checked_in)} hint="Actual attendance" accent="brand" />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-[13.5px] font-semibold mb-4">RSVP status</h2>
          <Donut label={`${e.invited ? Math.round(((e.accepted + e.declined) / e.invited) * 100) : 0}%`} sublabel="responded" segments={[{ label: 'Accepted', value: e.accepted, color: '#1F8A5B' }, { label: 'Declined', value: e.declined, color: '#E07A6A' }, { label: 'Pending / maybe', value: e.pending, color: '#DEDBD3' }]} />
          {e.sessions.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <h3 className="text-[12.5px] font-semibold text-muted mb-3">Sessions</h3>
              <div className="space-y-2">{e.sessions.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between text-[13px]"><span>{s.name} <span className="text-faint">{s.starts_at ? fmtDate(s.starts_at, e.timezone, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</span></span><span className="tabular text-muted">{s.expected_attendees} expected · {s.checked_in} checked in{s.capacity ? ` · cap ${s.capacity}` : ''}</span></div>
              ))}</div>
            </div>
          )}
        </div>
        <div className="space-y-4">
          {todo.length > 0 && (
            <div className="card p-5">
              <h2 className="text-[13.5px] font-semibold mb-3">Next steps</h2>
              <ul className="space-y-2">{steps.map((s) => (
                <li key={s.label}><button onClick={s.action} disabled={s.done} className={cn('w-full flex items-center gap-2.5 text-[13px] text-left cursor-pointer disabled:cursor-default', s.done ? 'text-faint line-through' : 'text-ink hover:text-brand-600')}>
                  <span className={cn('size-4 rounded-full border grid place-items-center shrink-0', s.done ? 'bg-success border-success text-white' : 'border-line-strong')}>{s.done && '✓'}</span>{s.label}
                </button></li>
              ))}</ul>
            </div>
          )}
          <div className="card p-5">
            <h2 className="text-[13.5px] font-semibold mb-3">RSVP form</h2>
            {primary ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium truncate">{primary.name}</span><StatusBadge status={primary.status} /></div>
                <p className="text-[12.5px] text-muted">{n(primary.responses)} responses · {primary.access === 'invite_only' ? 'Invitation only' : primary.access === 'password' ? 'Password protected' : 'Public link'}</p>
                <div className="flex gap-2"><Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => navigate(`/forms/${primary.id}/edit`)}>Edit form</Button><Button size="sm" onClick={() => navigate(`/responses?eventId=${e.id}`)}>Responses</Button></div>
              </div>
            ) : <p className="text-[13px] text-muted">No form attached yet. <button className="text-brand-600 font-medium cursor-pointer" onClick={() => goto('forms')}>Attach one</button></p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function QrDialog({ guest, onOpenChange }: { guest: any; onOpenChange: (v: boolean) => void }) {
  const url = guest?.rsvpUrl as string | undefined;
  return (
    <Dialog open={Boolean(guest)} onOpenChange={onOpenChange} title={`Invitation for ${guest?.name ?? ''}`} description="Personal link — only share it with this guest." size="sm">
      {url && <div className="text-center space-y-3">
        <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(url, { border: 2 }))}`} alt="Invitation QR code" className="size-48 mx-auto rounded-lg border border-line" />
        <div className="flex gap-2"><Input readOnly value={url} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} /><Button icon={<Copy className="size-3.5" />} onClick={() => { void navigator.clipboard.writeText(url); toast.success('Link copied'); }}>Copy</Button></div>
        <p className="hint">After the guest accepts, their confirmation shows a separate entry QR code for check-in.</p>
      </div>}
    </Dialog>
  );
}

function GuestsTab({ e, onChanged }: { e: any; onChanged: () => void }) {
  const wp = useWpath();
  const can = useCan();
  const features = useSession((s) => s.workspace?.entitlements.features);
  const [search, setSearch] = useState('');
  const [rsvp, setRsvp] = useState('');
  const [invitation, setInvitation] = useState('');
  const [checkedIn, setCheckedIn] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const q = useDebounced(search);
  const list = useApi<{ items: any[]; total: number; page: number; pageSize: number }>(wp(`/events/${e.id}/guests${qs({ search: q, rsvp, invitation, checkedIn, page, pageSize: 50 })}`));
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [qr, setQr] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [sending, setSending] = useState<{ kind: 'invitation' | 'deadline_reminder' | 'event_reminder'; ids?: string[]; audience: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const refresh = () => { void list.refetch(); onChanged(); setSelected(new Set()); };
  const items = list.data?.items ?? [];
  const allSelected = items.length > 0 && items.every((g) => selected.has(g.id));

  if (!features?.guestManagement) return <div className="card"><EmptyState icon={<Users />} title="Guest management is a Pro feature" description="Upgrade to import guest lists, send personal invitations and track RSVPs per guest." action={<Link to="/settings/billing"><Button variant="primary">View plans</Button></Link>} /></div>;

  return (
    <div>
      <div className="flex flex-col lg:flex-row gap-3 justify-between mb-4">
        <div className="flex flex-wrap gap-2">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search guests" />
          <Select className="w-auto" value={rsvp} onChange={(x) => { setRsvp(x.target.value); setPage(1); }} aria-label="RSVP filter"><option value="">All RSVPs</option><option value="accepted">Accepted</option><option value="declined">Declined</option><option value="maybe">Maybe</option><option value="pending">Pending</option></Select>
          <Select className="w-auto" value={invitation} onChange={(x) => { setInvitation(x.target.value); setPage(1); }} aria-label="Invitation filter"><option value="">All invitations</option><option value="none">Not invited</option><option value="draft">Link ready</option><option value="queued">Queued</option><option value="sent">Sent</option><option value="delivered">Delivered</option><option value="failed">Failed</option></Select>
          <Select className="w-auto" value={checkedIn} onChange={(x) => { setCheckedIn(x.target.value); setPage(1); }} aria-label="Check-in filter"><option value="">Any attendance</option><option value="yes">Checked in</option><option value="no">Not checked in</option></Select>
        </div>
        {can.write && <div className="flex gap-2 flex-wrap">
          <Button icon={<Upload className="size-3.5" />} onClick={() => setImporting(true)}>Import CSV</Button>
          <Button icon={<UserPlus className="size-3.5" />} onClick={() => setAdding(true)}>Add guests</Button>
          <Menu>
            <MenuTrigger asChild><Button variant="primary" icon={<Send className="size-3.5" />}>Send</Button></MenuTrigger>
            <MenuContent>
              <MenuItem icon={<MailCheck />} onSelect={() => setSending({ kind: 'invitation', audience: 'not_sent' })}>Invite everyone not yet invited</MenuItem>
              <MenuItem icon={<BellRing />} onSelect={() => setSending({ kind: 'deadline_reminder', audience: 'pending' })}>Remind guests who haven’t replied</MenuItem>
              <MenuItem icon={<CalendarDays />} onSelect={() => setSending({ kind: 'event_reminder', audience: 'all' })}>Send event reminder to all</MenuItem>
            </MenuContent>
          </Menu>
        </div>}
      </div>
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-brand-50 border border-brand-100 text-[13px] flex-wrap">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => setSending({ kind: 'invitation', ids: [...selected], audience: 'selected' })}>Send invitation</Button>
          <Button size="sm" icon={<BellRing className="size-3.5" />} onClick={() => setSending({ kind: 'deadline_reminder', ids: [...selected], audience: 'selected' })}>Send reminder</Button>
          <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(true)}>Remove from event</Button>
          <button className="ml-auto text-muted hover:text-ink cursor-pointer" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
        <div className="card">
          <Table loading={list.loading} rows={items} rowKey={(g) => g.id}
            columns={[
              { key: 'sel', header: <Checkbox label="Select all" checked={allSelected} indeterminate={!allSelected && items.some((g) => selected.has(g.id))} onChange={(v) => setSelected(v ? new Set(items.map((g) => g.id)) : new Set())} />, className: 'w-10 pr-0', headerClassName: 'w-10 pr-0', cell: (g) => <Checkbox label={`Select ${g.name}`} checked={selected.has(g.id)} onChange={(v) => { const s = new Set(selected); if (v) s.add(g.id); else s.delete(g.id); setSelected(s); }} /> },
              { key: 'name', header: 'Guest', cell: (g) => <div className="min-w-[160px]"><p className="font-medium">{g.name}</p><p className="text-[12px] text-muted">{g.email ?? g.phone ?? 'No contact details'}{g.group_name ? ` · ${g.group_name}` : ''}</p></div> },
              { key: 'inv', header: 'Invitation', cell: (g) => <span title={g.last_error ?? undefined}><InviteBadge status={g.invitation_status} /></span>, className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
              { key: 'rsvp', header: 'RSVP', cell: (g) => <RsvpBadge status={g.rsvp_status} /> },
              { key: 'party', header: 'Party', cell: (g) => <span className="tabular text-ink-2">{g.party_size || '—'}{g.children ? <span className="text-faint"> ({g.children} kids)</span> : ''}</span>, className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
              { key: 'meal', header: 'Meal', cell: (g) => <span className="text-muted">{humanize(g.meal) || '—'}</span>, className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
              { key: 'chk', header: 'Attendance', cell: (g) => g.checked_in_at ? <Badge tone="brand">Checked in</Badge> : <span className="text-[12px] text-faint">Not checked in</span>, className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
              { key: 'menu', header: <span className="sr-only">Actions</span>, className: 'w-12', cell: (g) => (
                <Menu>
                  <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${g.name}`}><MoreHorizontal className="size-4" /></Button></MenuTrigger>
                  <MenuContent>
                    {g.rsvpUrl ? <><MenuItem icon={<Link2 />} onSelect={() => { void navigator.clipboard.writeText(g.rsvpUrl); toast.success('Invitation link copied'); }}>Copy invitation link</MenuItem><MenuItem icon={<QrCode />} onSelect={() => setQr(g)}>Show invitation QR</MenuItem></>
                      : <MenuItem icon={<Link2 />} onSelect={async () => { try { await post(wp(`/events/${e.id}/invitations/prepare`)!, { eventGuestIds: [g.id], audience: 'selected' }); toast.success('Invitation link created'); void list.refetch(); } catch (err) { toast.error(err); } }}>Create invitation link</MenuItem>}
                    {can.write && <MenuItem icon={<Pencil />} onSelect={() => setEditing(g)}>Update RSVP manually</MenuItem>}
                  </MenuContent>
                </Menu>
              ) },
            ]}
            empty={<EmptyState compact icon={<Users />} title={search || rsvp || invitation || checkedIn ? 'No guests match these filters' : 'No guests yet'} description="Add guests one by one, choose from your guest directory or import a CSV." action={can.write && !search ? <div className="flex gap-2"><Button onClick={() => setImporting(true)}>Import CSV</Button><Button variant="primary" onClick={() => setAdding(true)}>Add guests</Button></div> : undefined} />}
          />
          {list.data && list.data.total > 0 && <div className="border-t border-line"><Pagination page={page} pageSize={50} total={list.data.total} onChange={setPage} /></div>}
        </div>
      )}
      <AddGuestsDialog open={adding} onOpenChange={setAdding} eventId={e.id} onDone={refresh} />
      <ImportDialog open={importing} onOpenChange={setImporting} path={wp('/guests/import')!} eventId={e.id} onDone={refresh} />
      <QrDialog guest={qr} onOpenChange={(v) => !v && setQr(null)} />
      <SendDialog e={e} req={sending} onOpenChange={(v) => !v && setSending(null)} onDone={refresh} />
      <OverrideDrawer e={e} guest={editing} onOpenChange={(v) => !v && setEditing(null)} onDone={refresh} />
      <ConfirmDialog open={removing} onOpenChange={setRemoving} danger title={`Remove ${selected.size} guests from this event?`} confirmLabel="Remove" description="They stay in your guest directory and can be added again."
        onConfirm={async () => { try { await post(wp(`/events/${e.id}/guests/remove`)!, { eventGuestIds: [...selected] }); toast.success('Guests removed'); refresh(); } catch (err) { toast.error(err); } }} />
    </div>
  );
}

function AddGuestsDialog({ open, onOpenChange, eventId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; eventId: string; onDone: () => void }) {
  const wp = useWpath();
  const [mode, setMode] = useState<'new' | 'directory'>('new');
  const [rows, setRows] = useState([{ name: '', email: '', phone: '' }]);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const dir = useApi<{ items: any[] }>(open && mode === 'directory' ? wp(`/guests${qs({ search: q, pageSize: 100 })}`) : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const body = mode === 'new' ? { guests: rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name, email: r.email || undefined, phone: r.phone || undefined })) } : { guestIds: [...picked] };
      const r = await post(wp(`/events/${eventId}/guests`)!, body);
      toast.success(`${r.added} guest${r.added === 1 ? '' : 's'} added`);
      setRows([{ name: '', email: '', phone: '' }]); setPicked(new Set()); onOpenChange(false); onDone();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Add guests" description="Guests with an email that already exists in your directory are reused, not duplicated."
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={mode === 'new' ? !rows.some((r) => r.name.trim()) : !picked.size} onClick={submit}>Add to event</Button></>}>
      <Tabs value={mode} onChange={setMode} className="mb-4" items={[{ value: 'new', label: 'New guests' }, { value: 'directory', label: 'From directory' }]} />
      {mode === 'new' ? (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_120px] gap-2">
              <Input placeholder="Name" value={r.name} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, name: x.target.value } : y)))} aria-label={`Guest ${i + 1} name`} />
              <Input placeholder="Email" type="email" value={r.email} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, email: x.target.value } : y)))} aria-label={`Guest ${i + 1} email`} />
              <Input placeholder="Phone" value={r.phone} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, phone: x.target.value } : y)))} aria-label={`Guest ${i + 1} phone`} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setRows([...rows, { name: '', email: '', phone: '' }])}>Add row</Button>
        </div>
      ) : (
        <div>
          <SearchInput value={search} onChange={setSearch} className="sm:w-full mb-3" placeholder="Search your guest directory" />
          <div className="max-h-[320px] overflow-y-auto border border-line rounded-lg divide-y divide-line">
            {(dir.data?.items ?? []).map((g) => (
              <label key={g.id} className="flex items-center gap-3 px-3 h-11 cursor-pointer hover:bg-hover/50">
                <Checkbox checked={picked.has(g.id)} onChange={(v) => { const s = new Set(picked); if (v) s.add(g.id); else s.delete(g.id); setPicked(s); }} />
                <span className="text-[13px] flex-1">{g.name}<span className="text-muted ml-2">{g.email}</span></span>
                {g.group_name && <Badge>{g.group_name}</Badge>}
              </label>
            ))}
            {dir.data && !dir.data.items.length && <p className="text-[13px] text-muted p-4">No guests found.</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

const SEND_COPY = {
  invitation: { title: 'Send invitations', button: 'Send invitations', desc: 'Each guest receives a personal RSVP link by email.' },
  deadline_reminder: { title: 'Send RSVP reminder', button: 'Send reminders', desc: 'A gentle nudge to guests who haven’t responded.' },
  event_reminder: { title: 'Send event reminder', button: 'Send reminders', desc: 'Remind guests of the date and venue.' },
};

function SendDialog({ e, req, onOpenChange, onDone }: { e: any; req: { kind: keyof typeof SEND_COPY; ids?: string[]; audience: string } | null; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const wp = useWpath();
  const [prep, setPrep] = useState<any>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingPrep, setLoadingPrep] = useState(false);
  const open = Boolean(req);
  useEffect(() => {
    if (!req) return;
    setPrep(null); setConfirmed(false); setLoadingPrep(true);
    post(wp(`/events/${e.id}/invitations/prepare`)!, { eventGuestIds: req.ids, audience: req.audience }).then(setPrep).catch((err) => { toast.error(err); onOpenChange(false); }).finally(() => setLoadingPrep(false));
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = req ? SEND_COPY[req.kind] : SEND_COPY.invitation;
  const blocked = prep && (!prep.formPublished || e.status === 'draft');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={copy.title} description={copy.desc}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!prep || !confirmed || !prep.withEmail || blocked} onClick={async () => {
        setBusy(true);
        try { const r = await post(wp(`/events/${e.id}/invitations/send`)!, { eventGuestIds: prep.eventGuestIds, confirm: true, kind: req!.kind }); toast.success(`${r.queued} email${r.queued === 1 ? '' : 's'} queued`, r.skipped || r.suppressed ? `${r.skipped} without email, ${r.suppressed} unsubscribed.` : undefined); onOpenChange(false); onDone(); }
        catch (err) { toast.error(err); } finally { setBusy(false); }
      }}>{copy.button}{prep?.withEmail ? ` (${prep.withEmail})` : ''}</Button></>}>
      {loadingPrep || !prep ? <Skeleton className="h-24" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-line p-3"><p className="text-[12px] text-muted">Will receive email</p><p className="text-[20px] font-semibold tabular">{prep.withEmail}</p></div>
            <div className="rounded-lg border border-line p-3"><p className="text-[12px] text-muted">No email address</p><p className="text-[20px] font-semibold tabular">{prep.withoutEmail}</p></div>
            <div className="rounded-lg border border-line p-3"><p className="text-[12px] text-muted">Unsubscribed</p><p className="text-[20px] font-semibold tabular">{prep.suppressed}</p></div>
          </div>
          {prep.withoutEmail > 0 && <p className="text-[12.5px] text-muted">Guests without email still have a personal link you can copy from the guest list and share via WhatsApp or SMS.</p>}
          {!prep.formPublished && <p className="text-[13px] text-danger">Publish the RSVP form before sending.</p>}
          {e.status === 'draft' && <p className="text-[13px] text-danger">Publish the event (Settings tab) before sending.</p>}
          {prep.sample && <p className="text-[12.5px] text-ink-2">Example recipient: <b>{prep.sample.name}</b> &lt;{prep.sample.to}&gt;</p>}
          <label className="flex items-start gap-2.5 text-[13px] cursor-pointer"><Checkbox checked={confirmed} onChange={setConfirmed} className="mt-0.5" /><span>I confirm I want to email <b>{prep.withEmail}</b> {prep.withEmail === 1 ? 'person' : 'people'} now. Emails can’t be unsent.</span></label>
        </div>
      )}
    </Dialog>
  );
}

function OverrideDrawer({ e, guest, onOpenChange, onDone }: { e: any; guest: any; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const wp = useWpath();
  const [form, setForm] = useState<any>(null);
  const sessions = useApi<{ items: any[] }>(guest && e.sessions.length ? wp(`/events/${e.id}/guests/${guest.id}/sessions`) : null);
  useEffect(() => { if (guest) setForm({ rsvpStatus: guest.rsvp_status, adults: guest.adults, children: guest.children, meal: guest.meal ?? '', dietary: guest.dietary ?? '' }); }, [guest]);
  if (!guest || !form) return null;
  return (
    <Drawer open={Boolean(guest)} onOpenChange={onOpenChange} title={guest.name} width={440}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={async () => {
        try { await patch(wp(`/events/${e.id}/guests/${guest.id}`)!, { rsvpStatus: form.rsvpStatus, adults: Number(form.adults), children: Number(form.children), partySize: form.rsvpStatus === 'accepted' || form.rsvpStatus === 'maybe' ? Number(form.adults) + Number(form.children) : 0, meal: form.meal || null, dietary: form.dietary || null }); toast.success('RSVP updated'); onOpenChange(false); onDone(); }
        catch (err) { toast.error(err); }
      }}>Save</Button></>}>
      <div className="p-5 space-y-4">
        <p className="text-[12.5px] text-muted">Organizer override — useful for RSVPs received by phone or changes after the deadline. Recorded in the audit log.</p>
        <Field label="RSVP"><Select value={form.rsvpStatus} onChange={(x) => setForm({ ...form, rsvpStatus: x.target.value })}><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="maybe">Maybe</option><option value="declined">Declined</option></Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Adults"><Input type="number" min={0} value={form.adults} onChange={(x) => setForm({ ...form, adults: x.target.value })} /></Field><Field label="Children"><Input type="number" min={0} value={form.children} onChange={(x) => setForm({ ...form, children: x.target.value })} /></Field></div>
        <Field label="Meal (option ID)"><Input value={form.meal} onChange={(x) => setForm({ ...form, meal: x.target.value })} placeholder="e.g. vegetarian" /></Field>
        <Field label="Dietary notes"><Input value={form.dietary} onChange={(x) => setForm({ ...form, dietary: x.target.value })} /></Field>
        {sessions.data && sessions.data.items.length > 0 && (
          <div><p className="label">Sessions</p><div className="space-y-2">{sessions.data.items.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 text-[13px]"><span>{s.name}{s.checked_in ? <Badge tone="brand" className="ml-2">Checked in</Badge> : null}</span>
              <Select className="w-[130px] h-8" value={s.rsvp_status} onChange={async (x) => { try { await put(wp(`/events/${e.id}/guests/${guest.id}/sessions/${s.id}`)!, { rsvpStatus: x.target.value }); void sessions.refetch(); } catch (err) { toast.error(err); } }}>
                <option value="pending">Pending</option><option value="accepted">Accepted</option><option value="maybe">Maybe</option><option value="declined">Declined</option></Select></div>
          ))}</div></div>
        )}
      </div>
    </Drawer>
  );
}

function SessionsTab({ e, onChanged }: { e: any; onChanged: () => void }) {
  const wp = useWpath();
  const can = useCan();
  const [edit, setEdit] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const open = (s?: any) => setEdit(s ? { ...s, startsAt: isoToLocalInput(s.starts_at, e.timezone), endsAt: isoToLocalInput(s.ends_at, e.timezone), venueName: s.venue_name ?? '', address: s.address ?? '', capacity: s.capacity ?? '', optionId: s.option_id ?? '' } : { name: '', startsAt: '', endsAt: '', venueName: '', address: '', capacity: '', optionId: '', description: '' });
  const save = async () => {
    const body = { name: edit.name, description: edit.description ?? '', startsAt: edit.startsAt ? localInputToIso(edit.startsAt, e.timezone) : null, endsAt: edit.endsAt ? localInputToIso(edit.endsAt, e.timezone) : null, venueName: edit.venueName || null, address: edit.address || null, capacity: edit.capacity ? Number(edit.capacity) : null, ...(edit.optionId ? { optionId: edit.optionId } : {}) };
    try { if (edit.id) await patch(wp(`/events/${e.id}/sessions/${edit.id}`)!, body); else await post(wp(`/events/${e.id}/sessions`)!, body); toast.success('Session saved'); setEdit(null); onChanged(); } catch (err) { toast.error(err); }
  };
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-[13px] text-muted max-w-xl">Split a multi-part event (e.g. Mehendi, Ceremony, Reception) into sessions with their own time, venue and capacity. Guests choose sessions with an “Event selection” field whose option IDs match the session’s option ID.</p>
        {can.write && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open()}>Add session</Button>}
      </div>
      {e.sessions.length === 0 ? <div className="card"><EmptyState icon={<CalendarDays />} title="No sessions" description="Single-session events don’t need any." /></div> : (
        <div className="card divide-y divide-line">
          {e.sessions.map((s: any) => (
            <div key={s.id} className="flex flex-wrap items-center gap-4 px-4 py-3.5">
              <div className="flex-1 min-w-[200px]"><p className="text-[14px] font-medium">{s.name}</p><p className="text-[12.5px] text-muted">{s.starts_at ? fmtDateTime(s.starts_at, e.timezone) : 'Time TBC'}{s.venue_name ? ` · ${s.venue_name}` : ''} · option ID <code className="text-[11.5px]">{s.option_id}</code></p></div>
              <div className="flex gap-4 text-[12.5px] tabular text-ink-2"><span><b>{s.accepted}</b> accepted</span><span><b>{s.expected_attendees}</b>{s.capacity ? `/${s.capacity}` : ''} expected</span><span><b>{s.checked_in}</b> checked in</span></div>
              {can.write && <div className="flex gap-1"><Button size="icon-sm" variant="ghost" onClick={() => open(s)} aria-label="Edit session"><Pencil className="size-3.5" /></Button><Button size="icon-sm" variant="ghost" onClick={() => setDeleting(s)} aria-label="Delete session"><Trash2 className="size-3.5" /></Button></div>}
            </div>
          ))}
        </div>
      )}
      <Dialog open={Boolean(edit)} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? 'Edit session' : 'Add session'} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={!edit?.name?.trim()} onClick={save}>Save</Button></>}>
        {edit && <div className="space-y-3.5">
          <Field label="Name"><Input autoFocus value={edit.name} onChange={(x) => setEdit({ ...edit, name: x.target.value })} placeholder="Reception" /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label={`Starts (${e.timezone})`}><Input type="datetime-local" value={edit.startsAt} onChange={(x) => setEdit({ ...edit, startsAt: x.target.value })} /></Field><Field label="Ends"><Input type="datetime-local" value={edit.endsAt} onChange={(x) => setEdit({ ...edit, endsAt: x.target.value })} /></Field></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Venue"><Input value={edit.venueName} onChange={(x) => setEdit({ ...edit, venueName: x.target.value })} /></Field><Field label="Capacity"><Input type="number" min={1} value={edit.capacity} onChange={(x) => setEdit({ ...edit, capacity: x.target.value })} /></Field></div>
          <Field label="Address"><Input value={edit.address} onChange={(x) => setEdit({ ...edit, address: x.target.value })} /></Field>
          <Field label="Option ID" hint="Matches an option in the form’s Event selection field. Generated from the name if empty."><Input value={edit.optionId} onChange={(x) => setEdit({ ...edit, optionId: x.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} className="font-mono text-[12.5px]" /></Field>
        </div>}
      </Dialog>
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)} danger title={`Delete ${deleting?.name}?`} confirmLabel="Delete" onConfirm={async () => { await del(wp(`/events/${e.id}/sessions/${deleting.id}`)!); onChanged(); }} />
    </div>
  );
}

function FormsTab({ e, onChanged }: { e: any; onChanged: () => void }) {
  const wp = useWpath();
  const can = useCan();
  const navigate = useNavigate();
  const forms = useApi<{ items: any[] }>(wp('/forms?limit=100'));
  const [attach, setAttach] = useState('');
  const rsvpTemplates = TEMPLATES.filter((t) => t.isRsvp);
  const [tpl, setTpl] = useState(rsvpTemplates[0]!.id);
  const attached = new Set(e.forms.map((f: any) => f.id));
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 card">
        <div className="px-4 h-12 flex items-center border-b border-line"><h2 className="text-[13.5px] font-semibold">Assigned forms</h2></div>
        {e.forms.length === 0 ? <EmptyState compact icon={<FileText />} title="No forms assigned" description="The primary form is used for invitations and the public event page." /> : (
          <ul className="divide-y divide-line">{e.forms.map((f: any) => (
            <li key={f.id} className="flex items-center gap-3 px-4 h-14">
              <div className="flex-1 min-w-0"><p className="text-[13.5px] font-medium truncate flex items-center gap-2">{f.name}{f.is_primary ? <Badge tone="brand"><Star className="size-3" />Primary</Badge> : null}</p><p className="text-[12px] text-muted">{n(f.responses)} responses · /f/{f.slug}</p></div>
              <StatusBadge status={f.status} />
              <Menu><MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Form actions"><MoreHorizontal className="size-4" /></Button></MenuTrigger>
                <MenuContent>
                  <MenuItem icon={<Pencil />} onSelect={() => navigate(`/forms/${f.id}/edit`)}>Edit form</MenuItem>
                  {!f.is_primary && can.write && <MenuItem icon={<Star />} onSelect={async () => { await post(wp(`/events/${e.id}/forms`)!, { formId: f.id, isPrimary: true }); onChanged(); }}>Make primary</MenuItem>}
                  {can.write && <><MenuSeparator /><MenuItem icon={<Trash2 />} danger onSelect={async () => { await del(wp(`/events/${e.id}/forms/${f.id}`)!); onChanged(); }}>Unassign</MenuItem></>}
                </MenuContent></Menu>
            </li>
          ))}</ul>
        )}
      </div>
      {can.write && <div className="space-y-4">
        <div className="card p-4 space-y-3">
          <h3 className="text-[13.5px] font-semibold">Create an RSVP form</h3>
          <Select value={tpl} onChange={(x) => setTpl(x.target.value)} aria-label="Template">{rsvpTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          <Button variant="primary" className="w-full justify-center" onClick={() => createForm(navigate, { templateId: tpl, eventId: e.id, name: `${e.name} RSVP` })}>Create & open editor</Button>
        </div>
        <div className="card p-4 space-y-3">
          <h3 className="text-[13.5px] font-semibold">Assign an existing form</h3>
          <Select value={attach} onChange={(x) => setAttach(x.target.value)} aria-label="Form"><option value="">Choose a form…</option>{(forms.data?.items ?? []).filter((f) => !attached.has(f.id)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
          <Button className="w-full justify-center" disabled={!attach} onClick={async () => { try { await post(wp(`/events/${e.id}/forms`)!, { formId: attach }); setAttach(''); toast.success('Form assigned'); onChanged(); } catch (err) { toast.error(err); } }}>Assign</Button>
        </div>
      </div>}
    </div>
  );
}

export function EventAnalytics({ eventId, slug }: { eventId: string; slug: string }) {
  const wp = useWpath();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const a = useApi<any>(wp(`/analytics/events/${eventId}${qs({ from, to })}`));
  if (a.error) return <ErrorState error={a.error} onRetry={a.refetch} />;
  if (!a.data) return <Skeleton className="h-64" />;
  const d = a.data;
  const days = Math.min(90, Math.max(14, d.timeline.length ? Math.ceil((Date.now() - new Date(`${d.timeline[0].day}T00:00:00Z`).getTime()) / 86400000) + 1 : 14));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 justify-between">
        <div className="flex gap-2 items-end"><Field label="From"><Input type="date" value={from} onChange={(x) => setFrom(x.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(x) => setTo(x.target.value)} /></Field></div>
        <Button icon={<Download className="size-3.5" />} onClick={() => download(wp(`/analytics/events/${eventId}/export${qs({ from, to })}`)!, `${slug}-report.csv`).catch(toast.error)}>Export report</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Response rate" value={`${d.rsvp.responseRate}%`} hint={`${d.rsvp.accepted + d.rsvp.declined + d.rsvp.maybe} of ${d.rsvp.invited} replied`} />
        <Stat label="Expected attendees" value={n(d.expected.attendees)} hint={`${plural(d.expected.adults, 'adult')} · ${plural(d.expected.children, 'child', 'children')}`} accent="success" />
        <Stat label="Actual attendance" value={n(d.attendance.checkedInAttendees)} hint={`${plural(d.attendance.checkedInGuests, 'party', 'parties')} checked in`} accent="brand" />
        <Stat label="Check-in rate" value={`${d.attendance.checkInRate}%`} hint="of accepted guests" />
      </div>
      <div className="rounded-lg bg-info-50 border border-brand-100 px-4 py-2.5 text-[12.5px] text-ink-2"><b>Accepted</b> counts RSVPs; <b>actual attendance</b> counts only guests scanned or checked in at the door.</div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2"><h3 className="text-[13.5px] font-semibold mb-3">RSVPs over time</h3><LineChart data={fillDays(d.timeline, days, new Date(), ['accepted', 'declined', 'maybe'])} series={[{ key: 'accepted', label: 'Accepted', color: '#1F8A5B' }, { key: 'declined', label: 'Declined', color: '#E07A6A' }, { key: 'maybe', label: 'Maybe', color: '#B7791F' }]} /></div>
        <div className="card p-5"><h3 className="text-[13.5px] font-semibold mb-4">Status</h3><Donut segments={[{ label: 'Accepted', value: d.rsvp.accepted, color: '#1F8A5B' }, { label: 'Declined', value: d.rsvp.declined, color: '#E07A6A' }, { label: 'Maybe', value: d.rsvp.maybe, color: '#E8B65A' }, { label: 'Pending', value: d.rsvp.pending, color: '#DEDBD3' }]} /></div>
        <div className="card p-5"><h3 className="text-[13.5px] font-semibold mb-4">Meal preferences</h3><BarList items={d.meals.map((m: any) => ({ label: m.label, value: m.attendees }))} color="#F28B79" /></div>
        <div className="card p-5"><h3 className="text-[13.5px] font-semibold mb-4">Party sizes</h3><BarList items={d.partySizes.map((p: any) => ({ label: `${p.size} ${p.size === 1 ? 'guest' : 'guests'}`, value: p.n }))} /></div>
        <div className="card p-5"><h3 className="text-[13.5px] font-semibold mb-4">Invitations</h3><BarList items={[{ label: 'Sent', value: d.invitations?.sent ?? 0 }, { label: 'Delivered', value: d.invitations?.delivered ?? 0 }, { label: 'Opened', value: d.invitations?.opened ?? 0 }, { label: 'Responded', value: d.invitations?.responded ?? 0 }, { label: 'Failed', value: d.invitations?.failed ?? 0 }]} color="#5146D8" /></div>
      </div>
      {d.sessions.length > 0 && <div className="card"><Table rows={d.sessions} rowKey={(s: any) => s.id} columns={[
        { key: 'n', header: 'Session', cell: (s: any) => <span className="font-medium">{s.name}</span> }, { key: 'a', header: 'Accepted', cell: (s: any) => s.accepted },
        { key: 'e', header: 'Expected', cell: (s: any) => `${s.expected_attendees}${s.capacity ? ` / ${s.capacity}` : ''}` }, { key: 'c', header: 'Checked in', cell: (s: any) => s.checked_in },
      ]} /></div>}
    </div>
  );
}

function SettingsTab({ e, onChanged }: { e: any; onChanged: () => void }) {
  const wp = useWpath();
  const can = useCan();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<EventDraft>({ name: e.name, startsAt: isoToLocalInput(e.starts_at, e.timezone), endsAt: isoToLocalInput(e.ends_at, e.timezone), timezone: e.timezone, venueName: e.venue_name ?? '', address: e.address ?? '', capacity: e.capacity ? String(e.capacity) : '', rsvpDeadline: isoToLocalInput(e.rsvp_deadline, e.timezone), coverImage: e.cover_image ?? '', description: e.description ?? '' });
  const [busy, setBusy] = useState(false);
  const [broadcast, setBroadcast] = useState<'event_update' | 'cancellation' | null>(null);
  const [message, setMessage] = useState('');
  const [confirmSend, setConfirmSend] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const setStatus = async (status: string) => { try { await patch(wp(`/events/${e.id}`)!, { status }); toast.success('Status updated'); onChanged(); } catch (err) { toast.error(err); } };
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 card p-5">
        <EventForm value={draft} onChange={setDraft} />
        {can.write && <div className="flex justify-end mt-5"><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await patch(wp(`/events/${e.id}`)!, eventPayload(draft)); toast.success('Event saved'); onChanged(); } catch (err) { toast.error(err); } finally { setBusy(false); } }}>Save changes</Button></div>}
      </div>
      {can.write && <div className="space-y-4">
        <div className="card p-4 space-y-3">
          <h3 className="text-[13.5px] font-semibold">Status</h3>
          <Select value={e.status} onChange={(x) => x.target.value === 'cancelled' ? setBroadcast('cancellation') : void setStatus(x.target.value)} aria-label="Event status">
            <option value="draft">Draft — not visible to guests</option><option value="published">Published — accepting RSVPs</option><option value="active">Active — happening now</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="card p-4 space-y-3">
          <h3 className="text-[13.5px] font-semibold">Notify guests</h3>
          <p className="text-[12.5px] text-muted">Email everyone who hasn’t declined about a change.</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" icon={<Megaphone className="size-3.5" />} onClick={() => setBroadcast('event_update')}>Send update</Button><Button size="sm" variant="ghost" className="text-danger" onClick={() => setBroadcast('cancellation')}>Cancel event</Button></div>
        </div>
        <div className="card p-4 space-y-3">
          <h3 className="text-[13.5px] font-semibold">Export</h3>
          <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => download(wp(`/events/${e.id}/export`)!, `${e.slug}-guests.csv`).catch(toast.error)}>Guest list & RSVPs (CSV)</Button>
        </div>
        <div className="card p-4"><Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>Delete event</Button></div>
      </div>}
      <Dialog open={Boolean(broadcast)} onOpenChange={(v) => { if (!v) { setBroadcast(null); setConfirmSend(false); } }} title={broadcast === 'cancellation' ? 'Cancel event' : 'Send an update'}
        description={broadcast === 'cancellation' ? 'Marks the event cancelled, closes RSVPs and emails guests who haven’t declined.' : 'Emails guests who haven’t declined.'}
        footer={<><Button onClick={() => setBroadcast(null)}>Close</Button><Button variant={broadcast === 'cancellation' ? 'danger' : 'primary'} disabled={!message.trim() || !confirmSend} onClick={async () => {
          try { const r = await post(wp(`/events/${e.id}/broadcast`)!, { kind: broadcast, message, confirm: true }); toast.success(`${r.queued} emails queued`); setBroadcast(null); setMessage(''); setConfirmSend(false); onChanged(); } catch (err) { toast.error(err); }
        }}>{broadcast === 'cancellation' ? 'Cancel event & notify' : 'Send update'}</Button></>}>
        <div className="space-y-3"><Textarea rows={4} value={message} onChange={(x) => setMessage(x.target.value)} placeholder={broadcast === 'cancellation' ? 'We’re so sorry to share…' : 'The ceremony will now begin at 5 PM.'} />
          <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={confirmSend} onChange={setConfirmSend} />I confirm I want to email guests now.</label></div>
      </Dialog>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} danger title={`Delete ${e.name}?`} confirmLabel="Delete event" description="Guests stay in your directory. Responses are kept on their forms." onConfirm={async () => { await del(wp(`/events/${e.id}`)!); navigate('/events'); }} />
    </div>
  );
}
