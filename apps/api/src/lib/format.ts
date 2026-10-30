/** Formats an ISO UTC timestamp in the event's own time zone. */
export function formatEventDate(iso: string | null | undefined, timeZone = 'UTC'): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
