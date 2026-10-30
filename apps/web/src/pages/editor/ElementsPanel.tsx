import { memo, useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Search } from 'lucide-react';
import { FIELD_CATEGORIES, FIELD_DEFINITIONS, type FieldDefinition, type FieldType } from '@rsvp/core';
import { Tooltip, cn } from '../../components/ui';
import { FIELD_ICONS } from './icons';
import { useEditor } from './store';

const PaletteItem = memo(function PaletteItem({ def }: { def: FieldDefinition }) {
  const addElement = useEditor((s) => s.addElement);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${def.type}`, data: { from: 'palette', type: def.type } });
  const Icon = FIELD_ICONS[def.icon] ?? FIELD_ICONS.Type!;
  return (
    <Tooltip content={def.description} side="right">
      <button ref={setNodeRef} {...attributes} {...listeners} onClick={() => addElement(def.type as FieldType)}
        className={cn('w-full flex items-center gap-2.5 h-9 px-2.5 rounded-md text-[13px] text-ink-2 hover:bg-hover hover:text-ink transition-colors cursor-grab active:cursor-grabbing text-left touch-none', isDragging && 'opacity-40')}
        aria-label={`Add ${def.name}`}>
        <span className="size-6 rounded-md border border-line bg-surface grid place-items-center shrink-0"><Icon className="size-3.5 text-muted" /></span>
        <span className="truncate">{def.name}</span>
      </button>
    </Tooltip>
  );
});

export function ElementsPanel() {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return FIELD_CATEGORIES.map((c) => ({
      ...c,
      items: Object.values(FIELD_DEFINITIONS).filter((d) => d.category === c.id && (!term || `${d.name} ${d.description}`.toLowerCase().includes(term))),
    })).filter((g) => g.items.length);
  }, [q]);
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-line">
        <div className="relative">
          <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search elements" aria-label="Search elements"
            className="w-full h-8 pl-8 pr-2 rounded-md border border-line bg-canvas text-[13px] outline-none focus:border-brand-500 focus:bg-surface" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {groups.map((g) => (
          <div key={g.id} className="mb-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint px-2.5 pt-2 pb-1.5">{g.name}</p>
            <div className="grid grid-cols-1 gap-px">{g.items.map((d) => <PaletteItem key={d.type} def={d} />)}</div>
          </div>
        ))}
        {!groups.length && <p className="text-[13px] text-muted p-3">No elements match “{q}”.</p>}
      </div>
      <p className="text-[11.5px] text-faint px-3 py-2.5 border-t border-line">Click to insert after the selection, or drag onto the canvas.</p>
    </div>
  );
}
