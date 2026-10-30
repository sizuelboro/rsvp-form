import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Globe, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { useSession, useWpath, useCan } from '../../stores/session';
import { useApi } from '../../lib/hooks';
import { del, download, patch, post, put } from '../../lib/api';
import { Avatar, Badge, Button, ConfirmDialog, Dialog, Field, Input, PageHeader, Segmented, Select, Switch, Table, Textarea, cn } from '../../components/ui';
import { fmtDate, fmtDateTime, n, timeAgo } from '../../lib/format';
import { toast } from '../../stores/toast';

const TABS = [
  { id: 'profile', label: 'Profile' }, { id: 'workspace', label: 'Workspace' }, { id: 'members', label: 'Members' }, { id: 'billing', label: 'Billing' },
  { id: 'notifications', label: 'Emails' }, { id: 'domains', label: 'Domains' }, { id: 'audit', label: 'Audit log' }, { id: 'privacy', label: 'Data & privacy' },
] as const;

function Card({ title, description, children, footer }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="card">
      <div className="px-5 pt-5"><h2 className="text-[14.5px] font-semibold">{title}</h2>{description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}</div>
      <div className="p-5">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
    </section>
  );
}

function Profile() {
  const user = useSession((s) => s.user)!;
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  return (
    <div className="space-y-4">
      <Card title="Profile" footer={<Button variant="primary" disabled={!name.trim() || name === user.name} onClick={async () => { try { await patch('/auth/me', { name }); await useSession.getState().load(); toast.success('Profile saved'); } catch (e) { toast.error(e); } }}>Save</Button>}>
        <div className="grid sm:grid-cols-2 gap-4"><Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Email"><Input value={user.email} disabled /></Field></div>
      </Card>
      <Card title="Password" description="Changing your password signs out your other sessions." footer={<Button variant="primary" disabled={!pw.current || pw.next.length < 8} onClick={async () => { try { await patch('/auth/me', { currentPassword: pw.current, newPassword: pw.next }); setPw({ current: '', next: '' }); toast.success('Password updated'); } catch (e) { toast.error(e); } }}>Update password</Button>}>
        <div className="grid sm:grid-cols-2 gap-4"><Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field><Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field></div>
      </Card>
    </div>
  );
}

function Workspace() {
  const ws = useSession((s) => s.workspace)!;
  const can = useCan();
  const [name, setName] = useState(ws.name);
  const [logo, setLogo] = useState(ws.branding.logoUrl ?? '');
  const [hide, setHide] = useState(Boolean(ws.branding.hideBranding));
  const canBrand = ws.entitlements.features.customBranding;
  return (
    <Card title="Workspace" footer={can.manage && <Button variant="primary" onClick={async () => {
      try { await patch(`/w/${ws.id}`, { name, branding: { logoUrl: logo, hideBranding: hide } }); await useSession.getState().load(); toast.success('Workspace saved'); } catch (e) { toast.error(e); }
    }}>Save</Button>}>
      <div className="space-y-4 max-w-lg">
        <Field label="Workspace name"><Input value={name} disabled={!can.manage} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Logo URL" hint="Shown on public forms (https://)"><Input value={logo} disabled={!can.manage} onChange={(e) => setLogo(e.target.value)} placeholder="https://" /></Field>
        <div className="flex items-center justify-between"><div><p className="text-[13px] font-medium">Remove “Made with Invitely”</p><p className="hint">{canBrand ? 'Applies to all public forms in this workspace.' : 'Available on Pro and above.'}</p></div><Switch checked={hide} disabled={!canBrand || !can.manage} onChange={setHide} /></div>
      </div>
    </Card>
  );
}

function Members() {
  const ws = useSession((s) => s.workspace)!;
  const me = useSession((s) => s.user)!;
  const can = useCan();
  const list = useApi<{ members: any[]; pending: any[] }>(`/w/${ws.id}/members`);
  const [invite, setInvite] = useState<{ email: string; role: string } | null>(null);
  const team = ws.entitlements.features.teamCollaboration;
  return (
    <Card title="Members" description={`${ws.usage.members} of ${ws.entitlements.limits.members} seats used`}>
      <div className="flex justify-end mb-3">{can.manage && <Button variant="primary" icon={<UserPlus className="size-4" />} disabled={!team} title={team ? undefined : 'Team collaboration is available on Business'} onClick={() => setInvite({ email: '', role: 'editor' })}>Invite</Button>}</div>
      {!team && <p className="text-[12.5px] text-muted mb-3">Team collaboration is available on the Business and Agency plans.</p>}
      <div className="border border-line rounded-lg">
        <Table rows={list.data?.members ?? []} rowKey={(m) => m.id} loading={list.loading} columns={[
          { key: 'u', header: 'Member', cell: (m) => <div className="flex items-center gap-2.5"><Avatar name={m.name} /><div><p className="font-medium">{m.name}{m.id === me.id && <span className="text-faint font-normal"> (you)</span>}</p><p className="text-[12px] text-muted">{m.email}</p></div></div> },
          { key: 'r', header: 'Role', cell: (m) => m.role === 'owner' || !can.manage ? <Badge tone={m.role === 'owner' ? 'brand' : 'neutral'}>{m.role}</Badge> : (
            <Select className="w-[120px] h-8" value={m.role} onChange={async (e) => { try { await patch(`/w/${ws.id}/members/${m.id}`, { role: e.target.value }); void list.refetch(); } catch (err) { toast.error(err); } }}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></Select>
          ) },
          { key: 'x', header: '', className: 'w-12', cell: (m) => m.role !== 'owner' && can.manage && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.name}`} onClick={async () => { await del(`/w/${ws.id}/members/${m.id}`); void list.refetch(); }}><Trash2 className="size-3.5" /></Button> },
        ]} />
      </div>
      {(list.data?.pending ?? []).length > 0 && <div className="mt-4"><p className="label">Pending invitations</p><ul className="text-[13px] space-y-1.5">{list.data!.pending.map((p) => <li key={p.id} className="flex gap-2"><span>{p.email}</span><Badge>{p.role}</Badge><span className="text-faint">expires {fmtDate(p.expires_at)}</span></li>)}</ul></div>}
      <div className="mt-5 text-[12.5px] text-muted grid sm:grid-cols-3 gap-3">
        <p><b className="text-ink">Admin</b> — manage members, domains and integrations.</p><p><b className="text-ink">Editor</b> — build forms, manage events, guests and check-in.</p><p><b className="text-ink">Viewer</b> — read-only access to forms, responses and analytics.</p>
      </div>
      <Dialog open={Boolean(invite)} onOpenChange={(v) => !v && setInvite(null)} title="Invite a teammate" footer={<><Button onClick={() => setInvite(null)}>Cancel</Button><Button variant="primary" disabled={!invite?.email.includes('@')} onClick={async () => {
        try { await post(`/w/${ws.id}/members/invite`, invite!); toast.success('Invitation sent'); setInvite(null); void list.refetch(); } catch (e) { toast.error(e); }
      }}>Send invitation</Button></>}>
        {invite && <div className="space-y-3.5"><Field label="Email"><Input autoFocus type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
          <Field label="Role"><Segmented value={invite.role} onChange={(v) => setInvite({ ...invite, role: v })} items={[{ value: 'admin', label: 'Admin' }, { value: 'editor', label: 'Editor' }, { value: 'viewer', label: 'Viewer' }]} /></Field></div>}
      </Dialog>
    </Card>
  );
}

const FEATURE_LABELS: Record<string, string> = { conditionalLogic: 'Conditional logic', advancedThemes: 'Advanced themes', customBranding: 'Custom branding', guestManagement: 'Guest management', customDomain: 'Custom domain', advancedAnalytics: 'Advanced analytics', teamCollaboration: 'Team collaboration', emailInvitations: 'Email invitations', whiteLabel: 'White-label', integrations: 'Integrations & webhooks' };
const LIMIT_LABELS: Record<string, string> = { forms: 'Forms', monthlySubmissions: 'Responses / month', events: 'Events', guests: 'Guests', members: 'Team members' };

function Billing() {
  const ws = useSession((s) => s.workspace)!;
  const can = useCan();
  const plans = useApi<{ items: any[] }>(`/w/${ws.id}/billing/plans`);
  const sub = useApi<any>(`/w/${ws.id}/billing/subscription`);
  const [currency, setCurrency] = useState<'inr' | 'usd'>('inr');
  const e = ws.entitlements;
  const checkout = async (planId: string) => {
    const provider = currency === 'inr' ? 'razorpay' : 'stripe';
    try { const r = await post(`/w/${ws.id}/billing/checkout`, { planId, provider }); window.location.assign(r.url); } catch (err) { toast.error(err); }
  };
  return (
    <div className="space-y-4">
      <Card title="Current plan">
        <div className="flex flex-wrap items-center gap-3 mb-5"><p className="text-[20px] font-semibold">{e.planName}</p>{e.status === 'trialing' && <Badge tone="brand">Trial ends {fmtDate(e.trialEndsAt)}</Badge>}{sub.data?.subscription?.status === 'past_due' && <Badge tone="danger">Payment past due</Badge>}</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {Object.entries(LIMIT_LABELS).map(([k, l]) => {
            const used = ws.usage[k] ?? 0, max = e.limits[k] ?? 0;
            return <div key={k} className="rounded-lg border border-line p-3"><p className="text-[12px] text-muted">{l}</p><p className="text-[15px] font-semibold tabular mt-0.5">{n(used)} <span className="text-faint font-normal text-[12px]">/ {n(max)}</span></p><div className="h-1 rounded-full bg-hover mt-2 overflow-hidden"><div className={cn('h-full rounded-full', used / max > 0.9 ? 'bg-danger' : 'bg-brand-500')} style={{ width: `${Math.min(100, (used / Math.max(1, max)) * 100)}%` }} /></div></div>;
          })}
        </div>
      </Card>
      <div className="flex justify-between items-center"><h2 className="text-[15px] font-semibold">Plans</h2><Segmented size="sm" value={currency} onChange={setCurrency} items={[{ value: 'inr', label: '₹ INR (Razorpay)' }, { value: 'usd', label: '$ USD (Stripe)' }]} /></div>
      <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-3">
        {(plans.data?.items ?? []).map((p) => {
          const current = p.id === (sub.data?.subscription?.plan_id ?? 'free') && e.status !== 'trialing';
          return (
            <div key={p.id} className={cn('card p-4 flex flex-col', p.id === 'pro' && 'border-brand-500 ring-2 ring-brand-500/15')}>
              <div className="flex items-center gap-2"><p className="text-[14px] font-semibold">{p.name}</p>{p.id === 'pro' && <Badge tone="brand">Popular</Badge>}</div>
              <p className="text-[22px] font-semibold mt-2 tabular">{currency === 'inr' ? `₹${n(p.price_monthly_inr)}` : `$${p.price_monthly_usd}`}<span className="text-[12px] text-muted font-normal">/mo</span></p>
              <ul className="mt-3 space-y-1.5 text-[12.5px] flex-1">
                {Object.entries(LIMIT_LABELS).map(([k, l]) => <li key={k} className="text-ink-2">{n(p.limits[k])} {l.toLowerCase()}</li>)}
                {Object.entries(p.features).filter(([, v]) => v).map(([k]) => <li key={k} className="flex gap-1.5"><Check className="size-3.5 text-success mt-0.5 shrink-0" />{FEATURE_LABELS[k] ?? k}</li>)}
              </ul>
              {p.id !== 'free' && <Button className="mt-4 justify-center" variant={current ? 'secondary' : 'primary'} disabled={current || !can.billing} onClick={() => checkout(p.id)}>{current ? 'Current plan' : 'Choose'}</Button>}
            </div>
          );
        })}
      </div>
      {sub.data && !sub.data.providers[currency === 'inr' ? 'razorpay' : 'stripe'] && <p className="hint">Online checkout for {currency === 'inr' ? 'Razorpay' : 'Stripe'} isn’t configured on this deployment yet. Limits are enforced server-side from the plan table.</p>}
    </div>
  );
}

function Emails() {
  const wp = useWpath();
  const can = useCan();
  const tpls = useApi<{ items: any[] }>(wp('/notifications/email-templates'));
  const jobs = useApi<{ items: any[] }>(wp('/notifications/jobs?limit=50'));
  const [sel, setSel] = useState<string>('invitation');
  const cur = tpls.data?.items.find((t) => t.type === sel);
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  useEffect(() => { if (cur) { setDraft({ subject: cur.subject, body: cur.body }); setPreview(null); } }, [cur?.type, cur?.subject, cur?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const failed = (jobs.data?.items ?? []).filter((j) => j.status === 'failed').length;
  return (
    <div className="space-y-4">
      <Card title="Email templates" description="Personalize the emails guests receive. Variables in {{double braces}} are filled in automatically.">
        <div className="grid md:grid-cols-[200px_1fr] gap-5">
          <ul className="space-y-0.5">{(tpls.data?.items ?? []).map((t) => <li key={t.type}><button onClick={() => setSel(t.type)} className={cn('w-full text-left px-2.5 h-8 rounded-md text-[13px] cursor-pointer flex items-center justify-between', sel === t.type ? 'bg-hover font-medium' : 'hover:bg-hover/60 text-ink-2')}>{t.type.replace(/_/g, ' ')}{t.isCustom && <span className="size-1.5 rounded-full bg-brand-500" />}</button></li>)}</ul>
          {cur && <div className="space-y-3">
            <Field label="Subject"><Input value={draft.subject} disabled={!can.write} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
            <Field label="Body" hint={<>Available: {cur.variables.map((v: string) => <code key={v} className="mr-1.5 text-[11.5px]">{`{{${v}}}`}</code>)}</>}><Textarea rows={8} value={draft.body} disabled={!can.write} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-2 justify-end">
              {cur.isCustom && can.write && <Button variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={async () => { await del(wp(`/notifications/email-templates/${sel}`)!); void tpls.refetch(); }}>Reset to default</Button>}
              <Button onClick={async () => { try { setPreview(await post(wp(`/notifications/email-templates/${sel}/preview`)!, draft)); } catch (e) { toast.error(e); } }}>Preview</Button>
              {can.write && <Button variant="primary" onClick={async () => { try { await put(wp(`/notifications/email-templates/${sel}`)!, draft); toast.success('Template saved'); void tpls.refetch(); } catch (e) { toast.error(e); } }}>Save</Button>}
            </div>
            {preview && <div className="rounded-lg border border-line overflow-hidden"><p className="px-3 py-2 text-[12.5px] border-b border-line bg-hover/50"><b>Subject:</b> {preview.subject}</p><iframe title="Email preview" sandbox="" srcDoc={preview.html} className="w-full h-[380px] bg-white" /></div>}
          </div>}
        </div>
      </Card>
      <Card title="Delivery log" description="Emails are processed by a background queue with automatic retries.">
        <div className="flex justify-end mb-3">{failed > 0 && can.write && <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={async () => { const r = await post(wp('/notifications/jobs/retry-failed')!); toast.success(`${r.retried} emails re-queued`); setTimeout(() => void jobs.refetch(), 2000); }}>Retry {failed} failed</Button>}</div>
        <div className="border border-line rounded-lg"><Table rows={jobs.data?.items ?? []} rowKey={(j) => j.id} loading={jobs.loading} columns={[
          { key: 't', header: 'Type', cell: (j) => <span className="text-[12.5px]">{j.type.replace(/_/g, ' ')}</span> },
          { key: 'r', header: 'Recipient', cell: (j) => <span className="text-[12.5px] text-ink-2 truncate max-w-[220px] inline-block">{j.channel === 'webhook' ? 'Webhook' : j.recipient}</span> },
          { key: 's', header: 'Status', cell: (j) => <span title={j.last_error ?? undefined}><Badge tone={j.status === 'delivered' || j.status === 'sent' ? 'success' : j.status === 'failed' ? 'danger' : 'neutral'}>{j.status}{j.attempts > 1 ? ` · ${j.attempts} tries` : ''}</Badge></span> },
          { key: 'w', header: 'When', cell: (j) => <span className="text-muted text-[12.5px]">{timeAgo(j.created_at)}</span> },
          { key: 'a', header: '', className: 'w-20', cell: (j) => j.status === 'failed' && can.write && <Button size="sm" variant="ghost" onClick={async () => { await post(wp(`/notifications/jobs/${j.id}/retry`)!); toast.success('Re-queued'); setTimeout(() => void jobs.refetch(), 2000); }}>Retry</Button> },
        ]} /></div>
      </Card>
    </div>
  );
}

function Domains() {
  const wp = useWpath();
  const can = useCan();
  const ws = useSession((s) => s.workspace)!;
  const list = useApi<{ items: any[] }>(wp('/domains'));
  const [host, setHost] = useState('');
  return (
    <Card title="Custom domains" description="Serve your public forms from your own domain, e.g. rsvp.yourwedding.com.">
      {!ws.entitlements.features.customDomain ? <p className="text-[13px] text-muted">Custom domains are available on Pro and above.</p> : <>
        {can.manage && <form className="flex gap-2 mb-4" onSubmit={async (e) => { e.preventDefault(); try { await post(wp('/domains')!, { hostname: host }); setHost(''); void list.refetch(); } catch (err) { toast.error(err); } }}><Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="rsvp.example.com" icon={<Globe />} /><Button type="submit" disabled={!host}>Add domain</Button></form>}
        <div className="space-y-3">{(list.data?.items ?? []).map((d) => (
          <div key={d.id} className="rounded-lg border border-line p-4">
            <div className="flex items-center gap-2"><p className="text-[14px] font-medium flex-1">{d.hostname}</p><Badge tone={d.status === 'verified' ? 'success' : d.status === 'failed' ? 'danger' : 'warning'}>{d.status}</Badge>
              {can.manage && <><Button size="sm" onClick={async () => { const r = await post(wp(`/domains/${d.id}/verify`)!); toast[r.verified ? 'success' : 'info'](r.verified ? 'Domain verified' : 'TXT record not found yet — DNS can take a while'); void list.refetch(); }}>Verify</Button><Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={async () => { await del(wp(`/domains/${d.id}`)!); void list.refetch(); }}><Trash2 className="size-3.5" /></Button></>}</div>
            {d.status !== 'verified' && <div className="mt-3 text-[12.5px] text-ink-2 space-y-1"><p>1. Add a <b>TXT</b> record: <code>_invitely.{d.hostname}</code> → <code className="break-all">{d.verification_token}</code></p><p>2. Add a <b>CNAME</b> record: <code>{d.hostname}</code> → <code>{location.host}</code>, then click Verify.</p></div>}
          </div>
        ))}{list.data && !list.data.items.length && <p className="text-[13px] text-muted">No domains connected.</p>}</div>
      </>}
    </Card>
  );
}

function Audit() {
  const wp = useWpath();
  const can = useCan();
  const list = useApi<{ items: any[] }>(can.manage ? wp('/audit-logs') : null);
  if (!can.manage) return <Card title="Audit log"><p className="text-[13px] text-muted">Only owners and admins can view the audit log.</p></Card>;
  return (
    <Card title="Audit log" description="Security-relevant actions in this workspace.">
      <div className="border border-line rounded-lg"><Table rows={list.data?.items ?? []} rowKey={(a) => a.id} loading={list.loading} columns={[
        { key: 'a', header: 'Action', cell: (a) => <code className="text-[12px]">{a.action}</code> }, { key: 'u', header: 'By', cell: (a) => a.actor_name ?? 'System / guest' },
        { key: 'e', header: 'Target', cell: (a) => <span className="text-muted text-[12px]">{a.entity_type ? `${a.entity_type} ${a.entity_id?.slice(-6)}` : '—'}</span>, className: 'hidden md:table-cell', headerClassName: 'hidden md:table-cell' },
        { key: 't', header: 'When', cell: (a) => <span className="text-muted text-[12.5px] whitespace-nowrap">{fmtDateTime(a.created_at)}</span> },
      ]} /></div>
    </Card>
  );
}

function Privacy() {
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  return (
    <div className="space-y-4">
      <Card title="Export your data" description="Download a JSON file with every workspace you own: forms, events, guests and responses."><Button onClick={() => download('/auth/me/export', 'invitely-export.json').catch(toast.error)}>Download export</Button></Card>
      <Card title="Delete account" description="Deletes your account and every workspace you own. This can’t be undone."><Button variant="danger" onClick={() => setDeleting(true)}>Delete my account</Button></Card>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} danger title="Delete your account?" confirmLabel="Delete permanently" description="Public forms in workspaces you own will stop working immediately."
        onConfirm={async () => { try { await del('/auth/me', { password }); await useSession.getState().logout(); navigate('/signup'); } catch (e) { toast.error(e); throw e; } }}>
        <Field label="Confirm with your password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
      </ConfirmDialog>
    </div>
  );
}

export default function SettingsPage() {
  const { tab = 'profile' } = useParams();
  const navigate = useNavigate();
  const view = { profile: <Profile />, workspace: <Workspace />, members: <Members />, billing: <Billing />, notifications: <Emails />, domains: <Domains />, audit: <Audit />, privacy: <Privacy /> }[tab] ?? <Profile />;
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid md:grid-cols-[180px_1fr] gap-6">
        <nav className="flex md:flex-col gap-0.5 overflow-x-auto" aria-label="Settings">
          {TABS.map((t) => <button key={t.id} onClick={() => navigate(`/settings/${t.id}`)} className={cn('text-left px-3 h-8 rounded-md text-[13px] whitespace-nowrap cursor-pointer', tab === t.id ? 'bg-surface border border-line shadow-xs font-medium' : 'text-ink-2 hover:bg-hover border border-transparent')}>{t.label}</button>)}
        </nav>
        <div className="min-w-0">{view}</div>
      </div>
    </div>
  );
}
