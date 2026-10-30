import { createContext, useContext } from 'react';
import type { FileRef } from '@rsvp/core';

export interface PublicEventInfo {
  name: string; description?: string; startsAt: string | null; endsAt: string | null; timezone: string;
  venueName: string | null; address: string | null; coverImage?: string | null; rsvpDeadline?: string | null;
  sessions?: { id: string; name: string; startsAt: string | null; venueName: string | null; optionId: string | null }[];
}

export interface RendererContextValue {
  /** live: public form. design: editor canvas (inputs inert). preview: editor preview (interactive, no network). */
  mode: 'live' | 'design' | 'preview';
  deadline: string | null;
  event: PublicEventInfo | null;
  upload?: (fieldId: string, file: File) => Promise<FileRef>;
}

export const RendererContext = createContext<RendererContextValue>({ mode: 'live', deadline: null, event: null });
export const useRenderer = () => useContext(RendererContext);

export function formatDateTime(iso: string | null | undefined, timeZone = 'UTC', opts: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'short' }): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}
