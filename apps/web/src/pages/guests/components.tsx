import { useEffect, useState } from 'react';
import { FileUp } from 'lucide-react';
import { post } from '../../lib/api';
import { Badge, Button, Dialog, Field, Input, Select, Textarea } from '../../components/ui';
import { toast } from '../../stores/toast';

export function ImportDialog({ open, onOpenChange, path, eventId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; path: string; eventId?: string; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCsv(''); setPreview(null); } }, [open]);
  const readFile = (f: File) => {
    if (f.size > 5_000_000) { toast.error(new Error('CSV files must be under 5 MB')); return; }
    const r = new FileReader();
    r.onload = () => { setCsv(String(r.result ?? '')); setPreview(null); };
    r.readAsText(f);
  };
  const dryRun = async () => {
    setBusy(true);
    try { setPreview(await post(path, { csv, eventId, dryRun: true })); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await post(path, { csv, eventId });
      toast.success(`Imported ${r.created} new and updated ${r.updated} existing guest${r.created + r.updated === 1 ? "" : "s"}`, r.duplicatesInFile ? `${r.duplicatesInFile} duplicate row${r.duplicatesInFile === 1 ? " was" : "s were"} skipped.` : undefined);
      onOpenChange(false); onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Import guests from CSV"
      description={<>Columns are matched automatically: <b>Name</b> (or First/Last name), <b>Email</b>, <b>Phone</b>, <b>Group</b>, <b>Household</b>, <b>Notes</b>, <b>Dietary</b>. Other columns become custom attributes. Guests are matched by email so nobody is duplicated.</>}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button>{preview ? <Button variant="primary" loading={busy} disabled={!preview.create && !preview.update} onClick={run}>Import {preview.create + preview.update} guests</Button> : <Button variant="primary" loading={busy} disabled={!csv.trim()} onClick={dryRun}>Preview import</Button>}</>}>
      {!preview ? (
        <div className="space-y-3">
          <label className="flex flex-col items-center justify-center gap-2 h-28 rounded-lg border border-dashed border-line-strong hover:border-brand-500 cursor-pointer text-[13px] text-muted">
            <FileUp className="size-5" /><span><b className="text-ink">Choose a CSV file</b> or drop it here</span>
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
          </label>
          <Field label="…or paste CSV"><Textarea rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={'Name,Email,Phone,Group\nPriya Sharma,priya@example.com,+91 98765 43210,Family'} className="font-mono text-[12px]" /></Field>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[['Rows', preview.total], ['New guests', preview.create], ['Updates', preview.update], ['Duplicates skipped', preview.duplicatesInFile]].map(([l, v]) => <div key={l} className="rounded-lg border border-line p-3"><p className="text-[12px] text-muted">{l}</p><p className="text-[18px] font-semibold tabular">{v}</p></div>)}
          </div>
          {preview.errors.length > 0 && <div className="rounded-lg bg-danger-50 border border-danger/20 p-3 text-[12.5px]"><p className="font-medium text-danger mb-1">{preview.errors.length} rows will be skipped</p><ul className="text-ink-2 space-y-0.5">{preview.errors.slice(0, 5).map((e: any) => <li key={e.line}>Line {e.line}: {e.message}</li>)}</ul></div>}
          <div className="rounded-lg border border-line overflow-hidden">
            <table className="w-full text-[12.5px]"><thead><tr className="bg-hover/60 text-muted"><th className="text-left px-3 h-8 font-medium">Name</th><th className="text-left px-3 font-medium">Email</th><th className="text-left px-3 font-medium hidden sm:table-cell">Group</th><th className="text-left px-3 font-medium">Status</th></tr></thead>
              <tbody>{preview.preview.map((r: any, i: number) => <tr key={i} className="border-t border-line"><td className="px-3 h-8">{r.name}</td><td className="px-3 text-muted">{r.email ?? '—'}</td><td className="px-3 text-muted hidden sm:table-cell">{r.group ?? '—'}</td><td className="px-3"><Badge tone={r.status === 'new' ? 'success' : r.status === 'update' ? 'brand' : 'neutral'}>{r.status}</Badge></td></tr>)}</tbody></table>
          </div>
          <button className="text-[12.5px] text-brand-600 cursor-pointer" onClick={() => setPreview(null)}>← Edit CSV</button>
        </div>
      )}
    </Dialog>
  );
}

export interface GuestDraft { name: string; email: string; phone: string; groupId: string; householdId: string; dietary: string; notes: string; attributes: { key: string; value: string }[] }
export const emptyGuest = (): GuestDraft => ({ name: '', email: '', phone: '', groupId: '', householdId: '', dietary: '', notes: '', attributes: [] });

export function GuestForm({ value, onChange, groups, households }: { value: GuestDraft; onChange: (v: GuestDraft) => void; groups: any[]; households: any[] }) {
  const set = <K extends keyof GuestDraft>(k: K, v: GuestDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3.5">
      <Field label="Name"><Input autoFocus value={value.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Email"><Input type="email" value={value.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone"><Input type="tel" value={value.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Group"><Select value={value.groupId} onChange={(e) => set('groupId', e.target.value)}><option value="">No group</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
        <Field label="Household"><Select value={value.householdId} onChange={(e) => set('householdId', e.target.value)}><option value="">No household</option>{households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</Select></Field>
      </div>
      <Field label="Dietary preferences"><Input value={value.dietary} onChange={(e) => set('dietary', e.target.value)} placeholder="e.g. Vegetarian, nut allergy" /></Field>
      <Field label="Notes"><Textarea rows={2} value={value.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      <Field label="Custom attributes">
        <div className="space-y-1.5">
          {value.attributes.map((a, i) => (
            <div key={i} className="flex gap-1.5">
              <Input placeholder="Key (e.g. Table)" value={a.key} onChange={(e) => set('attributes', value.attributes.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <Input placeholder="Value" value={a.value} onChange={(e) => set('attributes', value.attributes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" onClick={() => set('attributes', value.attributes.filter((_, j) => j !== i))} aria-label="Remove attribute">×</Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set('attributes', [...value.attributes, { key: '', value: '' }])}>+ Add attribute</Button>
        </div>
      </Field>
    </div>
  );
}

export function guestPayload(d: GuestDraft) {
  return {
    name: d.name.trim(), email: d.email.trim() || null, phone: d.phone.trim() || null, groupId: d.groupId || null, householdId: d.householdId || null,
    dietary: d.dietary || null, notes: d.notes || null,
    attributes: Object.fromEntries(d.attributes.filter((a) => a.key.trim()).map((a) => [a.key.trim().slice(0, 60), a.value.slice(0, 500)])),
  };
}
