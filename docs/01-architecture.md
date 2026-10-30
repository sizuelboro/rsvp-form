# 01 — Product & system architecture

## Product requirements (summary)

**Positioning:** create beautiful forms, invite people, collect responses and manage every event from one platform.

**Primary journeys**

1. *First-time user:* sign up → choose a template → customise visually → add questions → configure logic → preview → publish → share → receive submissions → manage guests → view analytics.
2. *Professional organiser:* create an event → import guests → assign RSVP forms → generate invitations → track responses → send reminders → view attendance → scan QR codes → export reports.

Both journeys are covered end-to-end by the automated browser test (`e2e/ui_journey.py`).

**Non-goals for this release** (documented as known limitations): collecting card payments inside the form (payment fields record a pending intent), drag-to-resize free-form layouts, collaborative real-time co-editing (conflicts are detected and resolved instead).

## System architecture

```
                 ┌──────────────── Cloudflare Worker (apps/api) ─────────────────┐
 Browser         │                                                               │
 ─────────       │  /api/v1/public/*   public router  (rate-limited, no cookies) │
 index.html ───► │  /api/v1/auth/*     auth router    (CSRF header)              │──► D1 (relational data)
 (dashboard,     │  /api/v1/w/:wid/*   workspace router (session + membership    │──► R2 (uploads)
  editor)        │                     + role permission per route)              │──► Queue ─► consumer ─► Resend / webhooks
                 │  /f/* /e/* /i/*     public.html + injected SEO meta tags  │──► Cache API (published schemas)
 public.html ──► │  everything else    static assets (SPA fallback)              │
 (renderer)      │  cron               cleanup (sessions, rate limits, orphans)  │──► Sentry (errors only)
                 └───────────────────────────────────────────────────────────────┘
                              ▲                    ▲
                     packages/core (schema, logic, validation, themes, templates, plans)
                              ▲
                     packages/renderer (React runtime used by public.html and the editor)
```

### Layers

| Layer | Where |
|---|---|
| Application frontend | `apps/web/src` (dashboard + editor), `apps/web/src/public` (public renderer entry) |
| API layer | `apps/api/src/index.ts` (routing, middleware, errors), `lib/http.ts` (validation, pagination) |
| Authentication & authorization | `lib/auth.ts` (sessions, CSRF, membership, role permissions) |
| Business logic | `apps/api/src/modules/*`, `apps/api/src/services/rsvp.ts`, `packages/core` |
| Database access | `lib/db.ts` helpers; parameterised SQL only; migrations in `apps/api/migrations` |
| Background jobs | `modules/notifications.ts` (`enqueueEmail`, `enqueueWebhooks`, `handleQueue`), cron in `index.ts` |
| Storage | R2 via `modules/public.ts` (upload) and `modules/submissions.ts` (authorised download) |
| Analytics | `modules/analytics.ts` — computed from `submissions`, `answers`, `form_visits`, `event_guests`, `checkins` |

### Backend modules

`auth` · `workspaces` (members, domains, audit, activity, feedback) · `forms` (+ versions, publish, templates) · `public` (renderer API, uploads, submissions, invitations, QR) · `events` (sessions, event forms, event guests, invitations, broadcasts, reports) · `guests` (directory, groups, households, CSV) · `submissions` · `checkins` · `analytics` · `notifications` (queue, templates, unsubscribe, Resend webhooks) · `templates` · `billing` (+ Stripe/Razorpay webhooks) · `integrations` (webhooks) · `search`. Shared RSVP logic lives in `services/rsvp.ts`.

## Key architectural decisions

**ADR-1 · One schema, three consumers.** `packages/core` defines the schema (Zod), field registry, logic engine and validation. The editor, the public renderer and the Worker import the same code, so a rule that hides a field in the preview also hides it on the live form *and* causes the server to drop that answer. The server never trusts client validation.

**ADR-2 · Editor and renderer are separate execution environments.** The public page is a separate Vite entry (`public.html`) that loads only React, `@rsvp/core` and `@rsvp/renderer` (~97 KB gzipped) — none of the dashboard/editor code. The editor *reuses renderer components* on its canvas (in an inert "design" mode) for true WYSIWYG, but the renderer has no knowledge of the editor.

**ADR-3 · Drafts are mutable, versions are immutable.** `forms.draft_schema` is autosaved with optimistic concurrency (`draft_revision`). Publishing copies the draft into `form_versions`; a SQLite trigger aborts any `UPDATE` on that table. Submissions store `form_version_id` and are always rendered/edited/exported against their own version.

**ADR-4 · JSON for shape, rows for queries.** The form schema and raw answers are JSON. Anything that needs filtering or reporting is normalised: `answers` (one row per field, machine values for choice fields), `event_guests` (RSVP status, party size, meal), `checkins`, `form_visits`.

**ADR-5 · RSVP status ≠ invitation status ≠ attendance.** Three independent fields/tables: `invitations.status` (draft → queued → sent → delivered / failed), `event_guests.rsvp_status` (pending / accepted / declined / maybe), and `checkins` (actual attendance). Analytics never infers attendance from RSVPs.

**ADR-6 · Entitlements are data.** Plan limits/features live in `subscription_plans` (seeded from `packages/core/src/plans.ts`). Every check goes through `lib/entitlements.ts`; there are no `if (plan === 'pro')` checks elsewhere.

**ADR-7 · Nothing is sent without confirmation.** Invitation, reminder and broadcast endpoints require `confirm: true` in the request body and the UI requires a checkbox. The cron job does maintenance only.

## Frontend component architecture

```
main.tsx ─ RouterProvider (route-level code splitting)
├─ AppShell (sidebar, workspace switcher, ⌘K search, activity, Create menu, mobile drawer)
│  ├─ Overview · FormsList · EventsList · EventDetail (tabs) · Responses (+ drawer) · Guests (+ drawer)
│  └─ Templates (live thumbnails) · Analytics · Integrations · Settings (8 tabs) · Help
├─ Editor (full screen)
│  ├─ store.ts (Zustand: schema, selection, history, save state)   autosave.ts (debounce/retry/conflict)
│  ├─ ElementsPanel ─ Canvas (renderer FieldView + InlineText + dnd-kit) ─ Inspector / ThemePanel / FormSettingsPanel
│  └─ LogicBuilder · Preview · PublishDialog · AccessDialog · VersionsDialog
└─ CheckIn (mobile) · CheckinRedirect (/c/:token)

components/ui: Button, Input, Textarea, Select, Switch, Checkbox, Field, Badge, Avatar, Kbd, Skeleton, Spinner,
               Dialog, ConfirmDialog, Drawer, Menu, Tooltip, Popover, Tabs, Segmented, Table, Pagination,
               EmptyState, ErrorState, Stat, PageHeader, SearchInput, Toaster
components/charts: LineChart, BarList, Donut
```

Editor performance: canvas elements are `memo`ised and subscribe to narrow store slices; changing one field's label re-renders that element and the inspector, not the whole canvas.

## Route structure

| Route | Page |
|---|---|
| `/login`, `/signup`, `/join/:token` | Auth |
| `/` | Overview |
| `/forms`, `/forms/:id/edit` | Forms list, editor |
| `/events`, `/events/:id`, `/events/:id/checkin`, `/c/:token` | Events, detail, check-in, scanned-pass redirect |
| `/responses`, `/responses/:id` | Response manager |
| `/guests` | Guest directory |
| `/templates`, `/analytics`, `/integrations`, `/settings/:tab`, `/help` | |
| `/f/:slug`, `/e/:slug`, `/i/:token` | Public renderer (public.html) |

## Milestones delivered

| # | Milestone | Verified by |
|---|---|---|
| M0 | Audit & architecture | this document set |
| M1 | Shared core (schema, registry, logic, validation, themes, templates, plans, migration) | 27 unit tests |
| M2 | Worker API, D1 schema, auth, workspaces, forms, versions, publishing, submissions | API e2e |
| M3 | Events, guests, invitations, check-in, analytics, notifications, billing, integrations | API e2e (29 tests total) |
| M4 | Design system & dashboard | browser journey + screenshots |
| M5 | Visual editor | browser journey |
| M6 | Public renderer (3 modes) | 8 renderer tests + browser journey |
| M7 | Hardening, monitoring, docs, deployment config | typecheck, build, all suites green |

## Technical risks & mitigations

| Risk | Mitigation |
|---|---|
| D1 write throughput on viral public forms | Per-IP and per-form rate limits; Cache API for schema reads; consider Durable Object counters or the Rate Limiting binding at scale |
| D1-based rate limiting adds a write per request | Acceptable at launch; swap to the Workers Rate Limiting binding without changing call sites (`lib/ratelimit.ts`) |
| Long-running imports (5,000 rows) within Worker CPU limits | Row cap of 5,000 per request; batch per row; move to a queue job if larger imports are needed |
| Email deliverability | Resend with verified domain; delivery webhooks update `delivered`/`failed`; unsubscribe + suppression list |
| Schema evolution | `schemaVersion` + `migrateSchema()` applied on read; stored versions never rewritten |
| Conflicting edits | Optimistic concurrency with an explicit conflict banner instead of silent last-write-wins |
