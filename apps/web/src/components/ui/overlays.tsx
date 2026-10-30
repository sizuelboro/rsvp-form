import { useState, type ReactNode } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import * as RDropdown from '@radix-ui/react-dropdown-menu';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RPopover from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { Button, cn } from './primitives';

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const w = { sm: 'max-w-[420px]', md: 'max-w-[540px]', lg: 'max-w-[720px]', xl: 'max-w-[1000px]' }[size];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-ink/25 backdrop-blur-[2px] animate-fade-in" />
        <RDialog.Content className={cn('fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-24px)] max-h-[calc(100vh-48px)] flex flex-col bg-surface rounded-xl shadow-lg border border-line animate-slide-up focus:outline-none', w)}>
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <RDialog.Title className="text-[16px] font-semibold text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="text-[13px] text-muted mt-1">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>}
            </div>
            <RDialog.Close asChild><Button variant="ghost" size="icon-sm" aria-label="Close"><X className="size-4" /></Button></RDialog.Close>
          </div>
          <div className="px-6 pb-5 overflow-y-auto">{children}</div>
          {footer && <div className="flex justify-end gap-2 px-6 py-3.5 border-t border-line bg-canvas/60 rounded-b-xl">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', danger, onConfirm, children }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm"
      footer={<>
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onOpenChange(false); } finally { setBusy(false); } }}>{confirmLabel}</Button>
      </>}>
      {children}
    </Dialog>
  );
}

/** Right-side panel for record details (responses, guests). */
export function Drawer({ open, onOpenChange, title, children, footer, width = 520 }: { open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-ink/15 animate-fade-in" />
        <RDialog.Content className="fixed z-40 right-0 top-0 h-full max-w-full bg-surface border-l border-line shadow-lg flex flex-col animate-slide-in-right focus:outline-none" style={{ width }}>
          <div className="flex items-center justify-between gap-3 px-5 h-14 border-b border-line shrink-0">
            <RDialog.Title className="text-[15px] font-semibold truncate">{title}</RDialog.Title>
            <RDialog.Description className="sr-only">Details</RDialog.Description>
            <RDialog.Close asChild><Button variant="ghost" size="icon-sm" aria-label="Close"><X className="size-4" /></Button></RDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-line">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export const Menu = RDropdown.Root;
export const MenuTrigger = RDropdown.Trigger;

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <RDropdown.Portal>
      <RDropdown.Content align={align} sideOffset={6} className={cn('z-50 min-w-[190px] bg-surface rounded-lg border border-line shadow-md p-1 animate-slide-up', className)}>
        {children}
      </RDropdown.Content>
    </RDropdown.Portal>
  );
}

export function MenuItem({ children, onSelect, icon, danger, disabled, shortcut }: { children: ReactNode; onSelect?: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean; shortcut?: string }) {
  return (
    <RDropdown.Item disabled={disabled} onSelect={onSelect}
      className={cn('flex items-center gap-2.5 h-8 px-2.5 rounded-md text-[13px] cursor-pointer outline-none select-none data-[highlighted]:bg-hover data-[disabled]:opacity-40 [&>svg]:size-4 [&>svg]:text-muted', danger && 'text-danger [&>svg]:text-danger')}>
      {icon}<span className="flex-1">{children}</span>{shortcut && <span className="text-[11px] text-faint">{shortcut}</span>}
    </RDropdown.Item>
  );
}

export const MenuSeparator = () => <RDropdown.Separator className="h-px bg-line my-1" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <RDropdown.Label className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{children}</RDropdown.Label>;

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-[60] max-w-[260px] rounded-md bg-ink text-white text-[12px] leading-snug px-2.5 py-1.5 shadow-md animate-fade-in">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
export const TooltipProvider = RTooltip.Provider;

export function Popover({ trigger, children, align = 'start', className }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content align={align} sideOffset={6} className={cn('z-50 bg-surface rounded-lg border border-line shadow-md p-3 animate-slide-up focus:outline-none', className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
