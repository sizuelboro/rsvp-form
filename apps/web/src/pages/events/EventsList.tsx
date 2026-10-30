import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, MapPin, Plus, Users } from 'lucide-react';
import { useWpath, useCan } from '../../stores/session';
import { useApi, useDebounced } from '../../lib/hooks';
import { post, qs } from '../../lib/api';
import { Button, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, SearchInput, Segmented, Select, Skeleton, Textarea } from '../../components/ui';
import { browserTz, fmtDate, localInputToIso, n, TIMEZONES } from '../../lib/format';
import { toast } from '../../stores/toast';
import { StatusBadge } from '../shared';

export function EventForm({ value, onChange }: { value: EventDraft; onChange: (v: EventDraft) => void }) {
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <Field label="Event name" htmlFor="ev-name"><Input id="ev-name" autoFocus value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Sarah & John’s Wedding" /></Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Starts"><Input type="datetime-local" value={value.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
        <Field label="Ends"><Input type="datetime-local" value={value.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
      </div>
      <Field label="Time zone" hint="Dates are shown to guests in this time zone and stored in UTC."><Select value={value.timezone} onChange={(e) => set('timezone', e.target.value)}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Venue"><Input value={value.venueName} onChange={(e) => set('venueName', e.target.value)} placeholder="The Leela Palace" /></Field>
        <Field label="Capacity" hint="Leave empty for unlimited"><Input type="number" min={1} value={value.capacity} onChange={(e) => set('capacity', e.target.value)} /></Field>
      </div>
      <Field label="Address"><Input value={value.address} onChange={(e) => set('address', e.target.value)} placeholder="Lake Pichola, Udaipur, Rajasthan" /></Field>
      <Field label="RSVP deadline"><Input type="datetime-local" value={value.rsvpDeadline} onChange={(e) => set('rsvpDeadline', e.target.value)} /></Field>
      <Field label="Cover image URL"><Input value={value.coverImage} onChange={(e) => set('coverImage', e.target.value)} placeholder="https://" /></Field>
      <Field label="Description"><Textarea rows={3} value={value.description} onChange={(e) => set('description', e.target.value)} placeholder="Share details guests should know." /></Field>
    </div>
  );
}

export interface EventDraft { name: string; startsAt: string; endsAt: string; timezone: string; venueName: string; address: string; capacity: string; rsvpDeadline: string; coverImage: string; description: string }
export const emptyEvent = (): EventDraft => ({ name: '', startsAt: '', endsAt: '', timezone: browserTz(), venueName: '', address: '', capacity: '', rsvpDeadline: '', coverImage: '', description: '' });

export function eventPayload(d: EventDraft) {
  const tz = d.timezone;
  return {
    name: d.name.trim(), timezone: tz, description: d.description,
    startsAt: d.startsAt ? localInputToIso(d.startsAt, tz) : null, endsAt: d.endsAt ? localInputToIso(d.endsAt, tz) : null,
    rsvpDeadline: d.rsvpDeadline ? localInputToIso(d.rsvpDeadline, tz) : null,
    venueName: d.venueName || null, address: d.address || null, capacity: d.capacity ? Number(d.capacity) : null,
    coverImage: /^https:\/\//.test(d.coverImage) ? d.coverImage : null,
  };
}

export default function EventsList() {
  const wp = useWpath();
  const can = useCan();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const q = useDebounced(search);
  const list = useApi<{ items: any[] }>(wp(`/events${qs({ search: q, status: status === 'all' ? undefined : status })}`));
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyEvent());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (params.get('new')) { setCreating(true); setDraft(emptyEvent()); params.delete('new'); setParams(params, { replace: true }); } }, [params, setParams]);

  const create = async () => {
    setBusy(true);
    try { const r = await post<{ id: string }>(wp('/events')!, eventPayload(draft)); toast.success('Event created'); navigate(`/events/${r.id}`); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Events" description="Sessions, guest lists, invitations and check-in in one place." actions={can.write && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => { setDraft(emptyEvent()); setCreating(true); }}>New event</Button>} />
      <div className="flex flex-col sm:flex-row gap-3 justify-between mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search events" />
        <Segmented size="sm" value={status} onChange={setStatus} items={[{ value: 'all', label: 'All' }, { value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }]} />
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : list.loading && !list.data ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[220px] rounded-xl" />)}</div>
      ) : !list.data?.items.length ? (
        <div className="card"><EmptyState icon={<CalendarDays />} title={search || status !== 'all' ? 'No events match' : 'Plan your first event'} description="Add sessions, import your guest list, attach an RSVP form and send personal invitations." action={can.write && !search ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New event</Button> : undefined} /></div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.data.items.map((e) => {
            const responded = e.accepted + e.declined;
            return (
              <button key={e.id} onClick={() => navigate(`/events/${e.id}`)} className="card text-left overflow-hidden hover:shadow-md hover:border-line-strong transition-all cursor-pointer group">
                <div className="h-24 bg-gradient-to-br from-brand-50 to-coral-50 relative">
                  {e.cover_image && <img src={e.cover_image} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />}
                  <div className="absolute top-3 right-3"><StatusBadge status={e.status} /></div>
                </div>
                <div className="p-4">
                  <p className="text-[15px] font-semibold truncate group-hover:text-brand-600">{e.name}</p>
                  <p className="text-[12.5px] text-muted mt-1 flex items-center gap-1.5"><CalendarDays className="size-3.5" />{e.starts_at ? fmtDate(e.starts_at, e.timezone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date TBC'}</p>
                  {e.venue_name && <p className="text-[12.5px] text-muted mt-0.5 flex items-center gap-1.5 truncate"><MapPin className="size-3.5" />{e.venue_name}</p>}
                  <div className="mt-4 h-1.5 rounded-full bg-hover overflow-hidden flex">
                    <div className="bg-success" style={{ width: `${e.invited ? (e.accepted / e.invited) * 100 : 0}%` }} />
                    <div className="bg-danger/70" style={{ width: `${e.invited ? (e.declined / e.invited) * 100 : 0}%` }} />
                  </div>
                  <div className="flex justify-between text-[12px] mt-2 tabular">
                    <span className="text-muted flex items-center gap-1"><Users className="size-3.5" />{n(e.invited)} invited · {e.invited ? Math.round((responded / e.invited) * 100) : 0}% replied</span>
                    <span className="text-ink-2 font-medium">{n(e.expected_attendees)} expected</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating} title="New event" description="You can add sessions, guests and RSVP forms next." size="md"
        footer={<><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!draft.name.trim()} onClick={create}>Create event</Button></>}>
        <EventForm value={draft} onChange={setDraft} />
      </Dialog>
    </div>
  );
}
