# Invitely — Universal Form & RSVP Creator

Create beautiful forms, invite people, collect responses, and manage every event from one platform.

Invitely combines a visual form studio, a conversational/multi-step public renderer, an RSVP engine,
guest management, invitations, QR check-in and analytics — built on Cloudflare Workers, D1, R2 and Queues.

| | |
|---|---|
| **Form Studio** | Three-panel visual editor: 37 element types, drag-and-drop, inline editing, properties inspector, 10 theme presets + design tokens, visual logic builder, undo/redo, autosave with conflict protection, desktop/mobile canvas, preview, versioned publishing |
| **Public renderer** | Standard, multi-step and conversational (one-question-at-a-time) modes from one schema; accessible, mobile-first, ~97 KB gzipped, server-validated |
| **Events** | Events with sessions, capacity, RSVP deadlines and statuses; multiple forms per event; event pages at `/e/:slug` |
| **Guests** | Reusable guest directory, groups, households, custom attributes, CSV import (dedupe + dry-run preview) and export, bulk actions |
| **Invitations** | Personal links `/i/:token`, QR codes, email invitations/reminders/updates via queue — always behind explicit confirmation |
| **Check-in** | Mobile QR scanner (BarcodeDetector / jsQR), manual search, duplicate prevention, organizer overrides, undo, per-session check-in |
| **Responses** | Filters, history, duplicate & spam detection, organizer edits validated against the original version, CSV export, file downloads |
| **Analytics** | Funnel (views → starts → completions), devices, timelines, answer breakdowns, RSVP vs. **actual** attendance, meal & party-size stats, CSV export |
| **SaaS** | Workspaces, roles (owner/admin/editor/viewer), plan entitlements enforced server-side from D1, Stripe/Razorpay foundations, custom-domain verification, webhooks, audit log, data export & account deletion |

## Repository layout

```
packages/core       Shared, framework-free TypeScript: form schema (zod), field registry, logic engine,
                    validation, themes/design tokens, 20 templates, plan definitions, schema migrations
packages/renderer   React form runtime (public renderer + editor preview/canvas). Plain CSS, no Tailwind
apps/api            Cloudflare Worker (Hono): modules, D1 migrations, queue consumer, cron
apps/web            Vite app with two independent entries:
                      index.html  → dashboard + visual editor
                      public.html → lightweight public renderer for /f, /e, /i
e2e/                Playwright browser journey
docs/               Audit, architecture, database, API, schema spec, security, deployment
```

## Quick start (local)

Requirements: Node 20+.

```bash
npm install
npm run build                                  # builds apps/web/dist (served by the Worker)
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run db:migrate:local                       # applies D1 migrations to the local database
npm run dev:api                                # Worker + local D1/R2/Queues on http://127.0.0.1:8787
```

Open http://127.0.0.1:8787 and sign up. New workspaces get a 14-day Pro trial (configurable via `TRIAL_PLAN` / `TRIAL_DAYS`).

For hot-reloading frontend work run `npm run dev:web` in a second terminal (Vite on :5173, proxies `/api` to the Worker).

In local dev `EMAIL_MODE=log` records emails in the Worker log and marks them delivered, so the full invitation pipeline (queue → consumer → status updates) runs without an email provider.

## Tests

```bash
npm test                     # core (27) + renderer (8) unit tests
npm run typecheck            # strict TypeScript across all packages
npm run test:api             # 29 end-to-end API tests against the running local Worker (npm run dev:api first)
python3 e2e/ui_journey.py    # 24-step browser journey (Playwright + Chromium) against the running Worker
```

See [docs/07-testing.md](docs/07-testing.md) for what each suite covers.

## Deployment

See [docs/06-deployment.md](docs/06-deployment.md): create the D1 database, R2 bucket and queues, set secrets, apply remote migrations and `npm run deploy`.

## Documentation

- [00 — Repository audit](docs/00-audit.md)
- [01 — Product & system architecture](docs/01-architecture.md)
- [02 — Database design](docs/02-database.md)
- [03 — API reference](docs/03-api.md)
- [04 — Form schema specification](docs/04-form-schema.md)
- [05 — Security](docs/05-security.md)
- [06 — Deployment](docs/06-deployment.md)
- [07 — Testing](docs/07-testing.md)
