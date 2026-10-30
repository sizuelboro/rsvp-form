import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Lock } from 'lucide-react';
import { useWpath, useSession } from '../../stores/session';
import { useApi } from '../../lib/hooks';
import { qs } from '../../lib/api';
import { Button, ErrorState, Field, Input, PageHeader, Segmented, Select, Skeleton, Stat, Table } from '../../components/ui';
import { BarList, Donut, LineChart, fillDays } from '../../components/charts';
import { n } from '../../lib/format';
import { EventAnalytics } from '../events/EventDetail';

const PRESETS = { '7': 7, '30': 30, '90': 90 } as const;

function csvDownload(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

const DEVICE_COLORS: Record<string, string> = { desktop: '#5146D8', mobile: '#F28B79', tablet: '#B5ADF2' };

export default function Analytics() {
  const wp = useWpath();
  const [params, setParams] = useSearchParams();
  const advanced = useSession((s) => s.workspace?.entitlements.features.advancedAnalytics);
  const [scope, setScope] = useState<'workspace' | 'form' | 'event'>(params.get('formId') ? 'form' : params.get('eventId') ? 'event' : 'workspace');
  const [preset, setPreset] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const days = preset === 'custom' ? null : PRESETS[preset];
  const range = days ? { from: new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10), to: undefined } : { from: from || undefined, to: to || undefined };
  const spanDays = days ?? (from ? Math.max(1, Math.ceil(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 86400000) + 1) : 30);
  const formId = params.get('formId') ?? '';
  const eventId = params.get('eventId') ?? '';
  const forms = useApi<{ items: any[] }>(wp('/forms?limit=100'));
  const events = useApi<{ items: any[] }>(wp('/events'));
  const ws = useApi<any>(scope === 'workspace' ? wp(`/analytics/workspace${qs(range)}`) : null);
  const fa = useApi<any>(scope === 'form' && formId ? wp(`/analytics/forms/${formId}${qs(range)}`) : null);
  const setParam = (k: string, v: string) => { const p = new URLSearchParams(); if (v) p.set(k, v); setParams(p, { replace: true }); };
  const end = range.to ? new Date(`${range.to}T00:00:00Z`) : new Date();

  return (
    <div>
      <PageHeader title="Analytics" description="Metrics computed from your stored responses, visits and check-ins." />
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <Segmented value={scope} onChange={(v) => { setScope(v); setParams(new URLSearchParams(), { replace: true }); }} items={[{ value: 'workspace', label: 'Workspace' }, { value: 'form', label: 'Form' }, { value: 'event', label: 'Event' }]} />
        {scope === 'form' && <Select className="w-auto max-w-[260px]" value={formId} onChange={(e) => setParam('formId', e.target.value)} aria-label="Form"><option value="">Choose a form…</option>{(forms.data?.items ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}
        {scope === 'event' && <Select className="w-auto max-w-[260px]" value={eventId} onChange={(e) => setParam('eventId', e.target.value)} aria-label="Event"><option value="">Choose an event…</option>{(events.data?.items ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>}
        {scope !== 'event' && <>
          <div className="flex-1" />
          <Segmented size="sm" value={preset} onChange={setPreset} items={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }, { value: 'custom', label: 'Custom' }]} />
          {preset === 'custom' && <><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
        </>}
      </div>

      {scope === 'workspace' && (ws.error ? <ErrorState error={ws.error} onRetry={ws.refetch} /> : !ws.data ? <Skeleton className="h-72" /> : (
        <div className="space-y-4">
          <div className="flex justify-end"><Button size="sm" icon={<Download className="size-3.5" />} onClick={() => csvDownload('workspace-analytics.csv', [['Metric', 'Value'], ['Views', ws.data.funnel.views], ['Started', ws.data.funnel.starts], ['Completed', ws.data.funnel.completions], ['Abandoned', ws.data.funnel.abandonment], ['Completion rate (%)', ws.data.funnel.completionRate], ['Invited', ws.data.rsvp.invited], ['Accepted', ws.data.rsvp.accepted], ['Declined', ws.data.rsvp.declined], ['Pending', ws.data.rsvp.pending], ['Expected attendees', ws.data.rsvp.expected], ['Checked in', ws.data.rsvp.checked_in], [], ['Day', 'Responses'], ...fillDays(ws.data.timeline, spanDays, end).map((d) => [d.day as string, d.n as number])])}>Export CSV</Button></div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Form views" value={n(ws.data.funnel.views)} />
            <Stat label="Started" value={n(ws.data.funnel.starts)} />
            <Stat label="Completed" value={n(ws.data.funnel.completions)} accent="success" />
            <Stat label="Abandoned" value={n(ws.data.funnel.abandonment)} accent="danger" />
            <Stat label="Completion rate" value={`${ws.data.funnel.completionRate}%`} hint="completed ÷ started" />
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card p-5 lg:col-span-2"><h3 className="text-[13.5px] font-semibold mb-3">Submissions</h3><LineChart data={fillDays(ws.data.timeline, spanDays, end)} series={[{ key: 'n', label: 'Submissions', color: '#5146D8' }]} /></div>
            <div className="card p-5"><h3 className="text-[13.5px] font-semibold mb-4">Devices</h3><Donut segments={ws.data.devices.map((d: any) => ({ label: d.device[0].toUpperCase() + d.device.slice(1), value: d.n, color: DEVICE_COLORS[d.device] ?? '#999' }))} /></div>
            <div className="card p-5"><h3 className="text-[13.5px] font-semibold mb-4">RSVPs across events</h3>
              <Donut segments={[{ label: 'Accepted', value: ws.data.rsvp.accepted, color: '#1F8A5B' }, { label: 'Declined', value: ws.data.rsvp.declined, color: '#E07A6A' }, { label: 'Pending', value: ws.data.rsvp.pending, color: '#DEDBD3' }]} />
              <div className="grid grid-cols-2 gap-2 mt-4 text-[12.5px]"><div className="rounded-lg bg-hover/60 p-2.5"><p className="text-muted">Expected</p><p className="text-[16px] font-semibold tabular">{n(ws.data.rsvp.expected)}</p></div><div className="rounded-lg bg-hover/60 p-2.5"><p className="text-muted">Checked in</p><p className="text-[16px] font-semibold tabular">{n(ws.data.rsvp.checked_in)}</p></div></div>
            </div>
            <div className="card lg:col-span-2"><div className="px-4 h-12 flex items-center border-b border-line"><h3 className="text-[13.5px] font-semibold">Top forms</h3></div>
              <Table rows={ws.data.topForms} rowKey={(f: any) => f.id} onRowClick={(f: any) => { setScope('form'); setParam('formId', f.id); }} columns={[
                { key: 'n', header: 'Form', cell: (f: any) => <span className="font-medium">{f.name}</span> }, { key: 'v', header: 'Views', cell: (f: any) => n(f.views) },
                { key: 'r', header: 'Responses', cell: (f: any) => n(f.responses) }, { key: 'c', header: 'Conversion', cell: (f: any) => (f.views ? `${Math.round((f.responses / f.views) * 100)}%` : '—') },
              ]} /></div>
          </div>
        </div>
      ))}

      {scope === 'form' && (!formId ? <div className="card p-10 text-center text-[13px] text-muted">Choose a form to see its funnel, devices and answer breakdowns.</div> : fa.error ? <ErrorState error={fa.error} onRetry={fa.refetch} /> : !fa.data ? <Skeleton className="h-72" /> : (
        <div className="space-y-4">
          <div className="flex justify-end"><Button size="sm" icon={<Download className="size-3.5" />} onClick={() => csvDownload(`${fa.data.form.name}-analytics.csv`, [['Metric', 'Value'], ['Views', fa.data.funnel.views], ['Started', fa.data.funnel.starts], ['Completed', fa.data.funnel.completions], ['Completion rate (%)', fa.data.funnel.completionRate], ['Submissions', fa.data.submissions], ['Spam blocked', fa.data.spam], ...fa.data.fields.flatMap((f: any) => [[], [f.label, 'Count'], ...f.values.map((v: any) => [v.label, v.count])])])}>Export CSV</Button></div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Views" value={n(fa.data.funnel.views)} /><Stat label="Started" value={n(fa.data.funnel.starts)} /><Stat label="Completed" value={n(fa.data.funnel.completions)} accent="success" />
            <Stat label="Completion rate" value={`${fa.data.funnel.completionRate}%`} /><Stat label="Spam blocked" value={n(fa.data.spam)} accent="danger" />
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card p-5 lg:col-span-2"><h3 className="text-[13.5px] font-semibold mb-3">Submissions</h3><LineChart data={fillDays(fa.data.timeline, spanDays, end)} series={[{ key: 'n', label: 'Submissions', color: '#5146D8' }]} /></div>
            <div className="card p-5"><h3 className="text-[13.5px] font-semibold mb-4">Devices (visits)</h3><Donut segments={fa.data.devices.map((d: any) => ({ label: d.device, value: d.n, color: DEVICE_COLORS[d.device] ?? '#999' }))} /></div>
          </div>
          {fa.data.advanced ? (
            <div className="grid md:grid-cols-2 gap-4">{fa.data.fields.map((f: any) => (
              <div key={f.fieldId} className="card p-5"><h3 className="text-[13.5px] font-semibold mb-4">{f.label}</h3><BarList items={f.values.map((v: any) => ({ label: f.type === 'rating' ? `${v.label} ★` : v.label, value: v.count }))} color={f.type === 'meal_preference' ? '#F28B79' : '#5146D8'} /></div>
            ))}</div>
          ) : <div className="card p-6 flex items-center gap-3 text-[13px]"><Lock className="size-4 text-muted" />Answer breakdowns (meal preferences, ratings, choices) are part of advanced analytics on Pro.</div>}
        </div>
      ))}

      {scope === 'event' && (!eventId ? <div className="card p-10 text-center text-[13px] text-muted">Choose an event to see invitations, RSVPs, meals and attendance.</div> : <EventAnalytics eventId={eventId} slug={events.data?.items.find((e) => e.id === eventId)?.slug ?? 'event'} />)}
      {!advanced && scope === 'workspace' && <p className="hint mt-4">Upgrade to Pro for per-question breakdowns.</p>}
    </div>
  );
}
