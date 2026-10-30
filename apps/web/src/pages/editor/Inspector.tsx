import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Copy, GitBranch, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { FIELD_DEFINITIONS, idSchema, type ElementStyle, type FormElement, type InspectorSection } from '@rsvp/core';
import { Button, Field, Input, Select, Switch, Textarea, Segmented, cn } from '../../components/ui';
import { useEditor, locate } from './store';
import { UrlInput } from './UrlInput';
import { FIELD_ICONS } from './icons';

export function Section({ title, children, defaultOpen = true, aside }: { title: string; children: ReactNode; defaultOpen?: boolean; aside?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line">
      <div className="flex items-center">
        <button onClick={() => setOpen(!open)} className="flex-1 flex items-center justify-between h-10 px-4 text-[12.5px] font-semibold text-ink cursor-pointer" aria-expanded={open}>
          {title}<ChevronDown className={cn('size-3.5 text-faint transition-transform', !open && '-rotate-90')} />
        </button>
        {aside && <div className="pr-3">{aside}</div>}
      </div>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-3"><span className="text-[12.5px] text-ink-2">{label}</span>{children}</div>
);

const num = (v: string) => (v === '' ? undefined : Number(v));

function slugOption(label: string, taken: Set<string>): string {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'option';
  if (!/^[a-z]/.test(base)) base = `o_${base}`;
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  return id;
}

function OptionsEditor({ el }: { el: FormElement }) {
  const updateElement = useEditor((s) => s.updateElement);
  const options = el.config.options ?? [];
  const image = el.type === 'image_choice';
  const set = (fn: (o: NonNullable<FormElement['config']['options']>) => void, key = 'opts') => updateElement(el.id, (x) => { x.config.options = [...(x.config.options ?? [])]; fn(x.config.options); }, `${key}:${el.id}`);
  const singleDefault = ['single_choice', 'dropdown', 'meal_preference', 'accommodation', 'transportation'].includes(el.type);
  return (
    <div className="space-y-1.5">
      {options.map((o, i) => (
        <div key={o.id} className="group">
          <div className="flex items-center gap-1">
            {singleDefault && <input type="radio" name={`def-${el.id}`} title="Default selection" aria-label={`Make ${o.label} the default`} checked={el.defaultValue === o.id} onChange={() => updateElement(el.id, (x) => { x.defaultValue = o.id; })} onClick={() => el.defaultValue === o.id && updateElement(el.id, (x) => { delete x.defaultValue; })} className="accent-brand-500 cursor-pointer" />}
            <Input value={o.label} onChange={(e) => set((l) => { l[i] = { ...l[i]!, label: e.target.value }; }, `opt:${o.id}`)} className="h-8 text-[13px]" aria-label={`Option ${i + 1}`} />
            <div className="flex opacity-60 group-hover:opacity-100">
              <button disabled={i === 0} onClick={() => set((l) => { [l[i - 1], l[i]] = [l[i]!, l[i - 1]!]; }, `move:${Date.now()}`)} className="size-6 grid place-items-center rounded hover:bg-hover disabled:opacity-30 cursor-pointer" aria-label="Move option up"><ArrowUp className="size-3" /></button>
              <button disabled={i === options.length - 1} onClick={() => set((l) => { [l[i + 1], l[i]] = [l[i]!, l[i + 1]!]; }, `move:${Date.now()}`)} className="size-6 grid place-items-center rounded hover:bg-hover disabled:opacity-30 cursor-pointer" aria-label="Move option down"><ArrowDown className="size-3" /></button>
              <button disabled={options.length <= 1} onClick={() => set((l) => { l.splice(i, 1); }, `rm:${Date.now()}`)} className="size-6 grid place-items-center rounded hover:bg-danger-50 hover:text-danger disabled:opacity-30 cursor-pointer" aria-label="Remove option"><X className="size-3" /></button>
            </div>
          </div>
          {image && <div className="mt-1"><UrlInput value={o.imageUrl} placeholder="Image URL (https://…)" className="h-7 text-[12px]" onCommit={(v) => set((l) => { l[i] = { ...l[i]!, imageUrl: v }; }, `img:${o.id}`)} /></div>}
          <p className="text-[10.5px] text-faint mt-0.5 pl-0.5 hidden group-hover:block">ID: {o.id}</p>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => set((l) => { const taken = new Set(l.map((x) => x.id)); l.push({ id: slugOption(`Option ${l.length + 1}`, taken), label: `Option ${l.length + 1}` }); }, `add:${Date.now()}`)}>Add option</Button>
    </div>
  );
}

function DefaultValue({ el }: { el: FormElement }) {
  const updateElement = useEditor((s) => s.updateElement);
  if (el.config.options) return null; // handled by the options editor
  const type = el.type === 'number' ? 'number' : el.type === 'date' ? 'date' : el.type === 'time' ? 'time' : 'text';
  if (el.type === 'yes_no') {
    return <Field label="Default"><Select value={(el.defaultValue as string) ?? ''} onChange={(e) => updateElement(el.id, (x) => { x.defaultValue = e.target.value || undefined; })}><option value="">None</option><option value="yes">Yes</option><option value="no">No</option></Select></Field>;
  }
  return <Field label="Default value" hint="Pre-filled for respondents"><Input type={type} value={(el.defaultValue as string | number | undefined) ?? ''} onChange={(e) => updateElement(el.id, (x) => { x.defaultValue = e.target.value === '' ? undefined : type === 'number' ? Number(e.target.value) : e.target.value; })} /></Field>;
}

function FieldIdEditor({ el }: { el: FormElement }) {
  const schema = useEditor((s) => s.schema)!;
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const [draft, setDraft] = useState(el.id);
  const [err, setErr] = useState<string | null>(null);
  const commit = () => {
    if (draft === el.id) return;
    const parsed = idSchema.safeParse(draft);
    if (!parsed.success) { setErr(parsed.error.issues[0]?.message ?? 'Invalid id'); return; }
    if (schema.pages.some((p) => p.id === draft || p.elements.some((e) => e.id === draft))) { setErr('This ID is already used'); return; }
    // Rename everywhere so logic rules keep pointing at the field.
    update((s) => {
      const l = locate(s, el.id);
      if (l) l.page.elements[l.index]!.id = draft;
      for (const r of s.logic) {
        for (const c of r.conditions) if (c.fieldId === el.id) c.fieldId = draft;
        for (const a of r.actions) if (a.target === el.id) a.target = draft;
      }
    });
    select({ kind: 'element', id: draft });
    setErr(null);
  };
  return (
    <Field label="Field ID" error={err} hint="Used in exports, logic and {{placeholders}}. Changing it doesn’t affect existing responses.">
      <Input value={draft} onChange={(e) => { setDraft(e.target.value); setErr(null); }} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className="font-mono text-[12.5px]" />
    </Field>
  );
}

function AppearanceSection({ el }: { el: FormElement }) {
  const updateElement = useEditor((s) => s.updateElement);
  const s = el.style ?? {};
  const set = (patch: Partial<ElementStyle>) => updateElement(el.id, (x) => {
    const next = { ...(x.style ?? {}), ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
    x.style = Object.keys(next).length ? (next as ElementStyle) : undefined;
  }, `style:${el.id}:${Object.keys(patch).join()}`);
  const def = FIELD_DEFINITIONS[el.type];
  return (
    <Section title="Appearance" defaultOpen={false} aside={el.style && <button onClick={() => updateElement(el.id, (x) => { delete x.style; })} className="text-[11.5px] text-muted hover:text-ink flex items-center gap-1 cursor-pointer"><RotateCcw className="size-3" />Reset</button>}>
      <Row label="Alignment"><Segmented size="sm" value={s.align ?? 'left'} onChange={(v) => set({ align: v === 'left' ? undefined : v })} items={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} /></Row>
      <Row label="Width"><Segmented size="sm" value={s.width ?? 'full'} onChange={(v) => set({ width: v === 'full' ? undefined : v })} items={[{ value: 'full', label: 'Full' }, { value: 'half', label: 'Half' }]} /></Row>
      {def.isInput && <Row label="Input size"><Segmented size="sm" value={s.size ?? 'md'} onChange={(v) => set({ size: v === 'md' ? undefined : v })} items={[{ value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }]} /></Row>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Font size"><Input type="number" min={10} max={72} placeholder="Theme" value={s.fontSize ?? ''} onChange={(e) => set({ fontSize: num(e.target.value) })} /></Field>
        <Field label="Weight"><Select value={s.fontWeight ?? ''} onChange={(e) => set({ fontWeight: num(e.target.value) })}><option value="">Theme</option>{[300, 400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}</Select></Field>
        <Field label="Background"><ColorField value={s.background} onChange={(v) => set({ background: v })} /></Field>
        <Field label="Border"><ColorField value={s.borderColor} onChange={(v) => set({ borderColor: v })} /></Field>
        <Field label="Radius"><Input type="number" min={0} max={48} placeholder="Theme" value={s.radius ?? ''} onChange={(e) => set({ radius: num(e.target.value) })} /></Field>
        <Field label="Spacing (Y)"><Input type="number" min={0} max={96} placeholder="0" value={s.paddingY ?? ''} onChange={(e) => set({ paddingY: num(e.target.value) })} /></Field>
      </div>
      <p className="hint">Element styles override the theme and are kept when you switch themes.</p>
    </Section>
  );
}

export function ColorField({ value, onChange, placeholder = 'None' }: { value: string | undefined; onChange: (v: string | undefined) => void; placeholder?: string }) {
  return (
    <div className="flex items-center gap-1.5 h-9 px-1.5 border border-line-strong rounded-md bg-surface focus-within:border-brand-500">
      <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} className="size-6 rounded border-0 p-0 bg-transparent cursor-pointer shrink-0" aria-label="Pick colour" />
      <input value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value || undefined)} className="w-full min-w-0 text-[12.5px] font-mono outline-none bg-transparent" aria-label="Colour value" />
    </div>
  );
}

function LogicSummary({ el, onOpenLogic }: { el: FormElement; onOpenLogic: (fieldId?: string) => void }) {
  const logic = useEditor((s) => s.schema!.logic);
  const affecting = logic.filter((r) => r.actions.some((a) => a.target === el.id));
  const dependent = logic.filter((r) => r.conditions.some((c) => c.fieldId === el.id));
  return (
    <Section title="Logic" defaultOpen={affecting.length + dependent.length > 0}>
      {affecting.map((r) => <p key={r.id} className="text-[12.5px] text-ink-2 flex gap-2"><GitBranch className="size-3.5 mt-0.5 text-brand-500 shrink-0" />{r.name || 'Unnamed rule'} <span className="text-faint">controls this</span></p>)}
      {dependent.map((r) => <p key={r.id} className="text-[12.5px] text-ink-2 flex gap-2"><GitBranch className="size-3.5 mt-0.5 text-muted shrink-0" />{r.name || 'Unnamed rule'} <span className="text-faint">uses this answer</span></p>)}
      {!affecting.length && !dependent.length && <p className="hint">Show, hide or require fields — or jump to a page — based on answers.</p>}
      {FIELD_DEFINITIONS[el.type].isInput && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => onOpenLogic(el.id)}>Add rule using this answer</Button>}
      {(affecting.length > 0 || dependent.length > 0) && <Button size="sm" variant="ghost" onClick={() => onOpenLogic()}>Open logic builder</Button>}
    </Section>
  );
}

function TypeSettings({ el, sections }: { el: FormElement; sections: InspectorSection[] }) {
  const updateElement = useEditor((s) => s.updateElement);
  const c = el.config;
  const cfg = (patch: Partial<FormElement['config']>, key?: string) => updateElement(el.id, (x) => { x.config = { ...x.config, ...patch }; for (const k of Object.keys(x.config)) if ((x.config as Record<string, unknown>)[k] === undefined) delete (x.config as Record<string, unknown>)[k]; }, key ?? `cfg:${el.id}:${Object.keys(patch).join()}`);
  const has = (s: InspectorSection) => sections.includes(s);
  const blocks: ReactNode[] = [];
  if (has('options')) blocks.push(<Section key="options" title="Options"><OptionsEditor el={el} />{has('allowOther') && <Row label="Allow custom answer (“Other”)"><Switch checked={Boolean(c.allowOther)} onChange={(v) => cfg({ allowOther: v || undefined })} /></Row>}</Section>);
  if (has('multiple')) blocks.push(<Section key="multiple" title="Selection"><Row label="Allow multiple selections"><Switch checked={Boolean(c.multiple)} onChange={(v) => cfg({ multiple: v })} /></Row></Section>);
  if (has('selections')) blocks.push(<Section key="sel" title="Validation" defaultOpen={false}><div className="grid grid-cols-2 gap-2"><Field label="Min selections"><Input type="number" min={0} value={c.minSelections ?? ''} onChange={(e) => cfg({ minSelections: num(e.target.value) })} /></Field><Field label="Max selections"><Input type="number" min={1} value={c.maxSelections ?? ''} onChange={(e) => cfg({ maxSelections: num(e.target.value) })} /></Field></div></Section>);
  if (has('textLength')) blocks.push(
    <Section key="len" title="Validation" defaultOpen={false}>
      <div className="grid grid-cols-2 gap-2"><Field label="Min length"><Input type="number" min={0} value={c.minLength ?? ''} onChange={(e) => cfg({ minLength: num(e.target.value) })} /></Field><Field label="Max length"><Input type="number" min={1} value={c.maxLength ?? ''} onChange={(e) => cfg({ maxLength: num(e.target.value) })} /></Field></div>
      {el.type === 'short_text' && <Field label="Allowed characters"><Select value={c.pattern ?? 'none'} onChange={(e) => cfg({ pattern: e.target.value === 'none' ? undefined : (e.target.value as 'letters') })}><option value="none">Anything</option><option value="letters">Letters only</option><option value="alphanumeric">Letters and numbers</option><option value="digits">Digits only</option></Select></Field>}
      {el.type === 'long_text' && <Field label="Visible rows"><Input type="number" min={2} max={20} value={c.rows ?? 4} onChange={(e) => cfg({ rows: num(e.target.value) })} /></Field>}
    </Section>,
  );
  if (has('numberRange')) blocks.push(<Section key="num" title="Validation"><div className="grid grid-cols-3 gap-2"><Field label="Min"><Input type="number" value={c.min ?? ''} onChange={(e) => cfg({ min: num(e.target.value) })} /></Field><Field label="Max"><Input type="number" value={c.max ?? ''} onChange={(e) => cfg({ max: num(e.target.value) })} /></Field><Field label="Step"><Input type="number" min={0} value={c.step ?? ''} onChange={(e) => cfg({ step: num(e.target.value) || undefined })} /></Field></div></Section>);
  if (has('rating')) blocks.push(<Section key="rating" title="Rating"><div className="grid grid-cols-2 gap-2"><Field label="Scale"><Select value={c.scale ?? 5} onChange={(e) => cfg({ scale: Number(e.target.value) })}>{[3, 4, 5, 6, 7, 10].map((s) => <option key={s} value={s}>1 – {s}</option>)}</Select></Field><Field label="Style"><Select value={c.ratingIcon ?? 'star'} onChange={(e) => cfg({ ratingIcon: e.target.value as 'star' })}><option value="star">Stars</option><option value="heart">Hearts</option><option value="number">Numbers</option></Select></Field></div></Section>);
  if (has('attendance')) blocks.push(
    <Section key="att" title="Responses">
      <Field label="Accept label"><Input value={c.acceptLabel ?? ''} placeholder="Accept" onChange={(e) => cfg({ acceptLabel: e.target.value })} /></Field>
      <Field label="Decline label"><Input value={c.declineLabel ?? ''} placeholder="Decline" onChange={(e) => cfg({ declineLabel: e.target.value })} /></Field>
      <Row label="Offer “Maybe”"><Switch checked={Boolean(c.allowMaybe)} onChange={(v) => cfg({ allowMaybe: v })} /></Row>
      {c.allowMaybe && <Field label="Maybe label"><Input value={c.maybeLabel ?? ''} placeholder="Maybe" onChange={(e) => cfg({ maybeLabel: e.target.value })} /></Field>}
      <p className="hint">This answer sets each guest’s RSVP status on linked events.</p>
    </Section>,
  );
  if (has('guestCount')) blocks.push(
    <Section key="gc" title="Guests">
      <div className="grid grid-cols-2 gap-2">
        {el.type === 'guest_count' && <Field label="Minimum"><Input type="number" min={0} max={100} value={c.minGuests ?? ''} onChange={(e) => cfg({ minGuests: num(e.target.value) })} /></Field>}
        <Field label="Maximum"><Input type="number" min={1} max={100} value={c.maxGuests ?? ''} onChange={(e) => cfg({ maxGuests: num(e.target.value) })} /></Field>
      </div>
      {el.type === 'guest_count' && <Row label="Separate adults and children"><Switch checked={Boolean(c.splitAdultsChildren)} onChange={(v) => cfg({ splitAdultsChildren: v })} /></Row>}
    </Section>,
  );
  if (has('upload')) blocks.push(
    <Section key="up" title="Files">
      <Field label="Accepted types">
        <div className="space-y-1.5">{[['image/*', 'Images (PNG, JPG, GIF, WebP)'], ['application/pdf', 'PDF documents']].map(([v, l]) => (
          <label key={v} className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" className="accent-brand-500" checked={(c.accept ?? []).includes(v!)} onChange={(e) => cfg({ accept: e.target.checked ? [...(c.accept ?? []), v!] : (c.accept ?? []).filter((x) => x !== v) })} />{l}</label>
        ))}</div>
      </Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Max size (MB)"><Input type="number" min={1} max={25} value={c.maxFileSizeMb ?? 10} onChange={(e) => cfg({ maxFileSizeMb: Math.min(25, num(e.target.value) ?? 10) })} /></Field><Field label="Max files"><Input type="number" min={1} max={10} value={c.maxFiles ?? 1} onChange={(e) => cfg({ maxFiles: num(e.target.value) })} /></Field></div>
      <p className="hint">File contents are verified on the server; disguised files are rejected.</p>
    </Section>,
  );
  if (has('payment')) blocks.push(<Section key="pay" title="Payment"><div className="grid grid-cols-2 gap-2"><Field label="Amount"><Input type="number" min={0} value={c.amount ?? 0} onChange={(e) => cfg({ amount: num(e.target.value) })} /></Field><Field label="Currency"><Select value={c.currency ?? 'INR'} onChange={(e) => cfg({ currency: e.target.value })}>{['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD'].map((cur) => <option key={cur}>{cur}</option>)}</Select></Field></div><p className="hint">Payments are recorded as pending and collected through your connected provider (Razorpay or Stripe).</p></Section>);
  if (has('content')) blocks.push(<Section key="content" title="Content"><Textarea rows={el.type === 'rich_text' ? 6 : 3} value={c.content ?? ''} onChange={(e) => cfg({ content: e.target.value }, `content:${el.id}`)} />{el.type === 'rich_text' && <p className="hint">Supports **bold**, _italic_, [links](https://…) and “- ” lists.</p>}</Section>);
  if (has('heading')) blocks.push(<Section key="h" title="Heading"><Row label="Level"><Segmented size="sm" value={String(c.level ?? 2)} onChange={(v) => cfg({ level: Number(v) as 1 })} items={[{ value: '1', label: 'H1' }, { value: '2', label: 'H2' }, { value: '3', label: 'H3' }]} /></Row></Section>);
  if (has('media')) blocks.push(<Section key="m" title={el.type === 'video' ? 'Video' : 'Image'}><Field label={el.type === 'video' ? 'YouTube or Vimeo URL' : 'Image URL'}><Input value={c.url ?? ''} placeholder="https://" onChange={(e) => cfg({ url: e.target.value }, `url:${el.id}`)} /></Field>{el.type === 'image' && <Field label="Alt text" hint="Describe the image for screen readers"><Input value={c.alt ?? ''} onChange={(e) => cfg({ alt: e.target.value })} /></Field>}</Section>);
  if (has('spacer')) blocks.push(<Section key="sp" title="Spacer"><Field label="Height (px)"><Input type="number" min={4} max={400} value={c.height ?? 32} onChange={(e) => cfg({ height: num(e.target.value) })} /></Field></Section>);
  if (has('hidden')) blocks.push(
    <Section key="hid" title="Value">
      <Row label="Source"><Segmented size="sm" value={c.source ?? 'query'} onChange={(v) => cfg({ source: v })} items={[{ value: 'query', label: 'URL parameter' }, { value: 'static', label: 'Fixed value' }]} /></Row>
      {(c.source ?? 'query') === 'query' ? <Field label="Parameter name" hint={`e.g. /f/your-form?${c.queryParam ?? 'ref'}=newsletter`}><Input value={c.queryParam ?? ''} onChange={(e) => cfg({ queryParam: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} /></Field>
        : <Field label="Value"><Input value={(el.defaultValue as string) ?? ''} onChange={(e) => updateElement(el.id, (x) => { x.defaultValue = e.target.value; })} /></Field>}
    </Section>,
  );
  if (has('sessions')) blocks.push(<Section key="ses" title="Event sessions" defaultOpen={false}><p className="hint">When this form is attached to an event, each option is matched to the session with the same option ID (set on the event’s Sessions tab). Guests’ per-session RSVPs are updated automatically.</p></Section>);
  return <>{blocks}</>;
}

export function ElementInspector({ el, onOpenLogic }: { el: FormElement; onOpenLogic: (fieldId?: string) => void }) {
  const updateElement = useEditor((s) => s.updateElement);
  const deleteElement = useEditor((s) => s.deleteElement);
  const duplicateElement = useEditor((s) => s.duplicateElement);
  const def = FIELD_DEFINITIONS[el.type];
  const Icon = FIELD_ICONS[def.icon] ?? FIELD_ICONS.Type!;
  const has = (s: InspectorSection) => def.sections.includes(s);
  const showLabel = def.isInput || ['heading', 'section', 'rsvp_deadline_info'].includes(el.type);
  return (
    <div key={el.id}>
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-line">
        <span className="size-7 rounded-md bg-brand-50 text-brand-600 grid place-items-center"><Icon className="size-3.5" /></span>
        <div className="flex-1 min-w-0"><p className="text-[13px] font-semibold truncate">{def.name}</p></div>
        <Button size="icon-sm" variant="ghost" onClick={() => duplicateElement(el.id)} aria-label="Duplicate field"><Copy className="size-3.5" /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => deleteElement(el.id)} aria-label="Delete field"><Trash2 className="size-3.5" /></Button>
      </div>
      {(showLabel || def.isInput) && (
        <Section title="General">
          {showLabel && <Field label={el.type === 'heading' || el.type === 'section' ? 'Text' : 'Label'}><Textarea rows={2} className="min-h-0" value={el.label} onChange={(e) => updateElement(el.id, (x) => { x.label = e.target.value; }, `label:${el.id}`)} /></Field>}
          {def.isInput && el.type !== 'hidden' && <Field label="Description"><Textarea rows={2} className="min-h-0" placeholder="Optional help text" value={el.description ?? ''} onChange={(e) => updateElement(el.id, (x) => { x.description = e.target.value || undefined; }, `desc:${el.id}`)} /></Field>}
          {has('placeholder') && <Field label="Placeholder"><Input value={el.placeholder ?? ''} onChange={(e) => updateElement(el.id, (x) => { x.placeholder = e.target.value || undefined; }, `ph:${el.id}`)} /></Field>}
          {has('required') && <Row label="Required"><Switch checked={Boolean(el.required)} onChange={(v) => updateElement(el.id, (x) => { x.required = v; })} label="Required" /></Row>}
          {has('default') && <DefaultValue el={el} />}
          {def.isInput && <FieldIdEditor key={el.id} el={el} />}
        </Section>
      )}
      <TypeSettings el={el} sections={def.sections} />
      {def.isInput && <LogicSummary el={el} onOpenLogic={onOpenLogic} />}
      <AppearanceSection el={el} />
    </div>
  );
}

export function PageInspector({ pageId }: { pageId: string }) {
  const schema = useEditor((s) => s.schema)!;
  const update = useEditor((s) => s.update);
  const deletePage = useEditor((s) => s.deletePage);
  const movePage = useEditor((s) => s.movePage);
  const select = useEditor((s) => s.select);
  const i = schema.pages.findIndex((p) => p.id === pageId);
  const page = schema.pages[i];
  if (!page) return null;
  return (
    <div>
      <div className="flex items-center px-4 h-12 border-b border-line"><p className="text-[13px] font-semibold">Page {i + 1}</p></div>
      <Section title="Page">
        <Field label="Title"><Input value={page.title ?? ''} onChange={(e) => update((s) => { s.pages[i]!.title = e.target.value || undefined; }, `page:${page.id}`)} /></Field>
        <Field label="Description"><Textarea rows={2} value={page.description ?? ''} onChange={(e) => update((s) => { s.pages[i]!.description = e.target.value || undefined; }, `pdesc:${page.id}`)} /></Field>
        <div className="flex gap-2">
          <Button size="sm" icon={<ArrowUp className="size-3.5" />} disabled={i === 0} onClick={() => movePage(page.id, -1)}>Move up</Button>
          <Button size="sm" icon={<ArrowDown className="size-3.5" />} disabled={i === schema.pages.length - 1} onClick={() => movePage(page.id, 1)}>Move down</Button>
        </div>
        <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} disabled={schema.pages.length <= 1} onClick={() => { deletePage(page.id); select({ kind: 'form' }); }}>Delete page (keeps its fields)</Button>
      </Section>
    </div>
  );
}
