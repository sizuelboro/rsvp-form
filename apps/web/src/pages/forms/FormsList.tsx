import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, ExternalLink, FileText, Inbox, MailCheck, MoreHorizontal, Pencil, Plus, Trash2, BarChart3 } from 'lucide-react';
import { useWpath, useCan } from '../../stores/session';
import { useApi, useDebounced } from '../../lib/hooks';
import { del, post, qs } from '../../lib/api';
import { Button, ConfirmDialog, EmptyState, ErrorState, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, PageHeader, SearchInput, Segmented, Table } from '../../components/ui';
import { n, timeAgo } from '../../lib/format';
import { toast } from '../../stores/toast';
import { CreateMenu } from '../../app/AppShell';
import { StatusBadge } from '../shared';

export default function FormsList() {
  const wp = useWpath();
  const can = useCan();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'draft' | 'published' | 'closed'>('all');
  const q = useDebounced(search);
  const list = useApi<{ items: any[] }>(wp(`/forms${qs({ search: q, status: status === 'all' ? undefined : status, limit: 100 })}`));
  const [deleting, setDeleting] = useState<any>(null);

  const copyLink = (f: any) => { void navigator.clipboard.writeText(`${location.origin}/f/${f.slug}`); toast.success('Link copied'); };
  const duplicate = async (f: any) => { try { const r = await post(wp(`/forms/${f.id}/duplicate`)!); toast.success('Form duplicated'); navigate(`/forms/${r.id}/edit`); } catch (e) { toast.error(e); } };

  return (
    <div>
      <PageHeader title="My Forms" description="Build, publish and track every form and RSVP." actions={can.write && <CreateMenu />} />
      <div className="flex flex-col sm:flex-row gap-3 justify-between mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search forms" />
        <Segmented value={status} onChange={setStatus} size="sm" items={[{ value: 'all', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'closed', label: 'Closed' }]} />
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={list.refetch} /> : (
        <div className="card">
          <Table
            loading={list.loading}
            rows={list.data?.items ?? []}
            rowKey={(f) => f.id}
            onRowClick={(f) => navigate(`/forms/${f.id}/edit`)}
            columns={[
              { key: 'name', header: 'Name', cell: (f) => (
                <div className="flex items-center gap-3 min-w-[220px]">
                  <span className="size-8 rounded-lg bg-hover grid place-items-center shrink-0">{f.kind === 'rsvp' ? <MailCheck className="size-4 text-muted" /> : <FileText className="size-4 text-muted" />}</span>
                  <div className="min-w-0"><p className="font-medium truncate">{f.name}</p><p className="text-[12px] text-muted truncate">/f/{f.slug}{f.event_name ? ` · ${f.event_name}` : ''}</p></div>
                </div>
              ) },
              { key: 'status', header: 'Status', cell: (f) => <StatusBadge status={f.status} /> },
              { key: 'responses', header: 'Responses', cell: (f) => <span className="tabular">{n(f.responses)}</span>, className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
              { key: 'last', header: 'Last response', cell: (f) => <span className="text-muted">{f.last_response_at ? timeAgo(f.last_response_at) : '—'}</span>, className: 'hidden lg:table-cell', headerClassName: 'hidden lg:table-cell' },
              { key: 'updated', header: 'Edited', cell: (f) => <span className="text-muted">{timeAgo(f.updated_at)}</span>, className: 'hidden sm:table-cell', headerClassName: 'hidden sm:table-cell' },
              { key: 'menu', header: <span className="sr-only">Actions</span>, className: 'w-12', cell: (f) => (
                <div onClick={(e) => e.stopPropagation()}>
                  <Menu>
                    <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${f.name}`}><MoreHorizontal className="size-4" /></Button></MenuTrigger>
                    <MenuContent>
                      <MenuItem icon={<Pencil />} onSelect={() => navigate(`/forms/${f.id}/edit`)}>Edit</MenuItem>
                      <MenuItem icon={<Inbox />} onSelect={() => navigate(`/responses?formId=${f.id}`)}>Responses</MenuItem>
                      <MenuItem icon={<BarChart3 />} onSelect={() => navigate(`/analytics?formId=${f.id}`)}>Analytics</MenuItem>
                      {f.published_version_id && <MenuItem icon={<ExternalLink />} onSelect={() => window.open(`/f/${f.slug}`, '_blank', 'noopener')}>Open live form</MenuItem>}
                      {f.published_version_id && <MenuItem icon={<Copy />} onSelect={() => copyLink(f)}>Copy link</MenuItem>}
                      {can.write && <><MenuSeparator /><MenuItem icon={<Plus />} onSelect={() => duplicate(f)}>Duplicate</MenuItem><MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(f)}>Delete</MenuItem></>}
                    </MenuContent>
                  </Menu>
                </div>
              ) },
            ]}
            empty={<EmptyState icon={<FileText />} title={search || status !== 'all' ? 'No forms match' : 'Create your first form'} description={search || status !== 'all' ? 'Try a different search or filter.' : 'Start from scratch or pick one of 20 polished templates.'}
              action={!search && status === 'all' && can.write ? <div className="flex gap-2"><Button onClick={() => navigate('/templates')}>Browse templates</Button><CreateMenu /></div> : undefined} />}
          />
        </div>
      )}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)} danger title={`Delete “${deleting?.name}”?`} confirmLabel="Delete form"
        description="The public link will stop working. Existing responses are kept for your records."
        onConfirm={async () => { try { await del(wp(`/forms/${deleting.id}`)!); toast.success('Form deleted'); void list.refetch(); } catch (e) { toast.error(e); } }} />
    </div>
  );
}
