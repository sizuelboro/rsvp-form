# 05 — Security

| Concern | Implementation |
|---|---|
| Authentication | Email + password; PBKDF2-SHA256 (100k iterations, per-user salt, constant-time compare). Sessions are random 256-bit tokens in an HttpOnly, SameSite=Lax, Secure (on https) cookie; only the SHA-256 of the token is stored. Password change revokes other sessions. Login does a dummy hash for unknown emails to equalise timing |
| Authorization | Workspace routes resolve membership from the URL (`/w/:wid`) on every request; non-members get 404 (no ID probing). Role permissions per route (`lib/auth.ts`). Every query filters by the verified workspace ID |
| CSRF | SameSite=Lax cookie **plus** a required `X-Requested-With: invitely` header on state-changing authenticated requests (cross-site forms cannot set it) |
| Input validation | Zod on every body/query; body size limits; shared form validation on the server; unknown answer keys dropped |
| SQL injection | Parameterised statements only; LIKE input escaped; dynamic `SET` clauses built from whitelisted column maps |
| XSS | React escaping; rich text rendered through a tiny Markdown subset into React elements (no `innerHTML`, only http/https/mailto links); email templates HTML-escape variables; email previews in a sandboxed iframe; video embeds limited to YouTube/Vimeo URLs |
| CSV injection | Exports prefix cells starting with `= + - @` |
| Rate limiting & abuse | Per-IP fixed windows on signup, login, unlock, public reads, visits, uploads and submissions, plus a per-form/per-IP submission limit |
| Spam | Honeypot field, minimum fill time, link density and keyword scoring; spam is stored with status `spam` and answered with a normal-looking success (no signal to bots) |
| Duplicates & idempotency | Client idempotency key (unique per form); invite-linked resubmissions edit in place; email-based duplicates are flagged |
| Tokens | Invitation (`rsvp`) and `checkin` tokens are separate 144-bit random values; QR codes encode a check-in URL, never database IDs; tokens are revocable |
| Uploads | Field-scoped, size-limited (≤ 25 MB, per-field max), content type verified by **magic bytes** (PNG/JPEG/GIF/WebP/PDF), sanitised names, random keys, served only to workspace members with `Content-Disposition: attachment` and `nosniff`; orphan cleanup |
| Public data exposure | Public endpoints return only published schema, public event fields (no capacity, no guest data) and the invitee’s own name/email for their token. `/i/` pages are `noindex` |
| Password-protected forms | Password hashed; unlock returns a 6-hour HMAC-signed access token bound to the form |
| Payments | Client cannot set payment state; the server records `pending` from the schema |
| Webhooks | Outgoing: HTTPS only, HMAC-signed with a per-integration secret shown once. Incoming (Stripe, Razorpay, Resend/Svix): signature + timestamp verified, timing-safe |
| Secrets | Only via Wrangler secrets / `.dev.vars` (git-ignored): `IP_HASH_SALT`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `STRIPE_*`, `RAZORPAY_*`, `SENTRY_DSN` |
| Privacy | IPs stored only as salted hashes; account export (JSON) and deletion (soft-delete + anonymise user, revoke sessions, delete owned workspaces); unsubscribe with HMAC-signed links |
| Audit | `audit_logs` records sign-ups, publishes, settings, member/role changes, exports, deletions, check-ins and overrides |
| Monitoring | Structured JSON request/error logs (Workers observability) + optional Sentry (error metadata only) |

## Production checklist

- Set a long random `IP_HASH_SALT` (also signs access tokens and unsubscribe links).
- Keep `RATE_LIMIT_SCALE` unset (1) in production.
- Verify the Resend sending domain and configure the Resend webhook secret.
- Configure Stripe/Razorpay webhook secrets before enabling checkout.
