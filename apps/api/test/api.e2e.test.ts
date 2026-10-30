/**
 * End-to-end API tests against a running Worker (wrangler dev with local D1/R2/Queues).
 *   npm run dev -w @rsvp/api   # in another terminal
 *   npm run test -w @rsvp/api
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it, beforeAll } from 'vitest';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const uid = () => Math.random().toString(36).slice(2, 10);

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'x-requested-with': 'invitely', ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.req('POST', p, b ?? {}, h);
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  del = (p: string, b?: unknown) => this.req('DELETE', p, b);
}

function sql(command: string) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', command], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });
}

async function signup(name = 'Owner') {
  const c = new Client();
  const email = `${uid()}@example.com`;
  const r = await c.post('/api/v1/auth/signup', { name, email, password: 'correct-horse-1' });
  expect(r.status).toBe(201);
  return { c, wid: r.json.workspaceId as string, email };
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeout = 20000): Promise<T> {
  const start = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 500));
    v = await fn();
  }
  return v;
}

const pub = new Client();

describe('auth & security', () => {
  it('signs up, reads /me, logs out and back in', async () => {
    const { c, email } = await signup('Ada');
    const me = await c.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe(email);
    expect(me.json.workspaces).toHaveLength(1);
    expect(me.json.workspaces[0].role).toBe('owner');
    expect((await c.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
    expect((await c.post('/api/v1/auth/login', { email, password: 'wrong-password' })).status).toBe(401);
    expect((await c.post('/api/v1/auth/login', { email, password: 'correct-horse-1' })).status).toBe(200);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const { email } = await signup();
    const c = new Client();
    expect((await c.post('/api/v1/auth/signup', { name: 'X', email, password: 'correct-horse-1' })).status).toBe(409);
    expect((await c.post('/api/v1/auth/signup', { name: 'X', email: `${uid()}@x.com`, password: 'short' })).status).toBe(422);
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const { c, wid } = await signup();
    const r = await fetch(`${BASE}/api/v1/w/${wid}/forms`, { method: 'POST', headers: { cookie: c.cookie, 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(403);
  });

  it('isolates workspaces', async () => {
    const a = await signup('A');
    const b = await signup('B');
    const f = await a.c.post(`/api/v1/w/${a.wid}/forms`, { templateId: 'contact-us' });
    expect(f.status).toBe(201);
    expect((await b.c.get(`/api/v1/w/${a.wid}/forms`)).status).toBe(404);
    expect((await b.c.get(`/api/v1/w/${b.wid}/forms/${f.json.id}`)).status).toBe(404);
    expect((await b.c.patch(`/api/v1/w/${b.wid}/forms/${f.json.id}`, { name: 'hijack' })).status).toBe(404);
    expect((await pub.get(`/api/v1/w/${a.wid}/forms`)).status).toBe(401);
  });
});

describe('forms, autosave and publishing', () => {
  let ctx: Awaited<ReturnType<typeof signup>>;
  let formId: string;
  let slug: string;
  beforeAll(async () => {
    ctx = await signup();
    const r = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms`, { templateId: 'wedding-classic', name: 'Our Wedding' });
    formId = r.json.id; slug = r.json.slug;
  });

  it('creates from a template with an editable schema', async () => {
    const f = await ctx.c.get(`/api/v1/w/${ctx.wid}/forms/${formId}`);
    expect(f.json.schema.form.title).toBe('Our Wedding');
    expect(f.json.kind).toBe('rsvp');
    expect(f.json.status).toBe('draft');
    expect(f.json.draft_revision).toBe(1);
  });

  it('is not public before publishing', async () => {
    expect((await pub.get(`/api/v1/public/forms/${slug}`)).status).toBe(404);
  });

  it('autosaves with optimistic concurrency and reports conflicts', async () => {
    const f = await ctx.c.get(`/api/v1/w/${ctx.wid}/forms/${formId}`);
    const schema = f.json.schema;
    schema.form.description = 'Edited in tab 1';
    const s1 = await ctx.c.patch(`/api/v1/w/${ctx.wid}/forms/${formId}`, { schema, baseRevision: 1 });
    expect(s1.status).toBe(200);
    expect(s1.json.revision).toBe(2);
    schema.form.description = 'Stale edit from tab 2';
    const s2 = await ctx.c.patch(`/api/v1/w/${ctx.wid}/forms/${formId}`, { schema, baseRevision: 1 });
    expect(s2.status).toBe(409);
    expect(s2.json.error.details.revision).toBe(2);
    expect(s2.json.error.details.schema.form.description).toBe('Edited in tab 1');
  });

  it('rejects malformed schemas', async () => {
    const r = await ctx.c.patch(`/api/v1/w/${ctx.wid}/forms/${formId}`, { schema: { schemaVersion: 1, pages: [] }, baseRevision: 2 });
    expect(r.status).toBe(422);
  });

  it('publishes immutable versions; drafts do not change the live form', async () => {
    const p1 = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms/${formId}/publish`);
    expect(p1.status).toBe(200);
    expect(p1.json.version).toBe(1);
    const live = await pub.get(`/api/v1/public/forms/${slug}`);
    expect(live.status).toBe(200);
    expect(live.json.form.version).toBe(1);
    const f = await ctx.c.get(`/api/v1/w/${ctx.wid}/forms/${formId}`);
    const schema = f.json.schema;
    schema.form.title = 'Draft title';
    await ctx.c.patch(`/api/v1/w/${ctx.wid}/forms/${formId}`, { schema, baseRevision: f.json.draft_revision });
    const stillLive = await pub.get(`/api/v1/public/forms/${slug}`);
    expect(stillLive.json.schema.form.title).toBe('Our Wedding');
    const p2 = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms/${formId}/publish`);
    expect(p2.json.version).toBe(2);
    expect((await pub.get(`/api/v1/public/forms/${slug}`)).json.schema.form.title).toBe('Draft title');
    const versions = await ctx.c.get(`/api/v1/w/${ctx.wid}/forms/${formId}/versions`);
    expect(versions.json.items.map((v: any) => v.version)).toEqual([2, 1]);
  });

  it('refuses to update a published version at the database level', () => {
    expect(() => sql("UPDATE form_versions SET schema = '{}'")).toThrow();
  });
});

describe('public submissions', () => {
  let ctx: Awaited<ReturnType<typeof signup>>;
  let formId: string;
  let slug: string;
  const valid = { full_name: 'Grace Hopper', email: 'grace@example.com', attendance: 'accept', guest_count: { adults: 2, children: 0 }, meal: 'vegetarian' };
  beforeAll(async () => {
    ctx = await signup();
    const r = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms`, { templateId: 'wedding-classic' });
    formId = r.json.id; slug = r.json.slug;
    await ctx.c.post(`/api/v1/w/${ctx.wid}/forms/${formId}/publish`);
  });

  it('validates server-side and strips hidden/unknown fields', async () => {
    const bad = await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { full_name: 'X', email: 'nope', attendance: 'accept' } });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.json.error.details.fields).sort()).toEqual(['email', 'guest_count']);
    const good = await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, decline_message: 'hidden for accepters', injected: '<script>' }, startedAt: Date.now() - 10000 });
    expect(good.status).toBe(201);
    expect(good.json.confirmation.title).toBe('Thank you, Grace Hopper!');
    const detail = await ctx.c.get(`/api/v1/w/${ctx.wid}/submissions/${good.json.submissionId}`);
    expect(detail.json.data.decline_message).toBeUndefined();
    expect(detail.json.data.injected).toBeUndefined();
    expect(detail.json.version).toBe(1);
  });

  it('is idempotent for retried requests', async () => {
    const key = `idem-${uid()}`;
    const a = await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, email: `${uid()}@x.com` }, idempotencyKey: key, startedAt: Date.now() - 5000 });
    const b = await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, email: `${uid()}@x.com` }, idempotencyKey: key, startedAt: Date.now() - 5000 });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json.submissionId).toBe(a.json.submissionId);
  });

  it('flags duplicates and silently quarantines spam', async () => {
    const dup = await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: valid, startedAt: Date.now() - 5000 });
    expect(dup.status).toBe(201);
    const list = await ctx.c.get(`/api/v1/w/${ctx.wid}/submissions?formId=${formId}&duplicates=only`);
    expect(list.json.total).toBe(1);
    const spam = await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, email: 'bot@spam.com' }, website_url: 'http://spam', startedAt: Date.now() - 5000 });
    expect(spam.status).toBe(201);
    const spamList = await ctx.c.get(`/api/v1/w/${ctx.wid}/submissions?formId=${formId}&status=spam`);
    expect(spamList.json.total).toBe(1);
  });

  it('records the funnel (views → starts → completions)', async () => {
    const v = await pub.post(`/api/v1/public/forms/${slug}/visits`, { device: 'mobile' });
    await pub.post(`/api/v1/public/visits/${v.json.visitId}/start`);
    await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, email: `${uid()}@x.com` }, visitId: v.json.visitId, startedAt: Date.now() - 5000, device: 'mobile' });
    const a = await ctx.c.get(`/api/v1/w/${ctx.wid}/analytics/forms/${formId}`);
    expect(a.json.funnel.views).toBe(1);
    expect(a.json.funnel.completions).toBe(1);
    expect(a.json.submissions).toBeGreaterThanOrEqual(3);
    const attendance = a.json.fields.find((f: any) => f.fieldId === 'attendance');
    expect(attendance.values[0]).toMatchObject({ value: 'accept', label: 'Joyfully accept' });
  });

  it('enforces deadlines with the configured late policy', async () => {
    await ctx.c.patch(`/api/v1/w/${ctx.wid}/forms/${formId}`, { closesAt: '2020-01-01T00:00:00.000Z', latePolicy: 'block', closedMessage: 'RSVPs are closed' });
    const closed = await pub.get(`/api/v1/public/forms/${slug}`);
    expect(closed.json.closed).toBe(true);
    expect(closed.json.closedMessage).toBe('RSVPs are closed');
    expect((await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, email: `${uid()}@x.com` }, startedAt: Date.now() - 5000 })).status).toBe(410);
    await ctx.c.patch(`/api/v1/w/${ctx.wid}/forms/${formId}`, { latePolicy: 'flag' });
    const late = await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, email: `${uid()}@x.com` }, startedAt: Date.now() - 5000 });
    expect(late.status).toBe(201);
    const detail = await ctx.c.get(`/api/v1/w/${ctx.wid}/submissions/${late.json.submissionId}`);
    expect(detail.json.is_late).toBe(1);
    await ctx.c.patch(`/api/v1/w/${ctx.wid}/forms/${formId}`, { closesAt: null });
  });

  it('protects password forms', async () => {
    await ctx.c.patch(`/api/v1/w/${ctx.wid}/forms/${formId}`, { access: 'password', password: 'open-sesame' });
    const locked = await pub.get(`/api/v1/public/forms/${slug}`);
    expect(locked.json.locked).toBe('password');
    expect(locked.json.schema).toBeUndefined();
    expect((await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: valid })).status).toBe(401);
    expect((await pub.post(`/api/v1/public/forms/${slug}/unlock`, { password: 'nope' })).status).toBe(401);
    const unlocked = await pub.post(`/api/v1/public/forms/${slug}/unlock`, { password: 'open-sesame' });
    const token = unlocked.json.accessToken;
    expect((await pub.req('GET', `/api/v1/public/forms/${slug}`, undefined, { 'x-form-access': token })).json.schema).toBeDefined();
    expect((await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, email: `${uid()}@x.com` }, accessToken: token, startedAt: Date.now() - 5000 })).status).toBe(201);
    await ctx.c.patch(`/api/v1/w/${ctx.wid}/forms/${formId}`, { access: 'public' });
  });

  it('verifies uploaded file contents and sizes', async () => {
    const r = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms`, { templateId: 'job-application' });
    await ctx.c.post(`/api/v1/w/${ctx.wid}/forms/${r.json.id}/publish`);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const pdf = new TextEncoder().encode('%PDF-1.4 fake pdf body for testing');
    const fake = new FormData(); fake.set('fieldId', 'resume'); fake.set('file', new Blob([png], { type: 'application/pdf' }), 'cv.pdf');
    expect((await pub.req('POST', `/api/v1/public/forms/${r.json.slug}/uploads`, fake)).status).toBe(415);
    const ok = new FormData(); ok.set('fieldId', 'resume'); ok.set('file', new Blob([pdf], { type: 'application/pdf' }), 'cv.pdf');
    const up = await pub.req('POST', `/api/v1/public/forms/${r.json.slug}/uploads`, ok);
    expect(up.status).toBe(201);
    expect(up.json.key).toMatch(/^uploads\//);
  });

  it('exports CSV with formula-injection protection', async () => {
    await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, full_name: '=HYPERLINK("http://evil")', email: `${uid()}@x.com` }, startedAt: Date.now() - 5000 });
    const csv = await ctx.c.get(`/api/v1/w/${ctx.wid}/submissions/export/csv?formId=${formId}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('records organizer edits in response history', async () => {
    const s = await pub.post(`/api/v1/public/forms/${slug}/submissions`, { answers: { ...valid, email: `${uid()}@x.com` }, startedAt: Date.now() - 5000 });
    const e = await ctx.c.patch(`/api/v1/w/${ctx.wid}/submissions/${s.json.submissionId}`, { answers: { meal: 'vegan' }, status: 'reviewed' });
    expect(e.status).toBe(200);
    const d = await ctx.c.get(`/api/v1/w/${ctx.wid}/submissions/${s.json.submissionId}`);
    expect(d.json.data.meal).toBe('vegan');
    expect(d.json.history.map((h: any) => h.type)).toEqual(['created', 'edited_by_organizer', 'status_changed']);
    expect((await ctx.c.patch(`/api/v1/w/${ctx.wid}/submissions/${s.json.submissionId}`, { answers: { meal: 'pizza' } })).status).toBe(422);
  });
});

describe('events, guests, invitations and check-in', () => {
  let ctx: Awaited<ReturnType<typeof signup>>;
  let eventId: string;
  let eventSlug: string;
  let formSlug: string;
  beforeAll(async () => {
    ctx = await signup('Planner');
    const e = await ctx.c.post(`/api/v1/w/${ctx.wid}/events`, { name: 'Sarah & John’s Wedding', startsAt: '2027-02-14T12:30:00.000Z', timezone: 'Asia/Kolkata', venueName: 'Lake Palace', capacity: 100 });
    expect(e.status).toBe(201);
    eventId = e.json.id;
    eventSlug = e.json.slug;
    expect(eventSlug).toMatch(/^sarah-and-johns-wedding/);
    for (const [i, name] of ['Mehendi', 'Wedding Ceremony', 'Reception'].entries()) {
      expect((await ctx.c.post(`/api/v1/w/${ctx.wid}/events/${eventId}/sessions`, { name, sortOrder: i })).status).toBe(201);
    }
    const f = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms`, { templateId: 'wedding-multi-event', eventId });
    formSlug = f.json.slug;
    await ctx.c.post(`/api/v1/w/${ctx.wid}/forms/${f.json.id}/publish`);
  });

  it('imports CSV guests without creating duplicates', async () => {
    const csv = 'Name,Email,Phone,Group,Household,Table\nPriya Sharma,priya@example.com,+91 98765 43210,Bride family,Sharma,1\nRahul Verma,rahul@example.com,,Friends,,2\npriya dup,PRIYA@example.com,,,,\nNo Email Guest,,+91 90000 00000,Friends,,3\nBad,not-an-email,,,,\n';
    const dry = await ctx.c.post(`/api/v1/w/${ctx.wid}/guests/import`, { csv, eventId, dryRun: true });
    expect(dry.json).toMatchObject({ total: 4, create: 3, update: 0, duplicatesInFile: 1 });
    expect(dry.json.errors).toHaveLength(1);
    const real = await ctx.c.post(`/api/v1/w/${ctx.wid}/guests/import`, { csv, eventId });
    expect(real.json.created).toBe(3);
    const again = await ctx.c.post(`/api/v1/w/${ctx.wid}/guests/import`, { csv, eventId });
    expect(again.json.created).toBe(0);
    expect(again.json.updated).toBe(3);
    const list = await ctx.c.get(`/api/v1/w/${ctx.wid}/guests`);
    expect(list.json.total).toBe(3);
    const priya = list.json.items.find((g: any) => g.email === 'priya@example.com');
    expect(priya.group_name).toBe('Bride family');
    expect(priya.attributes.Table).toBe('1');
    const eg = await ctx.c.get(`/api/v1/w/${ctx.wid}/events/${eventId}/guests`);
    expect(eg.json.total).toBe(3);
  });

  it('never sends invitations without explicit confirmation', async () => {
    const eg = await ctx.c.get(`/api/v1/w/${ctx.wid}/events/${eventId}/guests`);
    const ids = eg.json.items.map((g: any) => g.id);
    const prep = await ctx.c.post(`/api/v1/w/${ctx.wid}/events/${eventId}/invitations/prepare`, { audience: 'all' });
    expect(prep.json).toMatchObject({ total: 3, withEmail: 2, withoutEmail: 1, formPublished: true });
    expect((await ctx.c.post(`/api/v1/w/${ctx.wid}/events/${eventId}/invitations/send`, { eventGuestIds: ids })).status).toBe(422);
    // Draft events cannot send
    expect((await ctx.c.post(`/api/v1/w/${ctx.wid}/events/${eventId}/invitations/send`, { eventGuestIds: ids, confirm: true })).status).toBe(422);
    await ctx.c.patch(`/api/v1/w/${ctx.wid}/events/${eventId}`, { status: 'published', rsvpDeadline: '2027-01-15T18:30:00.000Z' });
    const sent = await ctx.c.post(`/api/v1/w/${ctx.wid}/events/${eventId}/invitations/send`, { eventGuestIds: ids, confirm: true });
    expect(sent.json).toMatchObject({ queued: 2, skipped: 1 });
    // Queue consumer processes the jobs (log provider in dev) and marks invitations delivered.
    const after = await waitFor(() => ctx.c.get(`/api/v1/w/${ctx.wid}/events/${eventId}/guests?invitation=delivered`), (r) => r.json.total === 2);
    expect(after.json.total).toBe(2);
    const jobs = await ctx.c.get(`/api/v1/w/${ctx.wid}/notifications/jobs`);
    expect(jobs.json.items.filter((j: any) => j.type === 'invitation' && j.status === 'delivered')).toHaveLength(2);
  }, 40000);

  it('lets a guest RSVP through their personal link and updates event metrics', async () => {
    const eg = await ctx.c.get(`/api/v1/w/${ctx.wid}/events/${eventId}/guests?search=priya`);
    const priya = eg.json.items[0];
    const token = priya.rsvpUrl.split('/i/')[1];
    const inv = await pub.get(`/api/v1/public/invitations/${token}`);
    expect(inv.status).toBe(200);
    expect(inv.json.guest.name).toBe('Priya Sharma');
    expect(inv.json.form.schema.settings.layout).toBe('multistep');
    const answers = { full_name: 'Priya Sharma', email: 'priya@example.com', phone: '+91 98765 43210', attendance: 'accept', events: ['mehendi', 'reception'], guest_count: { adults: 2, children: 1 }, meal: 'jain', accommodation: 'not_needed' };
    const r = await pub.post(`/api/v1/public/forms/${formSlug}/submissions`, { answers, invitationToken: token, startedAt: Date.now() - 5000 });
    expect(r.status).toBe(201);
    expect(r.json.checkinToken).toBeTruthy();
    const a = await ctx.c.get(`/api/v1/w/${ctx.wid}/analytics/events/${eventId}`);
    expect(a.json.rsvp).toMatchObject({ invited: 3, accepted: 1, pending: 2 });
    expect(a.json.expected).toMatchObject({ attendees: 3, adults: 2, children: 1 });
    expect(a.json.attendance.checkedInGuests).toBe(0);
    expect(a.json.meals[0]).toMatchObject({ meal: 'jain', label: 'Jain', attendees: 3 });
    const sessions = Object.fromEntries(a.json.sessions.map((s: any) => [s.name, s.accepted]));
    expect(sessions).toEqual({ Mehendi: 1, 'Wedding Ceremony': 0, Reception: 1 });

    // Updating through the same link edits the response instead of duplicating it.
    const r2 = await pub.post(`/api/v1/public/forms/${formSlug}/submissions`, { answers: { ...answers, guest_count: { adults: 1, children: 0 } }, invitationToken: token, startedAt: Date.now() - 5000 });
    expect(r2.status).toBe(200);
    expect(r2.json.submissionId).toBe(r.json.submissionId);
    const a2 = await ctx.c.get(`/api/v1/w/${ctx.wid}/analytics/events/${eventId}`);
    expect(a2.json.expected.attendees).toBe(1);
    const qr = await fetch(`${BASE}/api/v1/public/qr/${r.json.checkinToken}`);
    expect(qr.headers.get('content-type')).toContain('image/svg+xml');
  });

  it('rejects invitation tokens used on a different form', async () => {
    const eg = await ctx.c.get(`/api/v1/w/${ctx.wid}/events/${eventId}/guests?search=rahul`);
    const token = eg.json.items[0].rsvpUrl.split('/i/')[1];
    const other = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms`, { templateId: 'contact-us' });
    await ctx.c.post(`/api/v1/w/${ctx.wid}/forms/${other.json.id}/publish`);
    const r = await pub.post(`/api/v1/public/forms/${other.json.slug}/submissions`, { answers: { full_name: 'R', email: 'rahul@example.com', message: 'hello there friends' }, invitationToken: token });
    expect(r.status).toBe(403);
  });

  it('checks guests in by QR, prevents duplicates and requires override for declined guests', async () => {
    const inv = await ctx.c.get(`/api/v1/w/${ctx.wid}/events/${eventId}/guests?search=priya`);
    const token = inv.json.items[0].rsvpUrl.split('/i/')[1];
    const page = await pub.get(`/api/v1/public/invitations/${token}`);
    const code = `http://localhost:8787/c/${page.json.checkinToken}`;
    const look = await ctx.c.post(`/api/v1/w/${ctx.wid}/checkins/lookup`, { code });
    expect(look.json.guest.name).toBe('Priya Sharma');
    const first = await ctx.c.post(`/api/v1/w/${ctx.wid}/checkins`, { code, eventId });
    expect(first.status).toBe(201);
    const dup = await ctx.c.post(`/api/v1/w/${ctx.wid}/checkins`, { code, eventId });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe('already_checked_in');

    const rahul = (await ctx.c.get(`/api/v1/w/${ctx.wid}/events/${eventId}/guests?search=rahul`)).json.items[0];
    await ctx.c.patch(`/api/v1/w/${ctx.wid}/events/${eventId}/guests/${rahul.id}`, { rsvpStatus: 'declined' });
    const blocked = await ctx.c.post(`/api/v1/w/${ctx.wid}/checkins`, { eventGuestId: rahul.id });
    expect(blocked.status).toBe(423);
    const forced = await ctx.c.post(`/api/v1/w/${ctx.wid}/checkins`, { eventGuestId: rahul.id, override: true, note: 'Plans changed' });
    expect(forced.status).toBe(201);
    expect((await ctx.c.del(`/api/v1/w/${ctx.wid}/checkins/${forced.json.id}`)).status).toBe(200);

    const a = await ctx.c.get(`/api/v1/w/${ctx.wid}/analytics/events/${eventId}`);
    expect(a.json.attendance).toMatchObject({ checkedInGuests: 1, checkInRate: 100 });
    expect(a.json.rsvp.declined).toBe(1);
    const other = await signup();
    expect((await other.c.post(`/api/v1/w/${other.wid}/checkins/lookup`, { code })).status).toBe(404);
  });

  it('serves public event pages only after publishing and exports a report', async () => {
    const page = await pub.get(`/api/v1/public/events/${eventSlug}`);
    expect(page.status).toBe(200);
    expect(page.json.event.sessions).toHaveLength(3);
    expect(page.json.event.capacity).toBeUndefined();
    const csv = await ctx.c.get(`/api/v1/w/${ctx.wid}/events/${eventId}/export`);
    expect(csv.text.split('\r\n')).toHaveLength(4);
    expect(csv.text).toContain('Priya Sharma');
  });

  it('enforces event capacity', async () => {
    const e = await ctx.c.post(`/api/v1/w/${ctx.wid}/events`, { name: `Tiny dinner ${uid()}`, capacity: 2, status: 'published' });
    const f = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms`, { templateId: 'wedding-classic', eventId: e.json.id });
    await ctx.c.post(`/api/v1/w/${ctx.wid}/forms/${f.json.id}/publish`);
    const base = { attendance: 'accept', meal: 'vegan' };
    expect((await pub.post(`/api/v1/public/forms/${f.json.slug}/submissions`, { answers: { ...base, full_name: 'A', email: `${uid()}@x.com`, guest_count: { adults: 2, children: 0 } }, startedAt: Date.now() - 5000 })).status).toBe(201);
    const full = await pub.post(`/api/v1/public/forms/${f.json.slug}/submissions`, { answers: { ...base, full_name: 'B', email: `${uid()}@x.com`, guest_count: { adults: 1, children: 0 } }, startedAt: Date.now() - 5000 });
    expect(full.status).toBe(409);
    expect(full.json.error.code).toBe('event_full');
  });
});

describe('plans and roles', () => {
  it('enforces plan limits and features server-side once the trial ends', async () => {
    const ctx = await signup();
    sql(`UPDATE subscriptions SET trial_ends_at = '2000-01-01T00:00:00.000Z' WHERE workspace_id = '${ctx.wid}'`);
    const w = await ctx.c.get(`/api/v1/w/${ctx.wid}`);
    expect(w.json.entitlements.planId).toBe('free');
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await ctx.c.post(`/api/v1/w/${ctx.wid}/forms`, { templateId: 'wedding-classic' })).json.id);
    const fourth = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms`, {});
    expect(fourth.status).toBe(402);
    expect(fourth.json.error.code).toBe('limit_reached');
    const logic = await ctx.c.post(`/api/v1/w/${ctx.wid}/forms/${ids[0]}/publish`);
    expect(logic.status).toBe(402);
    expect(logic.json.error.details.feature).toBe('conditionalLogic');
    expect((await ctx.c.get(`/api/v1/w/${ctx.wid}/guests`)).status).toBe(402);
  });

  it('applies role permissions to invited members', async () => {
    const owner = await signup('Owner');
    expect((await owner.c.post(`/api/v1/w/${owner.wid}/members/invite`, { email: 'v@example.com', role: 'viewer' })).status).toBe(402);
    sql(`UPDATE subscriptions SET plan_id = 'business', trial_plan_id = NULL WHERE workspace_id = '${owner.wid}'`);
    const viewer = await signup('Viewer');
    const inv = await owner.c.post(`/api/v1/w/${owner.wid}/members/invite`, { email: viewer.email, role: 'viewer' });
    expect(inv.status).toBe(201);
    const token = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', `SELECT token FROM invitations_to_workspace WHERE id = '${inv.json.id}'`], { cwd: new URL('..', import.meta.url).pathname }).toString();
    const t = JSON.parse(token)[0].results[0].token;
    expect((await viewer.c.post(`/api/v1/auth/workspace-invitations/${t}/accept`)).status).toBe(200);
    expect((await viewer.c.get(`/api/v1/w/${owner.wid}/forms`)).status).toBe(200);
    expect((await viewer.c.post(`/api/v1/w/${owner.wid}/forms`, {})).status).toBe(403);
    expect((await viewer.c.get(`/api/v1/w/${owner.wid}/audit-logs`)).status).toBe(403);
    expect((await owner.c.get(`/api/v1/w/${owner.wid}/audit-logs`)).json.items.some((a: any) => a.action === 'member.invited')).toBe(true);
  });

  it('exports and deletes an account', async () => {
    const ctx = await signup();
    const exp = await ctx.c.get('/api/v1/auth/me/export');
    expect(exp.json.workspaces).toHaveLength(1);
    expect((await ctx.c.del('/api/v1/auth/me', { password: 'wrong' })).status).toBe(401);
    expect((await ctx.c.del('/api/v1/auth/me', { password: 'correct-horse-1' })).status).toBe(200);
    expect((await ctx.c.get('/api/v1/auth/me')).status).toBe(401);
    expect((await ctx.c.post('/api/v1/auth/login', { email: ctx.email, password: 'correct-horse-1' })).status).toBe(401);
  });
});
