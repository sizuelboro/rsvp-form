# 03 — API reference (v1)

Base path: `/api/v1`. JSON in and out. Errors use one shape:

```json
{ "error": { "code": "validation_failed", "message": "Some fields are invalid", "details": [...] } }
```

Common codes: `validation_failed` (422), `unauthenticated` (401), `forbidden`/`csrf` (403), `not_found` (404), `conflict` (409), `upgrade_required` / `limit_reached` (402), `rate_limited` (429, with `Retry-After`), `form_closed` (410), `needs_override` (423).

**Authenticated requests** need the `inv_session` cookie (HttpOnly, SameSite=Lax) **and** `X-Requested-With: invitely` on non-GET requests. Workspace endpoints are scoped by URL: `/api/v1/w/:wid/...`; non-members receive 404.

Pagination: list endpoints take `page` & `pageSize` (tables) or `cursor` & `limit` (forms). Every response carries `x-request-id`.

## Public endpoints (`/api/v1/public`) — no auth, rate-limited

| Method & path | Purpose |
|---|---|
| `GET /forms/:slug` | Published schema + event info, or `{locked: 'password' \| 'invite_only'}`. Cached 60 s (Cache API) and purged on publish/settings change. Header `X-Form-Access` for unlocked password forms |
| `POST /forms/:slug/unlock` `{password}` | Returns a 6-hour signed `accessToken` |
| `POST /forms/:slug/visits` `{device}` · `POST /visits/:id/start` | Funnel analytics |
| `POST /forms/:slug/uploads` (multipart `fieldId`, `file`) | Upload to R2 after size + magic-byte verification |
| `POST /forms/:slug/submissions` | Submit. Body: `answers`, optional `invitationToken`, `accessToken`, `visitId`, `idempotencyKey`, `query`, `startedAt`, `device`, honeypot `website_url`. Server re-validates against the published version, enforces access/deadline/capacity/plan limits, dedupes, scores spam, applies RSVP, queues confirmation + organizer emails and webhooks. Returns `{submissionId, confirmation, event, checkinToken}` |
| `GET /events/:slug` | Public event page data (no capacity numbers or guest data) |
| `GET /invitations/:token` | Personal invitation: guest name/email, event, form, previous answers, check-in token if accepted. Marks the invitation opened |
| `GET /qr/:token` | SVG QR code for a check-in token |
| `GET /unsubscribe?w&e&s` | HMAC-signed unsubscribe link |
| `POST /webhooks/resend` | Svix-verified delivery events (`RESEND_WEBHOOK_SECRET`) |

Billing webhooks: `POST /billing/webhooks/stripe` (Stripe-Signature) and `POST /billing/webhooks/razorpay` (X-Razorpay-Signature).

## Auth (`/api/v1/auth`)

`POST /signup` · `POST /login` · `POST /logout` · `GET /session` (200 with `user: null` when signed out) · `GET /me` · `PATCH /me` (name, password) · `GET /me/export` · `DELETE /me` `{password}` · `POST /workspace-invitations/:token/accept` · `POST /workspaces` (create workspace)

## Workspace (`/api/v1/w/:wid`)

| Area | Endpoints |
|---|---|
| Workspace | `GET /` (details, role, entitlements, usage) · `PATCH /` · `DELETE /` · `GET /activity` · `GET /audit-logs` · `POST /feedback` · `GET /search?q=` |
| Members | `GET /members` · `POST /members/invite` · `PATCH /members/:userId` · `DELETE /members/:userId` |
| Domains | `GET /domains` · `POST /domains` · `POST /domains/:id/verify` · `DELETE /domains/:id` |
| Forms | `GET /forms` · `POST /forms` `{name?, templateId?, kind?, schema?, eventId?}` · `GET /forms/:id` · `PATCH /forms/:id` (autosave `{schema, baseRevision}` → 409 on conflict; settings: name, slug, access, password, closesAt, latePolicy, closedMessage, status) · `POST /forms/:id/publish` · `GET /forms/:id/versions` · `GET /forms/:id/versions/:vid` · `POST /forms/:id/versions/:vid/restore` · `POST /forms/:id/duplicate` · `POST /forms/:id/save-as-template` · `DELETE /forms/:id` |
| Templates | `GET /templates` (system + workspace) · `DELETE /templates/:id` |
| Events | `GET /events` · `POST /events` · `GET /events/:id` · `PATCH /events/:id` · `DELETE /events/:id` |
| Sessions | `POST /events/:id/sessions` · `PATCH /events/:id/sessions/:sid` · `DELETE /events/:id/sessions/:sid` |
| Event forms | `POST /events/:id/forms` `{formId, isPrimary?}` · `DELETE /events/:id/forms/:formId` |
| Event guests | `GET /events/:id/guests` (search, rsvp, invitation, checkedIn, groupId, sort, page) · `POST /events/:id/guests` `{guestIds?, guests?}` · `PATCH /events/:id/guests/:egId` (organizer override) · `POST /events/:id/guests/remove` · `GET/PUT /events/:id/guests/:egId/sessions[/:sid]` |
| Invitations | `POST /events/:id/invitations/prepare` (creates links, returns preview counts — sends nothing) · `POST /events/:id/invitations/send` `{eventGuestIds, kind, confirm: true}` · `POST /events/:id/broadcast` `{kind: event_update \| cancellation, message, confirm: true}` · `GET /events/:id/export` (CSV) |
| Guests | `GET /guests` · `POST /guests` · `GET/PATCH/DELETE /guests/:id` · `POST /guests/bulk` · `POST /guests/import` `{csv, eventId?, dryRun?}` · `GET /guests/export/csv` · `GET/POST/DELETE /guests/meta/groups[/:id]` · `…/meta/households` |
| Submissions | `GET /submissions` (formId, eventId, status, rsvp, search, from, to, duplicates, page) · `GET/PATCH/DELETE /submissions/:id` · `POST /submissions/bulk` · `GET /submissions/:id/files?key=` · `GET /submissions/export/csv?formId=` |
| Check-in | `POST /checkins/lookup` `{code}` · `POST /checkins` `{code \| eventGuestId, sessionId?, override?}` · `DELETE /checkins/:id` · `GET /checkins/events/:eventId` |
| Analytics | `GET /analytics/overview` · `GET /analytics/workspace` · `GET /analytics/forms/:id` · `GET /analytics/events/:id` · `GET /analytics/events/:id/export` (all accept `from`/`to`) |
| Notifications | `GET /notifications/jobs` · `POST /notifications/jobs/:id/retry` · `POST /notifications/jobs/retry-failed` · `GET /notifications/email-templates` · `PUT/DELETE /notifications/email-templates/:type` · `POST /notifications/email-templates/:type/preview` |
| Billing | `GET /billing/plans` · `GET /billing/subscription` · `POST /billing/checkout` `{planId, provider}` |
| Integrations | `GET /integrations` · `POST /integrations/webhooks` · `PATCH /integrations/webhooks/:id` · `POST /integrations/webhooks/:id/test` · `DELETE /integrations/:id` |

## Permissions

| Permission | owner | admin | editor | viewer |
|---|:-:|:-:|:-:|:-:|
| Read content, responses, analytics | ✓ | ✓ | ✓ | ✓ |
| Create/edit forms, events, guests; delete responses; check in | ✓ | ✓ | ✓ | |
| Send invitations & broadcasts | ✓ | ✓ | ✓ | |
| Workspace settings, members, domains, integrations, audit log | ✓ | ✓ | | |
| Billing, delete workspace | ✓ | | | |

## Webhook payload

```http
POST <your url>
X-Invitely-Event: submission.created
X-Invitely-Timestamp: 1793334000
X-Invitely-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>

{"event":"submission.created","data":{"formId":"frm_…","formSlug":"…","submissionId":"sub_…","answers":{…},"rsvpStatus":"accepted","createdAt":"…"},"sentAt":"…"}
```
