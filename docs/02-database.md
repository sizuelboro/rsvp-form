# 02 — Database design (Cloudflare D1)

Migrations live in `apps/api/migrations` and are applied with `wrangler d1 migrations apply` (tracked in D1's `d1_migrations` table, so they are reproducible).

| Migration | Contents |
|---|---|
| `0001_init.sql` | All tables, indexes, constraints and the immutability trigger |
| `0002_seed_plans.sql` | Subscription plans — **generated** from `packages/core/src/plans.ts` by `apps/api/scripts/gen-plan-seed.mjs` (idempotent upsert) |

## Conventions

- **Primary keys** are random, prefixed, non-sequential IDs (`frm_k3j9…`, `evt_…`, `gst_…`), safe to expose. Public URLs use slugs; invitations and QR codes use separate 144-bit tokens.
- **Timestamps** are ISO-8601 UTC strings (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`). Event-local time zones are stored separately in `events.timezone`; the UI converts wall-clock input to UTC with the event's zone.
- **Multi-tenancy**: every tenant-owned row has `workspace_id`; every workspace query filters by the membership-verified workspace from the URL.
- **Soft delete** (`deleted_at`) for users, workspaces, forms, events, guests, groups, households, sessions of events, templates and submissions. Deleted forms/events release their slug (`slug || '--deleted-' || id`).

## Tables

### Identity & workspace
| Table | Purpose | Notable constraints |
|---|---|---|
| `users` | Accounts (PBKDF2 password hash) | unique active email (partial index) |
| `sessions` | Server-side sessions; `id` = SHA-256 of the cookie token | FK users, cascade |
| `workspaces` | Tenants; `branding` JSON | unique slug |
| `workspace_members` | Membership + role (`owner/admin/editor/viewer`) | PK (workspace, user), CHECK role |
| `invitations_to_workspace` | Team invites with expiring token | unique token |

### Forms
| Table | Purpose | Notable constraints |
|---|---|---|
| `forms` | Draft schema (JSON), `draft_revision` (optimistic concurrency), access (`public/password/invite_only`), deadline + late policy, `published_version_id` | unique slug |
| `form_versions` | Immutable published snapshots (`schema`, `schema_version`, `version`) | unique (form, version); **trigger aborts UPDATE** |
| `templates` | Workspace-saved templates (system templates live in code) | |
| `themes` | Workspace-saved themes (preset + overrides) | |

### Events & guests
| Table | Purpose | Notable constraints |
|---|---|---|
| `events` | Event details, `timezone`, capacity, RSVP deadline, status (`draft/published/active/completed/cancelled`) | unique slug |
| `event_sessions` | Sessions with own time/venue/capacity, optional `form_id`, `option_id` mapping to an event-selection option | |
| `event_forms` | Many-to-many forms ↔ events with `is_primary` | PK (event, form) |
| `guests` | Reusable guest directory; `email_normalized`, `phone_normalized`, `attributes` JSON | **unique (workspace, email_normalized) where active** — dedupe |
| `guest_groups`, `households` | Grouping | unique name per workspace (active) |
| `event_guests` | Guest ↔ event with `rsvp_status`, party size (adults/children), meal, dietary, `latest_submission_id` | unique (event, guest) |
| `event_guest_sessions` | Per-session RSVP | PK (event_guest, session) |

### Invitations, submissions, attendance
| Table | Purpose | Notable constraints |
|---|---|---|
| `invitations` | One per event guest; delivery state (`draft/queued/sent/delivered/failed`), sent/delivered/opened/responded timestamps | unique event_guest |
| `invitation_tokens` | Random tokens, purpose `rsvp` or `checkin`, revocable | one active token per (invitation, purpose) |
| `submissions` | Response envelope: exact `form_version_id`, status (`complete/spam/reviewed/archived`), RSVP summary, `is_late`, `dedupe_key`, `duplicate_of`, `spam_score`, `data` JSON, `ip_hash` | unique (form, idempotency_key) |
| `answers` | Normalised answers (`value_text` = machine value for choices, `value_number`, `value_json`) | PK (submission, field); index (form, field, value) |
| `submission_events` | Response history (created, edited by respondent/organizer, status changes, deleted) | |
| `form_visits` | Funnel: views → started → completed, device | |
| `uploads` | R2 objects attached (or not yet) to submissions | unique key |
| `checkins` | Actual attendance; method (`qr/manual`), override flag, attendee count, undo | **unique active (event_guest, session)** — prevents duplicate check-in |

### Infrastructure
| Table | Purpose |
|---|---|
| `notification_jobs` | Email/webhook jobs with status, attempts, last error, provider message id, idempotency key |
| `email_templates` | Per-workspace overrides of default templates |
| `email_suppressions` | Unsubscribes (honoured for invitations/reminders/updates) |
| `integrations` | Webhooks (URL, events, signing secret) |
| `subscription_plans` | Plan limits/features (data, not code) |
| `subscriptions` | Workspace plan, trial plan + end, provider ids, status |
| `custom_domains` | Hostname + DNS TXT verification token/status |
| `audit_logs` | Security-relevant actions |
| `rate_limits` | Fixed-window counters |

## Requirements mapping

| Requirement | Implementation |
|---|---|
| Multi-tenant isolation | `workspace_id` on every row + membership middleware + 404 for non-members |
| Published versions immutable | `form_versions_immutable` trigger (verified by an e2e test that attempts an UPDATE) |
| Drafts don’t change history | Drafts live on `forms`; submissions reference `form_versions` |
| Submissions reference exact version | `submissions.form_version_id NOT NULL` |
| Guests reusable across events | `guests` ↔ `event_guests` |
| Versioned schemas | `form_versions.schema_version` + `migrateSchema()` on read |
| Tracked migrations | Wrangler D1 migrations |
| UTC + event time zone | ISO UTC columns + `events.timezone` |
