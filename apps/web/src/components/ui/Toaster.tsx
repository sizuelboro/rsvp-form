import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useToasts } from '../../stores/toast';
import { cn } from './primitives';

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 w-[min(380px,calc(100vw-32px))]" aria-live="polite" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className="flex gap-3 items-start bg-surface border border-line shadow-lg rounded-lg px-3.5 py-3 animate-slide-up">
          <span className={cn('mt-0.5 [&>svg]:size-4', t.tone === 'success' ? 'text-success' : t.tone === 'error' ? 'text-danger' : 'text-brand-500')}>
            {t.tone === 'success' ? <CheckCircle2 /> : t.tone === 'error' ? <AlertCircle /> : <Info />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-medium text-ink">{t.title}</p>
            {t.description && <p className="text-[12.5px] text-muted mt-0.5">{t.description}</p>}
            {t.action && <button className="text-[12.5px] font-medium text-brand-600 mt-1.5 cursor-pointer" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>}
          </div>
          <button className="text-faint hover:text-ink cursor-pointer" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}
