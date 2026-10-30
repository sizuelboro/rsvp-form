import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, CheckCheck, Copy, Download, FileDown, Inbox, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import { useWpath, useCan } from '../../stores/session';
import { useApi, useDebounced } from '../../lib/hooks';
import { del, download, patch, post, qs } from '../../lib/api';
import { Avatar, Badge, Button, Checkbox, ConfirmDialog, Drawer, EmptyState, ErrorState, Input, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Textarea } from '../../components/ui';
import { fmtDateTime, timeAgo } from '../../lib/format';
import { toast } from '../../stores/toast';
import { RsvpBadge } from '../shared';

const HISTORY: Record<string, string> = { created: 'Submitted', edited_by_respondent: 'Updated by respondent', edited_by_organizer: 'Edited by', status_changed: 'Status changed by', deleted: 'Deleted by' };

function ResponseDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const wp = useWpath();
  const can = useCan();
  const r = useApi<any>(wp(`/submissions/${id}`));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [deleting, setDeleting] = useState(false);
  const d = r.data;
  const simple = (t: string) => ['short_text', 'long_text', 'email', 'phone', 'number', 'website', 'date', 'time'].includes(t);
  const save = async () => {
    try { await patch(wp(`/submissions/${id}`)!, { answers: draft }); toast.success('Response updated'); setEditing(false); void r.refetch(); onChanged(); }
    catch (e: any) { toast.error(e); }
  };
  const setStatus = async (status: string) => { try { await patch(wp(`/submissions/${id}`)!, { status }); void r.refetch(); onChanged(); } catch (e) { toast.error(e); } };
  return (
    <Drawer open onOpenChange={(v) => !v && onClose()} title={d ? (d.respondent_name ?? d.respondent_email ?? 'Response') : 'Response'} width={560}
      footer={d && can.write ? editing ? <><Button onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save changes</Button></> : <>
        <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>Delete</Button>
        <Select className="w-auto h-9" value={d.status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="complete">New</option><option value="reviewed">Reviewed</option><option value="archived">Archived</option><option value="spam">Spam</option></Select>
        <Button icon={<Pencil className="size-3.5" />} onClick={() => { setDraft({}); setEditing(true); }}>Edit</Button>
      </> : undefined}>
      {!d ? <div className="p-8 grid place-items-center"><Spinner /></div> : (
        <div>
          <div className="px-5 py-4 border-b border-line flex flex-wrap gap-2 items-center text-[12.5px]">
            <span className="text-muted">{d.form?.name} · v{d.version}</span>
            {d.rsvp_status && <RsvpBadge status={d.rsvp_status} />}
            {d.is_late ? <Badge tone="warning">Late</Badge> : null}
            {d.duplicate_of && <Badge tone="warning"><Copy className="size-3" />Possible duplicate</Badge>}
            {d.status === 'spam' && <Badge tone="danger">Spam (score {d.spam_score})</Badge>}
            <span className="ml-auto text-muted">{fmtDateTime(d.created_at)}</span>
          </div>
          <dl className="divide-y divide-line">
            {d.answers.map((a: any) => (
              <div key={a.fieldId} className="px-5 py-3.5">
                <dt className="text-[12px] text-muted mb-1">{a.label}</dt>
                <dd className="text-[13.5px] whitespace-pre-wrap break-words">
                  {editing && simple(a.type) ? (a.type === 'long_text'
                    ? <Textarea rows={3} defaultValue={(a.value as string) ?? ''} onChange={(e) => setDraft({ ...draft, [a.fieldId]: e.target.value })} />
                    : <Input defaultValue={a.value === null ? '' : String(a.value)} onChange={(e) => setDraft({ ...draft, [a.fieldId]: a.type === 'number' ? Number(e.target.value) : e.target.value })} />)
                  : a.type === 'signature' && a.value ? <img src={a.value} alt="Signature" className="max-h-24 border border-line rounded-md bg-white" />
                  : a.type === 'file_upload' && Array.isArray(a.value) ? a.value.map((f: any) => <Button key={f.key} size="sm" icon={<FileDown className="size-3.5" />} onClick={() => download(wp(`/submissions/${id}/files${qs({ key: f.key })}`)!, f.name).catch(toast.error)}>{f.name}</Button>)
                  : a.display || <span className="text-faint">—</span>}
                </dd>
              </div>
            ))}
          </dl>
          {editing && <p className="px-5 py-3 text-[12px] text-muted">Text fields can be edited here; choices are validated against form version {d.version}.</p>}
          <div className="px-5 py-4 border-t border-line">
            <p className="text-[12px] font-semibold text-muted mb-3">History</p>
            <ol className="space-y-2.5">{d.history.map((h: any) => (
              <li key={h.id} className="flex gap-2.5 text-[12.5px]"><span className="mt-1.5 size-1.5 rounded-full bg-line-strong shrink-0" /><span>{HISTORY[h.type] ?? h.type}{h.actor_name ? ` ${h.actor_name}` : ''}<span className="text-faint ml-2">{fmtDateTime(h.created_at)}</span></span></li>
            ))}</ol>
            <p className="text-[11.5px] text-faint mt-4">Device: {d.meta?.device ?? 'unknown'} · Response ID {d.id}</p>
          </div>
        </div>
      )}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} danger title="Delete this response?" confirmLabel="Delete" description="This removes it from exports and analytics."
        onConfirm={async () => { await del(wp(`/submissions/${id}`)!); toast.success('Response deleted'); onChanged(); onClose(); }} />
    </Drawer>
  );
}

export default function Responses() {
  const wp = useWpath();
  const can = useCan();
  const navigate = useNavigate();
  const { submissionId } = useParams();
  const [params, setParams] = useSearchParams();
  const formId = params.get('formId') ?? '';
  const eventId = params.get('eventId') ?? '';
  const [status, setStatus] = useState('all');
  const [rsvp, setRsvp] = useState('');
  const [dups, setDups] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const q = useDebounced(search);
  const forms = useApi<{ items: any[] }>(wp('/forms?limit=100'));
  const events = useApi<{ items: any[] }>(wp('/events'));
  const list = useApi<{ items: any[]; total: number }>(wp(`/submissions${qs({ formId, eventId, status, rsvp, duplicates: dups, from, to, search: q, page, pageSize: 50 })}`));
  const items = list.data?.items ?? [];
  const setParam = (k: string, v: string) => { if (v) params.set(k, v); else params.delete(k); setParams(params, { replace: true }); setPage(1); };
  const bulk = async (action: string) => { try { const r = await post(wp('/submissions/bulk')!, { ids: [...selected], action }); toast.success(`${r.affected} responses updated`); setSelected(new Set()); void list.refetch(); } catch (e) { toast.error(e); } };
  const formName = forms.data?.items.find((f) => f.id === formId)?.name;

  return (
    <div>
      <PageHeader title="Responses" description="Every submission across your forms, with history and duplicate detection."
        actions={<Button icon={<Download className="size-3.5" />} disabled={!formId} title={formId ? undefined : 'Choose a form to export'} onClick={() => download(wp(`/submissions/export/csv${qs({ formId, status, rsvp, from, to, search: q })}`)!, `${formName ?? 'responses'}.csv`).catch(toast.error)}>Export CSV</Button>} />
      <div className="flex flex-wrap gap-2 mb-4">
        <Select className="w-auto max-w-[220px]" value={formId} onChange={(e) => setParam('formId', e.target.value)} aria-label="Form"><option value="">All forms</option>{(forms.data?.items ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
        <Select className="w-auto max-w-[200px]" value={eventId} onChange={(e) => setParam('eventId', e.target.value)} aria-label="Event"><option value="">All events</option>{(events.data?.items ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
        <Select className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="all">All (excl. spam)</option><option value="complete">New</option><option value="reviewed">Reviewed</option><option value="archived">Archived</option><option value="spam">Spam</option></Select>
        <Select className="w-auto" value={rsvp} onChange={(e) => { setRsvp(e.target.value); setPage(1); }} aria-label="RSVP"><option value="">Any RSVP</option><option value="accepted">Accepted</option><option value="declined">Declined</option><option value="maybe">Maybe</option></Select>
        <Select className="w-auto" value={dups} onChange={(e) => { setDups(e.target.value); setPage(1); }} aria-label="Duplicates"><option value="">Duplicates: show</option><option value="only">Only duplicates</option><option value="exclude">Hide duplicates</option></Select>
        <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search answers" />
      </div>
      {selected.size > 0 && can.write && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-brand-50 border border-brand-100 text-[13px]">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" icon={<CheckCheck className="size-3.5" />} onClick={() => bulk('reviewed')}>Mark reviewed</Button>
          <Button size="sm" icon={<Archive className="size-3.5" />} onClick={() => bulk('archived')}>Archive</Button>
          <Button size="sm" icon={<ShieldAlert className="size-3.5" />} onClick={() => bulk('spam')}>Mark spam</Button>
          <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => bulk('delete')}>Delete</Button>
        </div>
      )}
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
        <div className="card">
          <Table loading={list.loading} rows={items} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/responses/${s.id}${location.search}`)}
            columns={[
              ...(can.write ? [{ key: 'sel', header: <Checkbox label="Select all" checked={items.length > 0 && items.every((s) => selected.has(s.id))} onChange={(v: boolean) => setSelected(v ? new Set(items.map((s) => s.id)) : new Set())} />, className: 'w-10 pr-0', headerClassName: 'w-10 pr-0', cell: (s: any) => <span onClick={(e) => e.stopPropagation()}><Checkbox label="Select" checked={selected.has(s.id)} onChange={(v) => { const n = new Set(selected); if (v) n.add(s.id); else n.delete(s.id); setSelected(n); }} /></span> }] : []),
              { key: 'who', header: 'Respondent', cell: (s) => <div className="flex items-center gap-2.5 min-w-[180px]"><Avatar name={s.respondent_name ?? s.respondent_email ?? '?'} /><div className="min-w-0"><p className="font-medium truncate">{s.respondent_name ?? 'Anonymous'}</p><p className="text-[12px] text-muted truncate">{s.respondent_email ?? '—'}</p></div></div> },
              { key: 'form', header: 'Form', cell: (s) => <div className="min-w-0"><p className="truncate max-w-[200px]">{s.form_name}</p>{s.event_name && <p className="text-[12px] text-muted truncate max-w-[200px]">{s.event_name}</p>}</div>, className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
              { key: 'rsvp', header: 'RSVP', cell: (s) => s.rsvp_status ? <RsvpBadge status={s.rsvp_status} /> : <span className="text-faint">—</span> },
              { key: 'flags', header: 'Flags', cell: (s) => <div className="flex gap-1">{s.duplicate_of && <Badge tone="warning">Duplicate</Badge>}{s.is_late ? <Badge tone="warning">Late</Badge> : null}{s.status === 'reviewed' && <Badge>Reviewed</Badge>}{s.status === 'archived' && <Badge>Archived</Badge>}{s.status === 'spam' && <Badge tone="danger">Spam</Badge>}</div>, className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
              { key: 'when', header: 'Submitted', cell: (s) => <span className="text-muted whitespace-nowrap" title={fmtDateTime(s.created_at)}>{timeAgo(s.created_at)}</span> },
            ]}
            empty={<EmptyState icon={<Inbox />} title="No responses yet" description="When people submit your published forms, their responses appear here." />} />
          {list.data && list.data.total > 0 && <div className="border-t border-line"><Pagination page={page} pageSize={50} total={list.data.total} onChange={setPage} /></div>}
        </div>
      )}
      {submissionId && <ResponseDrawer id={submissionId} onClose={() => navigate(`/responses${location.search}`)} onChanged={list.refetch} />}
    </div>
  );
}
