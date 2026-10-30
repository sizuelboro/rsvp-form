import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Download, Home, Plus, Tag, Trash2, Upload, Users, CalendarPlus } from 'lucide-react';
import { useWpath, useCan, useSession } from '../../stores/session';
import { useApi, useDebounced } from '../../lib/hooks';
import { del, download, patch, post, qs, get } from '../../lib/api';
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, Drawer, EmptyState, ErrorState, Input, PageHeader, Pagination, SearchInput, Select, Table, Tabs } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import { toast } from '../../stores/toast';
import { RsvpBadge, InviteBadge } from '../shared';
import { GuestForm, ImportDialog, emptyGuest, guestPayload, type GuestDraft } from './components';

function MetaManager({ kind, onChanged }: { kind: 'groups' | 'households'; onChanged: () => void }) {
  const wp = useWpath();
  const can = useCan();
  const list = useApi<{ items: any[] }>(wp(`/guests/meta/${kind}`));
  const [name, setName] = useState('');
  return (
    <div className="card">
      {can.write && <form className="flex gap-2 p-4 border-b border-line" onSubmit={async (e) => { e.preventDefault(); try { await post(wp(`/guests/meta/${kind}`)!, { name }); setName(''); void list.refetch(); onChanged(); } catch (err) { toast.error(err); } }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'groups' ? 'New group, e.g. College friends' : 'New household, e.g. The Sharmas'} />
        <Button type="submit" disabled={!name.trim()} icon={<Plus className="size-3.5" />}>Add</Button>
      </form>}
      <ul className="divide-y divide-line">
        {(list.data?.items ?? []).map((g) => (
          <li key={g.id} className="flex items-center gap-3 px-4 h-12 text-[13.5px]">
            {kind === 'groups' ? <Tag className="size-4 text-muted" /> : <Home className="size-4 text-muted" />}
            <span className="flex-1">{g.name}</span><span className="text-muted tabular text-[12.5px]">{g.guest_count} guests</span>
            {can.write && <Button size="icon-sm" variant="ghost" aria-label={`Delete ${g.name}`} onClick={async () => { await del(wp(`/guests/meta/${kind}/${g.id}`)!); void list.refetch(); onChanged(); }}><Trash2 className="size-3.5" /></Button>}
          </li>
        ))}
        {list.data && !list.data.items.length && <li className="p-6 text-center text-[13px] text-muted">None yet.</li>}
      </ul>
    </div>
  );
}

function GuestDrawer({ id, onClose, onChanged, groups, households }: { id: string | 'new'; onClose: () => void; onChanged: () => void; groups: any[]; households: any[] }) {
  const wp = useWpath();
  const can = useCan();
  const [draft, setDraft] = useState<GuestDraft>(emptyGuest());
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (id === 'new') { setDraft(emptyGuest()); setDetail(null); return; }
    get(wp(`/guests/${id}`)!).then((g) => {
      setDetail(g);
      setDraft({ name: g.name, email: g.email ?? '', phone: g.phone ?? '', groupId: g.group_id ?? '', householdId: g.household_id ?? '', dietary: g.dietary ?? '', notes: g.notes ?? '', attributes: Object.entries(g.attributes ?? {}).map(([key, value]) => ({ key, value: String(value) })) });
    }).catch((e) => { toast.error(e); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    try {
      if (id === 'new') await post(wp('/guests')!, guestPayload(draft)); else await patch(wp(`/guests/${id}`)!, guestPayload(draft));
      toast.success(id === 'new' ? 'Guest added' : 'Guest saved'); onChanged(); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onOpenChange={(v) => !v && onClose()} title={id === 'new' ? 'Add guest' : draft.name || 'Guest'} width={480}
      footer={can.write ? <>{id !== 'new' && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>Delete</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!draft.name.trim()} onClick={save}>Save</Button></> : undefined}>
      <div className="p-5"><GuestForm value={draft} onChange={setDraft} groups={groups} households={households} /></div>
      {detail?.events?.length > 0 && (
        <div className="px-5 pb-5">
          <p className="label">Events</p>
          <ul className="rounded-lg border border-line divide-y divide-line">{detail.events.map((e: any) => (
            <li key={e.id}><Link to={`/events/${e.id}`} className="flex items-center gap-2 px-3 h-11 text-[13px] hover:bg-hover/50"><span className="flex-1 truncate">{e.name}</span><InviteBadge status={e.invitation_status} /><RsvpBadge status={e.rsvp_status} />{e.checked_in_at && <Badge tone="brand">Checked in</Badge>}</Link></li>
          ))}</ul>
        </div>
      )}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} danger title={`Delete ${draft.name}?`} confirmLabel="Delete guest" description="They’ll be removed from every event guest list." onConfirm={async () => { await del(wp(`/guests/${id}`)!); onChanged(); onClose(); }} />
    </Drawer>
  );
}

export default function Guests() {
  const wp = useWpath();
  const can = useCan();
  const features = useSession((s) => s.workspace?.entitlements.features);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'directory' | 'groups' | 'households'>('directory');
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState('');
  const [householdId, setHouseholdId] = useState('');
  const [sort, setSort] = useState('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const q = useDebounced(search);
  const enabled = Boolean(features?.guestManagement);
  const list = useApi<{ items: any[]; total: number }>(enabled ? wp(`/guests${qs({ search: q, groupId, householdId, sort, dir, page, pageSize: 50 })}`) : null);
  const groups = useApi<{ items: any[] }>(enabled ? wp('/guests/meta/groups') : null);
  const households = useApi<{ items: any[] }>(enabled ? wp('/guests/meta/households') : null);
  const events = useApi<{ items: any[] }>(wp('/events'));
  const [importing, setImporting] = useState(false);
  const [bulkAction, setBulkAction] = useState<'set_group' | 'set_household' | 'add_to_event' | 'delete' | null>(null);
  const [bulkValue, setBulkValue] = useState('');
  const open = params.get('guest');
  const setOpen = (id: string | null) => { if (id) params.set('guest', id); else params.delete('guest'); setParams(params, { replace: true }); };
  const refresh = () => { void list.refetch(); void groups.refetch(); void households.refetch(); setSelected(new Set()); };
  const items = list.data?.items ?? [];
  const toggleSort = (key: string) => { if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir('asc'); } };
  const SortHead = ({ k, label }: { k: string; label: string }) => <button className="flex items-center gap-1 cursor-pointer hover:text-ink" onClick={() => toggleSort(k)}>{label}<ArrowDownUp className={`size-3 ${sort === k ? 'text-ink' : 'text-faint'}`} /></button>;

  if (!enabled) return <div><PageHeader title="Guests" /><div className="card"><EmptyState icon={<Users />} title="Guest management is available on Pro" description="Build a reusable guest directory with groups, households, CSV import and per-event RSVP tracking." action={<Link to="/settings/billing"><Button variant="primary">View plans</Button></Link>} /></div></div>;

  return (
    <div>
      <PageHeader title="Guests" description="A reusable directory — add a guest once, invite them to any event."
        actions={<>
          <Button icon={<Download className="size-3.5" />} onClick={() => download(wp('/guests/export/csv')!, 'guests.csv').catch(toast.error)}>Export</Button>
          {can.write && <><Button icon={<Upload className="size-3.5" />} onClick={() => setImporting(true)}>Import CSV</Button><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen('new')}>Add guest</Button></>}
        </>} />
      <Tabs value={tab} onChange={setTab} className="mb-4" items={[{ value: 'directory', label: 'Directory', count: list.data?.total }, { value: 'groups', label: 'Groups', count: groups.data?.items.length }, { value: 'households', label: 'Households', count: households.data?.items.length }]} />
      {tab === 'groups' && <MetaManager kind="groups" onChanged={refresh} />}
      {tab === 'households' && <MetaManager kind="households" onChanged={refresh} />}
      {tab === 'directory' && <>
        <div className="flex flex-wrap gap-2 mb-4">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, email, phone, notes" />
          <Select className="w-auto" value={groupId} onChange={(e) => { setGroupId(e.target.value); setPage(1); }} aria-label="Group"><option value="">All groups</option>{(groups.data?.items ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
          <Select className="w-auto" value={householdId} onChange={(e) => { setHouseholdId(e.target.value); setPage(1); }} aria-label="Household"><option value="">All households</option>{(households.data?.items ?? []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</Select>
        </div>
        {selected.size > 0 && can.write && (
          <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-brand-50 border border-brand-100 text-[13px]">
            <span className="font-medium">{selected.size} selected</span>
            <Button size="sm" icon={<CalendarPlus className="size-3.5" />} onClick={() => { setBulkAction('add_to_event'); setBulkValue(''); }}>Add to event</Button>
            <Button size="sm" icon={<Tag className="size-3.5" />} onClick={() => { setBulkAction('set_group'); setBulkValue(''); }}>Set group</Button>
            <Button size="sm" icon={<Home className="size-3.5" />} onClick={() => { setBulkAction('set_household'); setBulkValue(''); }}>Set household</Button>
            <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setBulkAction('delete')}>Delete</Button>
          </div>
        )}
        {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
          <div className="card">
            <Table loading={list.loading} rows={items} rowKey={(g) => g.id} onRowClick={(g) => setOpen(g.id)}
              columns={[
                ...(can.write ? [{ key: 'sel', header: <Checkbox label="Select all" checked={items.length > 0 && items.every((g) => selected.has(g.id))} onChange={(v: boolean) => setSelected(v ? new Set(items.map((g) => g.id)) : new Set())} />, className: 'w-10 pr-0', headerClassName: 'w-10 pr-0', cell: (g: any) => <span onClick={(e) => e.stopPropagation()}><Checkbox label={`Select ${g.name}`} checked={selected.has(g.id)} onChange={(v) => { const s = new Set(selected); if (v) s.add(g.id); else s.delete(g.id); setSelected(s); }} /></span> }] : []),
                { key: 'name', header: <SortHead k="name" label="Name" />, cell: (g) => <span className="font-medium">{g.name}</span> },
                { key: 'email', header: <SortHead k="email" label="Contact" />, cell: (g) => <div className="text-[12.5px]"><p>{g.email ?? '—'}</p>{g.phone && <p className="text-muted">{g.phone}</p>}</div> },
                { key: 'group', header: 'Group', cell: (g) => g.group_name ? <Badge>{g.group_name}</Badge> : <span className="text-faint">—</span>, className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
                { key: 'hh', header: 'Household', cell: (g) => <span className="text-muted">{g.household_name ?? '—'}</span>, className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
                { key: 'events', header: 'Events', cell: (g) => <span className="tabular">{g.event_count}</span>, className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
                { key: 'added', header: <SortHead k="created_at" label="Added" />, cell: (g) => <span className="text-muted">{fmtDate(g.created_at)}</span>, className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
              ]}
              empty={<EmptyState icon={<Users />} title={search || groupId || householdId ? 'No guests match' : 'Your guest directory is empty'} description="Import a spreadsheet or add guests one at a time." action={can.write && !search ? <div className="flex gap-2"><Button onClick={() => setImporting(true)}>Import CSV</Button><Button variant="primary" onClick={() => setOpen('new')}>Add guest</Button></div> : undefined} />} />
            {list.data && list.data.total > 0 && <div className="border-t border-line"><Pagination page={page} pageSize={50} total={list.data.total} onChange={setPage} /></div>}
          </div>
        )}
      </>}
      {open && <GuestDrawer id={open} onClose={() => setOpen(null)} onChanged={refresh} groups={groups.data?.items ?? []} households={households.data?.items ?? []} />}
      <ImportDialog open={importing} onOpenChange={setImporting} path={wp('/guests/import')!} onDone={refresh} />
      <Dialog open={bulkAction !== null && bulkAction !== 'delete'} onOpenChange={(v) => !v && setBulkAction(null)} size="sm"
        title={bulkAction === 'add_to_event' ? 'Add to event' : bulkAction === 'set_group' ? 'Set group' : 'Set household'}
        footer={<><Button onClick={() => setBulkAction(null)}>Cancel</Button><Button variant="primary" disabled={bulkAction === 'add_to_event' && !bulkValue} onClick={async () => {
          try {
            const r = await post(wp('/guests/bulk')!, { guestIds: [...selected], action: bulkAction, ...(bulkAction === 'add_to_event' ? { eventId: bulkValue } : bulkAction === 'set_group' ? { groupId: bulkValue || null } : { householdId: bulkValue || null }) });
            toast.success(`${r.affected} guests updated`); setBulkAction(null); refresh();
          } catch (e) { toast.error(e); }
        }}>Apply</Button></>}>
        <Select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="Choose">
          <option value="">{bulkAction === 'add_to_event' ? 'Choose an event…' : 'None'}</option>
          {(bulkAction === 'add_to_event' ? events.data?.items : bulkAction === 'set_group' ? groups.data?.items : households.data?.items)?.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
      </Dialog>
      <ConfirmDialog open={bulkAction === 'delete'} onOpenChange={(v) => !v && setBulkAction(null)} danger title={`Delete ${selected.size} guests?`} confirmLabel="Delete" description="They’ll be removed from every event guest list."
        onConfirm={async () => { try { await post(wp('/guests/bulk')!, { guestIds: [...selected], action: 'delete' }); toast.success('Guests deleted'); refresh(); } catch (e) { toast.error(e); } }} />
    </div>
  );
}
