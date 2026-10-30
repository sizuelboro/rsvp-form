import { renderSVG } from 'uqr';
import type { PublicEventInfo } from './context';
import { formatDateTime } from './context';
import { CalendarIcon, CheckIcon, PinIcon } from './icons';

export function EventDetails({ event, compact = false }: { event: PublicEventInfo; compact?: boolean }) {
  const tz = event.timezone || 'UTC';
  const where = [event.venueName, event.address].filter(Boolean).join(', ');
  return (
    <div className="fr-event">
      {event.startsAt && (
        <div className="fr-event-row"><CalendarIcon /><span>{formatDateTime(event.startsAt, tz)}{event.endsAt ? ` – ${formatDateTime(event.endsAt, tz, { timeStyle: 'short' })}` : ''}{tz !== 'UTC' ? <span className="fr-help" style={{ display: 'inline', marginLeft: 6 }}>({tz.replace(/_/g, ' ')})</span> : null}</span></div>
      )}
      {where && (
        <div className="fr-event-row"><PinIcon /><span>{where} · <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--f-primary)' }}>Map</a></span></div>
      )}
      {!compact && event.sessions && event.sessions.length > 0 && (
        <div className="fr-sessions">
          {event.sessions.map((s) => (
            <div className="fr-session" key={s.id}><span>{s.name}</span><span>{[s.startsAt ? formatDateTime(s.startsAt, tz, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '', s.venueName].filter(Boolean).join(' · ')}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QrCode({ value, caption }: { value: string; caption?: string }) {
  const svg = renderSVG(value, { border: 1 });
  return (
    <div className="fr-qr">
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="Check-in QR code" />
      {caption && <p>{caption}</p>}
    </div>
  );
}

export interface ConfirmationProps {
  title: string;
  message: string;
  event?: PublicEventInfo | null;
  checkinUrl?: string | null;
  onEdit?: () => void;
}

export function Confirmation({ title, message, event, checkinUrl, onEdit }: ConfirmationProps) {
  return (
    <div className="fr-confirm" role="status" aria-live="polite">
      <div className="fr-confirm-icon"><CheckIcon width={26} height={26} /></div>
      <h1 className="fr-title" tabIndex={-1}>{title}</h1>
      <p className="fr-desc">{message}</p>
      {checkinUrl && <QrCode value={checkinUrl} caption="Show this code at the entrance" />}
      {event && <EventDetails event={event} />}
      {onEdit && <p style={{ marginTop: 20 }}><button type="button" className="fr-link-btn" onClick={onEdit}>Edit my response</button></p>}
    </div>
  );
}
