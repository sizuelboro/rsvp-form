import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Code2, CreditCard, Mail, Plus, Send, Trash2, Webhook } from 'lucide-react';
import { useWpath, useCan, useSession } from '../../stores/session';
import { useApi } from '../../lib/hooks';
import { del, patch, post } from '../../lib/api';
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Switch } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import { toast } from '../../stores/toast';

export default function Integrations() {
  const wp = useWpath();
  const can = useCan();
  const entitled = useSession((s) => s.workspace?.entitlements.features.integrations);
  const list = useApi<{ items: any[]; deliveries: any[]; events: string[] }>(wp('/integrations'));
  const billing = useApi<{ providers: { stripe: boolean; razorpay: boolean } }>(wp('/billing/subscription'));
  const [creating, setCreating] = useState<{ name: string; url: string; events: string[] } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const deliveries = list.data?.deliveries ?? [];

  return (
    <div>
      <PageHeader title="Integrations" description="Send responses to other tools and connect your providers." actions={can.manage && entitled && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating({ name: '', url: '', events: [] })}>Add webhook</Button>} />
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <div className="card p-5">
          <Mail className="size-5 text-brand-500" /><p className="text-[14px] font-semibold mt-3">Email (Resend)</p>
          <p className="text-[12.5px] text-muted mt-1">Invitations, confirmations and reminders are sent through a queue with automatic retries.</p>
          <Link to="/settings/notifications" className="text-[12.5px] text-brand-600 font-medium mt-3 inline-block">Email templates & delivery log →</Link>
        </div>
        <div className="card p-5">
          <CreditCard className="size-5 text-brand-500" /><p className="text-[14px] font-semibold mt-3">Payments</p>
          <p className="text-[12.5px] text-muted mt-1">Razorpay (India) and Stripe (international) for subscriptions and payment fields.</p>
          <div className="flex gap-2 mt-3"><Badge tone={billing.data?.providers.razorpay ? 'success' : 'neutral'}>Razorpay {billing.data?.providers.razorpay ? 'connected' : 'not configured'}</Badge><Badge tone={billing.data?.providers.stripe ? 'success' : 'neutral'}>Stripe {billing.data?.providers.stripe ? 'connected' : 'not configured'}</Badge></div>
        </div>
        <div className="card p-5">
          <Code2 className="size-5 text-brand-500" /><p className="text-[14px] font-semibold mt-3">Website embed</p>
          <p className="text-[12.5px] text-muted mt-1">Every published form has an iframe embed code, QR code and share links in its Publish dialog.</p>
          <Link to="/forms" className="text-[12.5px] text-brand-600 font-medium mt-3 inline-block">Go to forms →</Link>
        </div>
      </div>

      <h2 className="text-[15px] font-semibold mb-1">Webhooks</h2>
      <p className="text-[13px] text-muted mb-4">POST each new or updated response as JSON to your endpoint — use with Zapier, Make, Google Sheets scripts or your own backend. Requests are signed with <code className="text-[12px]">X-Invitely-Signature: v1=HMAC-SHA256(timestamp.body)</code>.</p>
      {!entitled ? <div className="card"><EmptyState compact icon={<Webhook />} title="Webhooks are available on Pro" action={<Link to="/settings/billing"><Button variant="primary">View plans</Button></Link>} /></div> : (
        <div className="card divide-y divide-line">
          {(list.data?.items ?? []).map((h) => {
            const last = deliveries.find((d) => d.integration_id === h.id);
            return (
              <div key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <Webhook className="size-4 text-muted" />
                <div className="flex-1 min-w-[200px]"><p className="text-[13.5px] font-medium">{h.name}</p><p className="text-[12px] text-muted font-mono truncate">{h.config.url}</p></div>
                {last && <Badge tone={last.status === 'delivered' ? 'success' : last.status === 'failed' ? 'danger' : 'neutral'}>{last.status} · {timeAgo(last.created_at)}</Badge>}
                {can.manage && <>
                  <Switch checked={h.enabled} label="Enabled" onChange={async (v) => { await patch(wp(`/integrations/webhooks/${h.id}`)!, { enabled: v }); void list.refetch(); }} />
                  <Button size="sm" icon={<Send className="size-3.5" />} onClick={async () => { await post(wp(`/integrations/webhooks/${h.id}/test`)!); toast.success('Test delivery queued'); setTimeout(() => void list.refetch(), 2500); }}>Test</Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Delete webhook" onClick={async () => { await del(wp(`/integrations/${h.id}`)!); void list.refetch(); }}><Trash2 className="size-3.5" /></Button>
                </>}
              </div>
            );
          })}
          {list.data && !list.data.items.length && <EmptyState compact icon={<Webhook />} title="No webhooks yet" description="Add an HTTPS endpoint to receive responses in real time." />}
        </div>
      )}
      {deliveries.length > 0 && <div className="mt-4 card"><div className="px-4 h-11 flex items-center border-b border-line text-[13px] font-semibold">Recent deliveries</div><ul className="divide-y divide-line">{deliveries.slice(0, 10).map((d, i) => <li key={i} className="flex items-center gap-3 px-4 h-10 text-[12.5px]"><span className="font-mono">{d.type}</span><span className="flex-1 text-danger truncate">{d.last_error ?? ''}</span><Badge tone={d.status === 'delivered' ? 'success' : d.status === 'failed' ? 'danger' : 'neutral'}>{d.status}</Badge><span className="text-faint w-16 text-right">{timeAgo(d.created_at)}</span></li>)}</ul></div>}

      <Dialog open={Boolean(creating)} onOpenChange={(v) => !v && setCreating(null)} title="Add webhook"
        footer={<><Button onClick={() => setCreating(null)}>Cancel</Button><Button variant="primary" disabled={!creating?.name || !/^https:\/\//.test(creating?.url ?? '')} onClick={async () => {
          try { const r = await post(wp('/integrations/webhooks')!, creating!); setCreating(null); setSecret(r.signingSecret); void list.refetch(); } catch (e) { toast.error(e); }
        }}>Create</Button></>}>
        {creating && <div className="space-y-3.5">
          <Field label="Name"><Input autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder="Google Sheets sync" /></Field>
          <Field label="Endpoint URL" hint="Must use https://"><Input value={creating.url} onChange={(e) => setCreating({ ...creating, url: e.target.value })} placeholder="https://hooks.zapier.com/…" /></Field>
          <Field label="Events" hint="Leave all unchecked to receive every event.">
            <div className="space-y-1.5">{(list.data?.events ?? []).filter((e) => e !== 'webhook.test').map((ev) => <label key={ev} className="flex items-center gap-2 text-[13px]"><Checkbox checked={creating.events.includes(ev)} onChange={(v) => setCreating({ ...creating, events: v ? [...creating.events, ev] : creating.events.filter((x) => x !== ev) })} /><code className="text-[12px]">{ev}</code></label>)}</div>
          </Field>
        </div>}
      </Dialog>
      <Dialog open={Boolean(secret)} onOpenChange={(v) => !v && setSecret(null)} title="Webhook created" description="Copy the signing secret now — it won’t be shown again." footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}>
        <div className="flex gap-2"><Input readOnly value={secret ?? ''} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} /><Button onClick={() => { void navigator.clipboard.writeText(secret ?? ''); toast.success('Copied'); }}><CheckCircle2 className="size-3.5" />Copy</Button></div>
      </Dialog>
    </div>
  );
}
