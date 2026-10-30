import { useMemo, useState } from 'react';
import { Monitor, RotateCcw, Smartphone, X } from 'lucide-react';
import { FormRenderer } from '@rsvp/renderer';
import type { FormSchema } from '@rsvp/core';
import { Button, Segmented } from '../../components/ui';
import { useEditor } from './store';

/** Interactive preview: same renderer and logic engine as the public form, but nothing is submitted. */
export function Preview({ onClose }: { onClose: () => void }) {
  const schema = useEditor((s) => s.schema)!;
  const [device, setDevice] = useState<'desktop' | 'mobile'>(useEditor.getState().device);
  const [layout, setLayout] = useState<FormSchema['settings']['layout']>(schema.settings.layout);
  const [run, setRun] = useState(0);
  const previewSchema = useMemo(() => ({ ...schema, settings: { ...schema.settings, layout } }), [schema, layout]);
  return (
    <div className="fixed inset-0 z-50 bg-[#EDEBE6] flex flex-col animate-fade-in" role="dialog" aria-label="Preview">
      <div className="h-14 shrink-0 flex items-center gap-3 px-4 bg-surface border-b border-line">
        <span className="text-[13.5px] font-semibold hidden sm:block">Preview</span>
        <span className="text-[12px] text-muted hidden md:block">Responses are not saved</span>
        <div className="flex-1 flex justify-center gap-2">
          <Segmented size="sm" value={device} onChange={setDevice} items={[{ value: 'desktop', label: <Monitor />, title: 'Desktop' }, { value: 'mobile', label: <Smartphone />, title: 'Mobile' }]} />
          <Segmented size="sm" value={layout} onChange={(v) => { setLayout(v); setRun((r) => r + 1); }} items={[{ value: 'standard', label: 'Standard' }, { value: 'multistep', label: 'Steps' }, { value: 'conversational', label: 'One-by-one' }]} />
        </div>
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setRun((r) => r + 1)}>Restart</Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close preview"><X className="size-4" /></Button>
      </div>
      <div className="flex-1 overflow-auto p-4 sm:p-8">
        <div className={device === 'mobile' ? 'mx-auto w-[390px] max-w-full h-[780px] max-h-full rounded-[36px] border-[10px] border-ink shadow-lg overflow-hidden bg-white' : 'mx-auto max-w-[1100px] min-h-full rounded-xl overflow-hidden shadow-md border border-line'}>
          <div className={device === 'mobile' ? 'h-full overflow-y-auto' : 'min-h-[80vh]'}>
            <FormRenderer key={run} schema={previewSchema} mode="preview" checkinUrl={(t) => `${location.origin}/c/${t}`} allowEdit />
          </div>
        </div>
      </div>
    </div>
  );
}
