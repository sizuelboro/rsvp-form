import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, LayoutTemplate, Sparkles, Trash2 } from 'lucide-react';
import { TEMPLATES, TEMPLATE_CATEGORIES, type FormSchema, type TemplateDefinition } from '@rsvp/core';
import { FieldView, FormRenderer, RendererContext, ThemeScope } from '@rsvp/renderer';
import { useWpath, useCan } from '../../stores/session';
import { useApi } from '../../lib/hooks';
import { del } from '../../lib/api';
import { Badge, Button, Dialog, EmptyState, PageHeader, SearchInput, cn } from '../../components/ui';
import { createForm } from '../../app/actions';
import { toast } from '../../stores/toast';

const designCtx = { mode: 'design' as const, deadline: null, event: null };

/** A live, scaled-down render of the template's real schema — not a screenshot. */
const Thumbnail = memo(function Thumbnail({ schema }: { schema: FormSchema }) {
  const els = schema.pages[0]!.elements.filter((e) => e.type !== 'hidden').slice(0, 4);
  return (
    <div className="relative h-[210px] overflow-hidden pointer-events-none select-none" aria-hidden="true">
      <RendererContext.Provider value={designCtx}>
        <ThemeScope theme={schema.theme} fullPage className="absolute top-0 left-0 origin-top-left" style={{ width: '200%', transform: 'scale(0.5)', minHeight: 420 }}>
          <div className="fr-shell" style={{ padding: '28px 28px' }}>
            <div className="fr-card">
              <h1 className="fr-title">{schema.form.title}</h1>
              {schema.form.description && <p className="fr-desc" style={{ marginBottom: 20 }}>{schema.form.description}</p>}
              <div className="fr-fields fr-design">{els.map((el) => <FieldView key={el.id} el={el} value={undefined} required={Boolean(el.required)} onChange={() => undefined} />)}</div>
            </div>
          </div>
        </ThemeScope>
      </RendererContext.Provider>
      <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-surface to-transparent" />
    </div>
  );
});

function TemplateCard({ t, onPreview, onUse, onDelete }: { t: TemplateDefinition & { isCustom?: boolean }; onPreview: () => void; onUse: () => void; onDelete?: () => void }) {
  const category = TEMPLATE_CATEGORIES.find((c) => c.id === t.category)?.name ?? 'Custom';
  return (
    <div className="card overflow-hidden group hover:shadow-md hover:border-line-strong transition-all">
      <button onClick={onPreview} className="block w-full text-left cursor-pointer" aria-label={`Preview ${t.name}`}><Thumbnail schema={t.schema} /></button>
      <div className="p-4 border-t border-line">
        <div className="flex items-center gap-2"><p className="text-[14px] font-semibold flex-1 truncate">{t.name}</p>{t.featured && <Badge tone="brand"><Sparkles className="size-3" />Featured</Badge>}{t.isCustom && <Badge>Yours</Badge>}</div>
        <p className="text-[12.5px] text-muted mt-1 line-clamp-2 min-h-[36px]">{t.description || category}</p>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-[11.5px] text-faint flex-1 truncate">{category} · {t.schema.settings.layout === 'conversational' ? 'One at a time' : t.schema.settings.layout === 'multistep' ? `${t.schema.pages.length} steps` : 'Single page'}</span>
          {onDelete && <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label="Delete template"><Trash2 className="size-3.5" /></Button>}
          <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={onPreview}>Preview</Button>
          <Button size="sm" variant="primary" onClick={onUse}>Use</Button>
        </div>
      </div>
    </div>
  );
}

export default function Templates() {
  const wp = useWpath();
  const can = useCan();
  const navigate = useNavigate();
  const custom = useApi<{ custom: any[] }>(wp('/templates'));
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [preview, setPreview] = useState<(TemplateDefinition & { isCustom?: boolean }) | null>(null);
  const all = useMemo(() => [
    ...(custom.data?.custom ?? []).filter((t) => t.schema).map((t) => ({ ...t, isRsvp: false, popularity: 0, addedAt: t.created_at, isCustom: true })),
    ...TEMPLATES,
  ] as (TemplateDefinition & { isCustom?: boolean })[], [custom.data]);
  const filtered = all.filter((t) => (category === 'all' || t.category === category || (category === 'custom' && t.isCustom)) && (!q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q.toLowerCase())));
  const use = (t: TemplateDefinition) => can.write ? createForm(navigate, { templateId: t.id }) : toast.info('You have view-only access');
  const browsing = !q && category === 'all';
  const featured = TEMPLATES.filter((t) => t.featured);
  const popular = [...TEMPLATES].sort((a, b) => b.popularity - a.popularity).slice(0, 6);
  const recent = [...TEMPLATES].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 3);
  const grid = (items: typeof all) => (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((t) => <TemplateCard key={t.id} t={t} onPreview={() => setPreview(t)} onUse={() => use(t)}
        onDelete={t.isCustom && can.write ? async () => { try { await del(wp(`/templates/${t.id}`)!); void custom.refetch(); toast.success('Template deleted'); } catch (e) { toast.error(e); } } : undefined} />)}
    </div>
  );
  const categories = [{ id: 'all', name: 'All' }, ...TEMPLATE_CATEGORIES, ...((custom.data?.custom ?? []).length ? [{ id: 'custom', name: 'Your templates' }] : [])];

  return (
    <div>
      <PageHeader title="Templates" description="Fully editable starting points — every template is a real form you can change completely." actions={<SearchInput value={q} onChange={setQ} placeholder="Search templates" />} />
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-6 -mx-1 px-1">
        {categories.map((c) => (
          <button key={c.id} onClick={() => setCategory(c.id)} className={cn('h-8 px-3 rounded-full text-[12.5px] font-medium whitespace-nowrap border transition-colors cursor-pointer', category === c.id ? 'bg-ink text-white border-ink' : 'bg-surface border-line text-ink-2 hover:border-line-strong')}>{c.name}</button>
        ))}
      </div>
      {browsing ? (
        <div className="space-y-10">
          <section><h2 className="text-[15px] font-semibold mb-3">Featured</h2>{grid(featured)}</section>
          <section><h2 className="text-[15px] font-semibold mb-3">Popular</h2>{grid(popular)}</section>
          <section><h2 className="text-[15px] font-semibold mb-3">Recently added</h2>{grid(recent)}</section>
          {(custom.data?.custom ?? []).length > 0 && <section><h2 className="text-[15px] font-semibold mb-3">Your templates</h2>{grid(all.filter((t) => t.isCustom))}</section>}
          <section><h2 className="text-[15px] font-semibold mb-3">All templates <span className="text-faint font-normal">{TEMPLATES.length}</span></h2>{grid(TEMPLATES)}</section>
        </div>
      ) : filtered.length ? grid(filtered) : <div className="card"><EmptyState icon={<LayoutTemplate />} title="No templates found" description="Try another search or start from a blank form." /></div>}

      <Dialog open={Boolean(preview)} onOpenChange={(v) => !v && setPreview(null)} size="xl" title={preview?.name ?? ''} description={preview?.description}
        footer={<><Button onClick={() => setPreview(null)}>Close</Button><Button variant="primary" onClick={() => preview && use(preview)}>Use this template</Button></>}>
        {preview && <div className="rounded-xl overflow-hidden border border-line h-[62vh] overflow-y-auto"><FormRenderer schema={preview.schema} mode="preview" checkinUrl={(t) => `${location.origin}/c/${t}`} /></div>}
      </Dialog>
    </div>
  );
}
