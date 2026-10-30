import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, CalendarPlus, FilePlus2, FileText, Inbox, MailCheck, Sparkles } from 'lucide-react';
import { useSession, useWpath } from '../stores/session';
import { useApi } from '../lib/hooks';
import { Avatar, Badge, EmptyState, Skeleton, Stat } from '../components/ui';
import { fmtDate, n, timeAgo } from '../lib/format';
import { createForm } from '../app/actions';
import { LineChart, fillDays } from '../components/charts';
import { StatusBadge, RsvpBadge, activityLabel } from './shared';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Panel({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 h-12 border-b border-line">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        <Link to={to} className="text-[12.5px] text-muted hover:text-ink flex items-center gap-1">View all <ArrowRight className="size-3.5" /></Link>
      </div>
      {children}
    </section>
  );
}

export default function Overview() {
  const user = useSession((s) => s.user);
  const ws = useSession((s) => s.workspace);
  const wp = useWpath();
  const navigate = useNavigate();
  const stats = useApi(wp('/analytics/overview'));
  const forms = useApi(wp('/forms?limit=5'));
  const events = useApi(wp('/events'));
  const responses = useApi(wp('/submissions?pageSize=6'));
  const activity = useApi(wp('/activity'));
  const t = stats.data?.totals;

  const quick = [
    { label: 'Create form', desc: 'Start from a blank canvas', icon: FilePlus2, onClick: () => createForm(navigate, { kind: 'form' }) },
    { label: 'Create RSVP', desc: 'Attendance, guests and meals', icon: MailCheck, onClick: () => createForm(navigate, { kind: 'rsvp' }) },
    { label: 'Create event', desc: 'Sessions, guest list, check-in', icon: CalendarPlus, onClick: () => navigate('/events?new=1') },
    { label: 'Browse templates', desc: '20 ready-made designs', icon: Sparkles, onClick: () => navigate('/templates') },
  ];
  const upcoming = (events.data?.items ?? []).filter((e: any) => e.status !== 'cancelled').slice(0, 4);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{greeting()}, {user?.name.split(' ')[0]}</h1>
          <p className="text-[13.5px] text-muted mt-1">Here’s what’s happening in {ws?.name}.</p>
        </div>
        {ws?.entitlements.status === 'trialing' && ws.entitlements.trialEndsAt && (
          <Link to="/settings/billing"><Badge tone="brand">{ws.entitlements.planName} trial · ends {fmtDate(ws.entitlements.trialEndsAt)}</Badge></Link>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stats.loading && !t ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[86px] rounded-xl" />) : <>
          <Stat label="Total forms" value={n(t?.forms)} hint={`${ws?.usage.forms ?? 0} of ${ws?.entitlements.limits.forms ?? '∞'} on your plan`} />
          <Stat label="Active forms" value={n(t?.active_forms)} hint="Published and collecting" accent="success" />
          <Stat label="Total responses" value={n(t?.responses)} hint={`${n(t?.responses_7d)} in the last 7 days`} accent="brand" />
          <Stat label="Total events" value={n(t?.events)} hint={`${n(t?.upcoming_events)} upcoming`} />
        </>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {quick.map((q) => (
          <button key={q.label} onClick={q.onClick} className="card p-4 text-left hover:border-line-strong hover:shadow-sm transition-all cursor-pointer group">
            <q.icon className="size-[18px] text-brand-500" />
            <p className="text-[13.5px] font-medium mt-3 group-hover:text-brand-600">{q.label}</p>
            <p className="text-[12.5px] text-muted mt-0.5">{q.desc}</p>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <section className="card p-4">
            <div className="flex items-center justify-between mb-2"><h2 className="text-[13.5px] font-semibold">Responses · last 30 days</h2><span className="text-[12.5px] text-muted tabular">{n(stats.data?.timeline?.reduce((a: number, r: any) => a + r.n, 0))} total</span></div>
            <LineChart data={fillDays(stats.data?.timeline ?? [], 30)} series={[{ key: 'n', label: 'Responses', color: '#5146D8' }]} height={150} />
          </section>

          <Panel title="Recent forms" to="/forms">
            {forms.data?.items?.length === 0 ? <EmptyState compact icon={<FileText />} title="No forms yet" description="Create a form or start from a template." /> : (
              <ul>
                {(forms.data?.items ?? []).map((f: any) => (
                  <li key={f.id}><Link to={`/forms/${f.id}/edit`} className="flex items-center gap-3 px-4 h-14 border-b border-line last:border-0 hover:bg-hover/50">
                    <span className="size-8 rounded-lg bg-hover grid place-items-center shrink-0">{f.kind === 'rsvp' ? <MailCheck className="size-4 text-muted" /> : <FileText className="size-4 text-muted" />}</span>
                    <span className="flex-1 min-w-0"><span className="block text-[13.5px] font-medium truncate">{f.name}</span><span className="block text-[12px] text-muted">Edited {timeAgo(f.updated_at)}{f.event_name ? ` · ${f.event_name}` : ''}</span></span>
                    <span className="text-[12.5px] text-muted tabular hidden sm:block">{n(f.responses)} responses</span>
                    <StatusBadge status={f.status} />
                  </Link></li>
                ))}
                {forms.loading && !forms.data && <li className="p-4"><Skeleton className="h-8" /></li>}
              </ul>
            )}
          </Panel>

          <Panel title="Recent responses" to="/responses">
            {responses.data?.items?.length === 0 ? <EmptyState compact icon={<Inbox />} title="No responses yet" description="Publish a form and share the link to start collecting responses." /> : (
              <ul>
                {(responses.data?.items ?? []).map((s: any) => (
                  <li key={s.id}><Link to={`/responses/${s.id}`} className="flex items-center gap-3 px-4 h-12 border-b border-line last:border-0 hover:bg-hover/50">
                    <Avatar name={s.respondent_name ?? s.respondent_email ?? 'Anonymous'} size={26} />
                    <span className="flex-1 min-w-0 text-[13px] truncate"><span className="font-medium">{s.respondent_name ?? s.respondent_email ?? 'Anonymous'}</span> <span className="text-muted">· {s.form_name}</span></span>
                    {s.rsvp_status && <RsvpBadge status={s.rsvp_status} />}
                    <span className="text-[12px] text-faint w-16 text-right">{timeAgo(s.created_at)}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Upcoming events" to="/events">
            {upcoming.length === 0 && !events.loading ? <EmptyState compact icon={<CalendarDays />} title="No events" description="Create an event to manage guests, invitations and check-in." /> : (
              <ul>
                {upcoming.map((e: any) => (
                  <li key={e.id}><Link to={`/events/${e.id}`} className="block px-4 py-3 border-b border-line last:border-0 hover:bg-hover/50">
                    <div className="flex items-center justify-between gap-2"><span className="text-[13.5px] font-medium truncate">{e.name}</span><StatusBadge status={e.status} /></div>
                    <p className="text-[12px] text-muted mt-0.5">{e.starts_at ? fmtDate(e.starts_at, e.timezone, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Date to be confirmed'}</p>
                    <div className="flex gap-3 text-[12px] mt-2 tabular"><span className="text-success">{e.accepted} accepted</span><span className="text-muted">{e.pending} pending</span><span className="text-muted">{e.expected_attendees} expected</span></div>
                  </Link></li>
                ))}
              </ul>
            )}
          </Panel>
          <section className="card">
            <div className="px-4 h-12 flex items-center border-b border-line"><h2 className="text-[13.5px] font-semibold">Activity</h2></div>
            <ul className="py-1">
              {(activity.data?.items ?? []).slice(0, 8).map((a: any) => (
                <li key={a.id} className="flex gap-2.5 px-4 py-2">
                  <span className="mt-1.5 size-1.5 rounded-full bg-line-strong shrink-0" />
                  <p className="text-[12.5px] leading-snug text-ink-2"><span className="font-medium text-ink">{a.actor_name ?? 'Someone'}</span> {activityLabel(a.action)}<span className="block text-faint text-[11.5px]">{timeAgo(a.created_at)}</span></p>
                </li>
              ))}
              {activity.data?.items?.length === 0 && <li className="px-4 py-6 text-[12.5px] text-muted">Your team’s activity will appear here.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
