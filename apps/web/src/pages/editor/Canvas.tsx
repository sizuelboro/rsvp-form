import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, GitBranch, GripVertical, Plus, Trash2 } from 'lucide-react';
import { FIELD_DEFINITIONS, resolveTheme, type FormElement, type FormPage } from '@rsvp/core';
import { FieldView, RendererContext, ThemeScope } from '@rsvp/renderer';
import { Popover, Tooltip, cn } from '../../components/ui';
import { useEditor, locate } from './store';
import { ElementsPanel } from './ElementsPanel';

/** Text input that inherits the surrounding typography so editing looks exactly like the result. */
export function InlineText({ value, onChange, placeholder, multiline, className, ariaLabel, autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; className?: string; ariaLabel: string; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const style: CSSProperties = { font: 'inherit', color: 'inherit', letterSpacing: 'inherit', lineHeight: 'inherit', textAlign: 'inherit' };
  const stop = (e: KeyboardEvent) => { e.stopPropagation(); if (!multiline && e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } };
  return (
    <textarea ref={ref} rows={1} value={value} placeholder={placeholder} aria-label={ariaLabel} autoFocus={autoFocus} spellCheck
      onChange={(e) => onChange(multiline ? e.target.value : e.target.value.replace(/\n/g, ''))} onKeyDown={stop} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      className={cn('block w-full resize-none overflow-hidden bg-transparent border-0 p-0 m-0 outline-none rounded-sm placeholder:opacity-40 focus:bg-brand-500/[0.04]', className)} style={style} />
  );
}

interface ElementProps { el: FormElement; pageId: string; selected: boolean; conditional: boolean; index: number; count: number; hiddenBySection: boolean; isSection: boolean; collapsed: boolean; childCount: number }

const CanvasElement = memo(function CanvasElement({ el, pageId, selected, conditional, index, count, hiddenBySection, isSection, collapsed, childCount }: ElementProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: el.id, data: { from: 'canvas', pageId } });
  const select = useEditor((s) => s.select);
  const updateElement = useEditor((s) => s.updateElement);
  const moveElement = useEditor((s) => s.moveElement);
  const duplicateElement = useEditor((s) => s.duplicateElement);
  const deleteElement = useEditor((s) => s.deleteElement);
  const toggleSection = useEditor((s) => s.toggleSection);
  const def = FIELD_DEFINITIONS[el.type];
  const node = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (selected) node.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [selected]);

  const renderLabel = useMemo(() => (selected && (def.isInput || el.type === 'heading' || el.type === 'section' || el.type === 'rsvp_deadline_info'))
    ? (e: FormElement) => <InlineText ariaLabel="Label" value={e.label} placeholder="Type a question" autoFocus={false} className="!inline-block !w-[calc(100%-1.25em)] align-top" onChange={(v) => updateElement(e.id, (x) => { x.label = v; }, `label:${e.id}`)} />
    : undefined, [selected, def.isInput, el.type, updateElement]);

  if (hiddenBySection) return null;
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 5 : undefined };
  return (
    <div ref={(n) => { setNodeRef(n); node.current = n; }} style={style} data-editor-el={el.id}
      className={cn('group/el relative rounded-[10px] -mx-3 px-3 py-2.5 transition-[box-shadow,background] cursor-pointer w-[calc(100%+24px)]',
        el.style?.width === 'half' && 'sm:w-[calc(50%+16px)]',
        selected ? 'ring-2 ring-brand-500/70 bg-brand-500/[0.025]' : 'hover:ring-1 hover:ring-brand-500/30',
        isDragging && 'opacity-40')}
      onClick={(e) => { e.stopPropagation(); select({ kind: 'element', id: el.id }); }}>
      {(selected || conditional || el.type === 'hidden') && (
        <div className="absolute -top-2.5 left-3 flex gap-1 z-10">
          {selected && <span className="h-5 px-1.5 rounded bg-brand-500 text-white text-[10.5px] font-medium flex items-center">{def.name}</span>}
          {conditional && <Tooltip content="Shown or hidden by conditional logic"><span className="h-5 px-1.5 rounded bg-surface border border-line text-[10.5px] text-ink-2 font-medium flex items-center gap-1"><GitBranch className="size-3" />Conditional</span></Tooltip>}
        </div>
      )}
      {selected && (
        <div className="absolute -top-3.5 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-surface shadow-md p-0.5 text-ink-2" onClick={(e) => e.stopPropagation()}>
          <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="size-7 grid place-items-center rounded-md hover:bg-hover cursor-grab active:cursor-grabbing touch-none" aria-label="Drag to reorder"><GripVertical className="size-3.5" /></button>
          <Tooltip content="Move up"><button disabled={index === 0} onClick={() => moveElement(el.id, pageId, index - 1)} className="size-7 grid place-items-center rounded-md hover:bg-hover disabled:opacity-30 cursor-pointer" aria-label="Move up"><ArrowUp className="size-3.5" /></button></Tooltip>
          <Tooltip content="Move down"><button disabled={index === count - 1} onClick={() => moveElement(el.id, pageId, index + 1)} className="size-7 grid place-items-center rounded-md hover:bg-hover disabled:opacity-30 cursor-pointer" aria-label="Move down"><ArrowDown className="size-3.5" /></button></Tooltip>
          <Tooltip content="Duplicate (⌘D)"><button onClick={() => duplicateElement(el.id)} className="size-7 grid place-items-center rounded-md hover:bg-hover cursor-pointer" aria-label="Duplicate"><Copy className="size-3.5" /></button></Tooltip>
          <Tooltip content="Delete (Del)"><button onClick={() => deleteElement(el.id)} className="size-7 grid place-items-center rounded-md hover:bg-danger-50 hover:text-danger cursor-pointer" aria-label="Delete"><Trash2 className="size-3.5" /></button></Tooltip>
        </div>
      )}
      {!selected && <button ref={setActivatorNodeRef} {...attributes} {...listeners} tabIndex={-1} aria-hidden className="absolute -left-5 top-3 opacity-0 group-hover/el:opacity-100 text-faint cursor-grab touch-none hidden md:block"><GripVertical className="size-4" /></button>}
      {isSection && (
        <button onClick={(e) => { e.stopPropagation(); toggleSection(el.id); }} className="absolute right-3 top-3 z-[1] flex items-center gap-1 text-[11.5px] text-muted hover:text-ink cursor-pointer" aria-expanded={!collapsed}>
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}{collapsed ? `${childCount} hidden` : 'Collapse'}
        </button>
      )}
      {el.type === 'hidden' ? (
        <div className="fr-notice" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ opacity: .6 }}>Hidden field</span><b>{el.label || el.id}</b><span style={{ opacity: .6 }}>· {el.config.source === 'static' ? `fixed value “${String(el.defaultValue ?? '')}”` : `from ?${el.config.queryParam ?? 'ref'}=`}</span></div>
      ) : (
        <FieldView el={el} value={el.defaultValue} required={Boolean(el.required)} onChange={() => undefined} renderLabel={renderLabel} className="fr-design" />
      )}
    </div>
  );
});

function PageBlock({ page, index, total }: { page: FormPage; index: number; total: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `page:${page.id}`, data: { pageId: page.id } });
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const logic = useEditor((s) => s.schema!.logic);
  const update = useEditor((s) => s.update);
  const collapsed = useEditor((s) => s.collapsedSections);
  const conditional = useMemo(() => new Set(logic.flatMap((r) => r.actions.filter((a) => a.type === 'show' || a.type === 'hide').map((a) => a.target!))), [logic]);
  const multi = total > 1;
  const pageSelected = selection?.kind === 'page' && selection.id === page.id;

  // Section collapse: elements after a collapsed section (until the next section) are hidden in the canvas.
  const sectionInfo = useMemo(() => {
    let current: string | null = null;
    const hidden = new Set<string>();
    const counts: Record<string, number> = {};
    for (const el of page.elements) {
      if (el.type === 'section') { current = el.id; counts[el.id] = 0; continue; }
      if (current) { counts[current] = (counts[current] ?? 0) + 1; if (collapsed[current]) hidden.add(el.id); }
    }
    return { hidden, counts };
  }, [page.elements, collapsed]);

  return (
    <section className={cn('relative', multi && 'pt-6')}>
      {multi && (
        <div className={cn('mb-4 -mx-3 px-3 py-2 rounded-[10px] cursor-pointer', pageSelected ? 'ring-2 ring-brand-500/70' : 'hover:ring-1 hover:ring-brand-500/30')} onClick={(e) => { e.stopPropagation(); select({ kind: 'page', id: page.id }); }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-50 mb-1" style={{ fontFamily: 'var(--f-body-font)' }}>Page {index + 1} of {total}</p>
          <div className="fr-page-title"><InlineText ariaLabel="Page title" value={page.title ?? ''} placeholder="Page title (optional)" onChange={(v) => update((s) => { s.pages[index]!.title = v || undefined; }, `page:${page.id}`)} /></div>
        </div>
      )}
      <SortableContext items={page.elements.map((e) => e.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={cn('fr-fields min-h-[64px] rounded-[10px] transition-colors', isOver && 'bg-brand-500/[0.05] outline-2 outline-dashed outline-brand-500/40')}>
          {page.elements.map((el, i) => (
            <CanvasElement key={el.id} el={el} pageId={page.id} index={i} count={page.elements.length}
              selected={selection?.kind === 'element' && selection.id === el.id} conditional={conditional.has(el.id)}
              hiddenBySection={sectionInfo.hidden.has(el.id)} isSection={el.type === 'section'} collapsed={Boolean(collapsed[el.id])} childCount={sectionInfo.counts[el.id] ?? 0} />
          ))}
          {page.elements.length === 0 && <div className="w-full grid place-items-center text-[13px] opacity-50 py-6 border border-dashed rounded-[10px]" style={{ borderColor: 'var(--f-border)' }}>Drop elements here</div>}
        </div>
      </SortableContext>
      <div className="mt-3 flex justify-center" onClick={(e) => e.stopPropagation()}>
        <Popover align="center" className="w-[280px] h-[420px] p-0 overflow-hidden"
          trigger={<button className="h-8 px-3 rounded-full text-[12.5px] font-medium flex items-center gap-1.5 opacity-60 hover:opacity-100 border border-dashed cursor-pointer" style={{ borderColor: 'var(--f-border)', fontFamily: 'var(--f-body-font)' }} onClick={() => select({ kind: 'page', id: page.id })}><Plus className="size-3.5" />Add element</button>}>
          <ElementsPanel />
        </Popover>
      </div>
    </section>
  );
}

export function Canvas() {
  const schema = useEditor((s) => s.schema)!;
  const device = useEditor((s) => s.device);
  const select = useEditor((s) => s.select);
  const update = useEditor((s) => s.update);
  const addPage = useEditor((s) => s.addPage);
  const selection = useEditor((s) => s.selection);
  const ctx = useMemo(() => ({ mode: 'design' as const, deadline: null, event: null }), []);
  const formWidth = useMemo(() => resolveTheme(schema.theme).layout.formWidth, [schema.theme]);
  const width = device === 'mobile' ? 390 : formWidth + 160;

  // Keep selection valid after undo/redo.
  useEffect(() => { if (selection?.kind === 'element' && !locate(schema, selection.id)) select(null); }, [schema, selection, select]);

  return (
    <div className="min-h-full py-8 px-4 sm:px-8" onClick={() => select({ kind: 'form' })}>
      <div className="mx-auto transition-[max-width] duration-300" style={{ maxWidth: width }}>
        <RendererContext.Provider value={ctx}>
          <ThemeScope theme={schema.theme} fullPage className={cn('rounded-2xl overflow-hidden border border-line shadow-sm', device === 'mobile' && 'rounded-[28px] border-[6px] border-ink/85')}>
            <div className="fr-shell" style={device === 'mobile' ? { padding: '20px 12px 40px' } : undefined}>
              {schema.settings.coverImage && <img className="fr-cover" src={schema.settings.coverImage} alt="" />}
              <div className="fr-card">
                <header className={cn('fr-header -mx-3 px-3 py-2 rounded-[10px] cursor-pointer', selection?.kind === 'form' ? 'ring-2 ring-brand-500/70' : 'hover:ring-1 hover:ring-brand-500/30')} onClick={(e) => { e.stopPropagation(); select({ kind: 'form' }); }}>
                  <div className="fr-title"><InlineText ariaLabel="Form title" value={schema.form.title} placeholder="Form title" onChange={(v) => update((s) => { s.form.title = v; }, 'form:title')} /></div>
                  <div className="fr-desc"><InlineText ariaLabel="Form description" multiline value={schema.form.description ?? ''} placeholder="Add a description (optional)" onChange={(v) => update((s) => { s.form.description = v || undefined; }, 'form:desc')} /></div>
                </header>
                {schema.pages.map((p, i) => <PageBlock key={p.id} page={p} index={i} total={schema.pages.length} />)}
                <div className="fr-actions">
                  <button className="text-[12.5px] font-medium flex items-center gap-1.5 opacity-60 hover:opacity-100 cursor-pointer" style={{ fontFamily: 'var(--f-body-font)' }} onClick={(e) => { e.stopPropagation(); addPage(); }}><Plus className="size-3.5" />Add page</button>
                  <span className="fr-btn" style={{ cursor: 'text' }} onClick={(e) => e.stopPropagation()}>
                    <InlineText ariaLabel="Submit button label" value={schema.settings.submitLabel} onChange={(v) => update((s) => { s.settings.submitLabel = v || 'Submit'; }, 'submit')} className="text-center min-w-[60px]" />
                  </span>
                </div>
              </div>
            </div>
          </ThemeScope>
        </RendererContext.Provider>
      </div>
    </div>
  );
}
