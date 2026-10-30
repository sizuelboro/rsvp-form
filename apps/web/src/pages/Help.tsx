import { PageHeader } from '../components/ui';

const FAQ: [string, string][] = [
  ['How do I collect RSVPs for an event?', 'Create an event, attach an RSVP form (Events → Forms tab), publish both, then add guests and send personal invitations from the Guests tab. Each guest gets a unique link, so their answers update their RSVP status automatically.'],
  ['What’s the difference between “accepted” and “checked in”?', 'Accepted counts guests who said yes. Checked in counts only guests scanned or checked in at the door using the Check-in screen. Analytics always shows both separately.'],
  ['Will editing a published form change existing responses?', 'No. Every publish creates an immutable version. Responses are stored against the exact version they answered, and edits stay in draft until you publish again.'],
  ['How does conditional logic work?', 'Open the Logic builder in the editor. Rules combine conditions with AND/OR and can show, hide or require fields, skip pages, jump to pages or show a message. The same engine runs in the preview, on the public form and on the server.'],
  ['Can guests change their RSVP?', 'Yes — guests who use their personal invitation link can resubmit; their existing response is updated and the change is recorded in the response history.'],
  ['How are duplicates avoided?', 'Guest imports match existing guests by email (or name and phone). Form responses with the same email are flagged as possible duplicates unless you allow multiple submissions.'],
];

export default function Help() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Help Center" description="Answers to common questions and developer documentation." />
      <div className="card divide-y divide-line mb-10">
        {FAQ.map(([q, a]) => <details key={q} className="group px-5 py-4"><summary className="text-[14px] font-medium cursor-pointer list-none flex justify-between">{q}<span className="text-faint group-open:rotate-45 transition-transform">+</span></summary><p className="text-[13.5px] text-ink-2 mt-2 leading-relaxed">{a}</p></details>)}
      </div>
      <h2 id="docs" className="text-[17px] font-semibold mb-3">Documentation</h2>
      <div className="card p-5 space-y-5 text-[13.5px] text-ink-2 leading-relaxed">
        <section><h3 className="font-semibold text-ink mb-1">Public URLs</h3><ul className="list-disc pl-5 space-y-1"><li><code>/f/&lt;slug&gt;</code> — a published form</li><li><code>/e/&lt;slug&gt;</code> — an event invitation page</li><li><code>/i/&lt;token&gt;</code> — a guest’s personal invitation (never indexed by search engines)</li></ul></section>
        <section><h3 className="font-semibold text-ink mb-1">Hidden fields</h3><p>Add a Hidden field and choose “URL parameter” to capture values such as <code>?utm_source=newsletter</code>.</p></section>
        <section><h3 className="font-semibold text-ink mb-1">Embedding</h3><p>Use the iframe snippet in the Publish dialog. Forms are responsive and work inside any website builder.</p></section>
        <section><h3 className="font-semibold text-ink mb-1">Webhooks</h3><p>Each delivery is a JSON <code>POST</code> with headers <code>X-Invitely-Event</code>, <code>X-Invitely-Timestamp</code> and <code>X-Invitely-Signature: v1=&lt;hex&gt;</code>, where the signature is HMAC-SHA256 of <code>timestamp + "." + body</code> using your signing secret.</p></section>
        <section><h3 className="font-semibold text-ink mb-1">REST API</h3><p>All workspace endpoints live under <code>/api/v1/w/&lt;workspaceId&gt;/…</code> and require a session cookie plus the <code>X-Requested-With: invitely</code> header. Public endpoints live under <code>/api/v1/public/…</code>. See <code>docs/03-api.md</code> in the repository for the full reference.</p></section>
      </div>
    </div>
  );
}
