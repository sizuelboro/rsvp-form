import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, BookOpen, CalendarDays, ChevronsUpDown, FileText, Inbox, LayoutGrid, LayoutTemplate, LifeBuoy, LineChart, LogOut, Menu as MenuIcon,
  MessageSquareHeart, Plug, Plus, Search, Settings, Sparkles, Users, X, Check, CalendarPlus, FilePlus2, MailCheck, CreditCard, User,
} from 'lucide-react';
import { useSession } from '../stores/session';
import { Avatar, Badge, Button, cn, Dialog, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, Textarea, Kbd } from '../components/ui';
import { get, post } from '../lib/api';
import { useDebounced, useHotkey } from '../lib/hooks';
import { timeAgo } from '../lib/format';
import { toast } from '../stores/toast';
import { createForm } from './actions';
import { activityLabel } from '../pages/shared';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/forms', label: 'My Forms', icon: FileText },
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/responses', label: 'Responses', icon: Inbox },
  { to: '/guests', label: 'Guests', icon: Users },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/analytics', label: 'Analytics', icon: LineChart },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function WorkspaceSwitcher() {
  const { workspaces, workspaceId, selectWorkspace, workspace } = useSession();
  const navigate = useNavigate();
  const current = workspaces.find((w) => w.id === workspaceId);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button className="w-full flex items-center gap-2.5 px-2 h-11 rounded-lg hover:bg-hover transition-colors cursor-pointer text-left" aria-label="Switch workspace">
            <span className="size-7 rounded-lg bg-brand-500 text-white grid place-items-center text-[12px] font-semibold shrink-0">{(current?.name ?? 'W')[0]?.toUpperCase()}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13.5px] font-semibold truncate">{current?.name ?? 'Workspace'}</span>
              <span className="block text-[11.5px] text-muted truncate">{workspace?.entitlements.planName ?? '…'} plan{workspace?.entitlements.status === 'trialing' ? ' · trial' : ''}</span>
            </span>
            <ChevronsUpDown className="size-4 text-faint" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="w-[240px]">
          <MenuLabel>Workspaces</MenuLabel>
          {workspaces.map((w) => (
            <MenuItem key={w.id} onSelect={() => { void selectWorkspace(w.id); navigate('/'); }} icon={w.id === workspaceId ? <Check /> : <span className="size-4" />}>{w.name}</MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={<Plus />} onSelect={() => setCreating(true)}>New workspace</MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={creating} onOpenChange={setCreating} title="Create a workspace" description="Workspaces keep forms, events and guests separate — for example one per client."
        footer={<><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={async () => {
          try { const r = await post<{ id: string }>('/workspaces', { name }); await useSession.getState().load(); await selectWorkspace(r.id); setCreating(false); setName(''); navigate('/'); toast.success('Workspace created'); } catch (e) { toast.error(e); }
        }}>Create</Button></>}>
        <input autoFocus className="w-full h-9 px-3 border border-line-strong rounded-md text-[13.5px] outline-none focus:border-brand-500" placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} />
      </Dialog>
    </>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, workspace, logout } = useSession();
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState(false);
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2"><WorkspaceSwitcher /></div>
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5" aria-label="Main">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate}
            className={({ isActive }) => cn('flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13.5px] transition-colors', isActive ? 'bg-surface text-ink font-medium shadow-xs border border-line' : 'text-ink-2 hover:bg-hover hover:text-ink border border-transparent')}>
            <item.icon className="size-4 shrink-0 opacity-80" />{item.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-3 pb-3 pt-2 border-t border-line space-y-0.5">
        <NavLink to="/help" onClick={onNavigate} className="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13px] text-ink-2 hover:bg-hover"><LifeBuoy className="size-4 opacity-70" />Help Center</NavLink>
        <NavLink to="/help#docs" onClick={onNavigate} className="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13px] text-ink-2 hover:bg-hover"><BookOpen className="size-4 opacity-70" />Documentation</NavLink>
        <button onClick={() => setFeedback(true)} className="w-full flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13px] text-ink-2 hover:bg-hover cursor-pointer"><MessageSquareHeart className="size-4 opacity-70" />Feedback</button>
        {workspace && workspace.entitlements.planId !== 'agency' && (
          <NavLink to="/settings/billing" onClick={onNavigate} className="flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13px] text-ink-2 hover:bg-hover">
            <CreditCard className="size-4 opacity-70" /><span className="flex-1">Subscription</span><Badge tone="brand">{workspace.entitlements.planName}</Badge>
          </NavLink>
        )}
        <Menu>
          <MenuTrigger asChild>
            <button className="w-full flex items-center gap-2.5 px-2 h-10 mt-1 rounded-md hover:bg-hover cursor-pointer text-left">
              <Avatar name={user?.name ?? '?'} size={26} />
              <span className="flex-1 min-w-0"><span className="block text-[13px] font-medium truncate">{user?.name}</span><span className="block text-[11.5px] text-muted truncate">{user?.email}</span></span>
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuItem icon={<User />} onSelect={() => { navigate('/settings/profile'); onNavigate?.(); }}>Profile</MenuItem>
            <MenuItem icon={<CreditCard />} onSelect={() => { navigate('/settings/billing'); onNavigate?.(); }}>Billing</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LogOut />} onSelect={async () => { await logout(); navigate('/login'); }}>Sign out</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <FeedbackDialog open={feedback} onOpenChange={setFeedback} />
    </div>
  );
}

function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const wid = useSession((s) => s.workspaceId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Send feedback" description="Tell us what’s working and what isn’t. We read everything."
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={text.trim().length < 3} onClick={async () => {
        setBusy(true);
        try { await post(`/w/${wid}/feedback`, { message: text, page: window.location.pathname }); toast.success('Thanks for the feedback!'); setText(''); onOpenChange(false); } catch (e) { toast.error(e); } finally { setBusy(false); }
      }}>Send</Button></>}>
      <Textarea autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="I wish I could…" maxLength={4000} />
    </Dialog>
  );
}

function CommandSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const wid = useSession((s) => s.workspaceId);
  const navigate = useNavigate();
  const [res, setRes] = useState<{ forms: any[]; events: any[]; guests: any[] } | null>(null);
  useEffect(() => {
    if (!dq.trim() || !wid) { setRes(null); return; }
    let live = true;
    get(`/w/${wid}/search?q=${encodeURIComponent(dq)}`).then((r) => live && setRes(r)).catch(() => undefined);
    return () => { live = false; };
  }, [dq, wid]);
  const go = (path: string) => { onOpenChange(false); setQ(''); navigate(path); };
  const groups = res ? [
    { title: 'Forms', items: res.forms.map((f) => ({ id: f.id, label: f.name, sub: f.status, path: `/forms/${f.id}/edit`, icon: FileText })) },
    { title: 'Events', items: res.events.map((e) => ({ id: e.id, label: e.name, sub: e.status, path: `/events/${e.id}`, icon: CalendarDays })) },
    { title: 'Guests', items: res.guests.map((g) => ({ id: g.id, label: g.name, sub: g.email, path: `/guests?guest=${g.id}`, icon: Users })) },
  ].filter((g) => g.items.length) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Search" size="md">
      <div className="-mt-1">
        <div className="relative"><Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search forms, events and guests…" className="w-full h-11 pl-9 pr-3 rounded-lg border border-line-strong text-[14px] outline-none focus:border-brand-500" /></div>
        <div className="mt-3 max-h-[50vh] overflow-y-auto">
          {!q && <p className="text-[13px] text-muted px-1 py-4">Type to search across your workspace.</p>}
          {q && res && !groups.length && <p className="text-[13px] text-muted px-1 py-4">No results for “{q}”.</p>}
          {groups.map((g) => (
            <div key={g.title} className="mb-3">
              <p className="text-[11px] uppercase tracking-wide font-medium text-faint px-1 mb-1">{g.title}</p>
              {g.items.map((it) => (
                <button key={it.id} onClick={() => go(it.path)} className="w-full flex items-center gap-3 px-2 h-10 rounded-md hover:bg-hover text-left cursor-pointer">
                  <it.icon className="size-4 text-muted" /><span className="text-[13.5px] flex-1 truncate">{it.label}</span><span className="text-[12px] text-faint truncate max-w-[40%]">{it.sub}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}


function Notifications() {
  const wid = useSession((s) => s.workspaceId);
  const [items, setItems] = useState<any[] | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const load = () => {
    if (!wid) return;
    get(`/w/${wid}/activity`).then((r) => setItems(r.items)).catch(() => setItems([]));
    get(`/w/${wid}/notifications/jobs?status=failed&limit=5`).then((r) => setJobs(r.items)).catch(() => undefined);
  };
  return (
    <Popover align="end" className="w-[340px] p-0"
      trigger={<Button variant="ghost" size="icon" aria-label="Notifications" onClick={load}><Bell className="size-[18px]" /></Button>}>
      <div className="px-4 py-3 border-b border-line flex items-center justify-between"><span className="text-[13.5px] font-semibold">Activity</span></div>
      <div className="max-h-[380px] overflow-y-auto">
        {jobs.length > 0 && (
          <NavLink to="/settings/notifications" className="flex gap-2.5 px-4 py-3 border-b border-line bg-danger-50/60 text-[12.5px]">
            <MailCheck className="size-4 text-danger shrink-0" /><span><b>{jobs.length} email{jobs.length > 1 ? 's' : ''} failed to send.</b> Review and retry.</span>
          </NavLink>
        )}
        {items === null && <p className="text-[13px] text-muted p-4">Loading…</p>}
        {items?.length === 0 && <p className="text-[13px] text-muted p-4">No activity yet.</p>}
        {items?.map((a) => (
          <div key={a.id} className="flex gap-2.5 px-4 py-2.5 border-b border-line last:border-0">
            <Avatar name={a.actor_name ?? 'Guest'} size={24} />
            <div className="text-[12.5px] leading-snug"><span className="font-medium">{a.actor_name ?? 'Someone'}</span> {activityLabel(a.action)}<div className="text-faint text-[11.5px] mt-0.5">{timeAgo(a.created_at)}</div></div>
          </div>
        ))}
      </div>
    </Popover>
  );
}

export function CreateMenu({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger asChild>{children ?? <Button variant="primary" icon={<Plus className="size-4" />}>Create</Button>}</MenuTrigger>
      <MenuContent>
        <MenuItem icon={<FilePlus2 />} onSelect={() => createForm(navigate, { kind: 'form' })}>Blank form</MenuItem>
        <MenuItem icon={<MailCheck />} onSelect={() => createForm(navigate, { kind: 'rsvp' })}>RSVP form</MenuItem>
        <MenuItem icon={<CalendarPlus />} onSelect={() => navigate('/events?new=1')}>Event</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Sparkles />} onSelect={() => navigate('/templates')}>From a template</MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  useHotkey('mod+k', (e) => { e.preventDefault(); setSearchOpen(true); });
  useEffect(() => setMobileOpen(false), [location.pathname]);
  return (
    <div className="flex h-full">
      <aside className="hidden lg:flex w-[248px] shrink-0 flex-col border-r border-line bg-canvas"><SidebarContent /></aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-ink/25 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[272px] bg-canvas border-r border-line shadow-lg animate-slide-in-right">
            <button className="absolute right-2 top-3 p-2 text-muted" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="size-4" /></button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 flex items-center gap-2 px-4 lg:px-8 border-b border-line bg-canvas/80 backdrop-blur sticky top-0 z-30">
          <Button variant="ghost" size="icon" className="lg:hidden -ml-2" onClick={() => setMobileOpen(true)} aria-label="Open menu"><MenuIcon className="size-5" /></Button>
          <button onClick={() => setSearchOpen(true)} className="flex items-center gap-2 h-9 px-3 w-full max-w-[360px] rounded-lg border border-line bg-surface text-[13px] text-faint hover:border-line-strong transition-colors cursor-pointer">
            <Search className="size-4" /><span className="flex-1 text-left">Search…</span><span className="hidden sm:flex gap-0.5"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </button>
          <div className="flex-1" />
          <Notifications />
          <CreateMenu />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1180px] mx-auto px-4 lg:px-8 py-6 lg:py-8"><Outlet /></div>
        </main>
      </div>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
