# 00 — Repository audit

_Date: 30 Oct 2026 · Stage 1 of the development workflow._

## Findings

| Area | Existing state |
|---|---|
| Framework | None — the repository had **no commits and no branches** |
| Dependencies | None (`package.json` absent) |
| Folder structure | Empty |
| UI components | None |
| Routing | None |
| Authentication | None |
| Database configuration | None |
| Cloudflare configuration | None (`wrangler.toml` absent) |
| APIs | None |
| Deployment setup | None |

**Conclusion:** greenfield. There is no working functionality to preserve, so the recommended stack from
the product brief is adopted as-is. A `main` branch was initialised with a README so work could be
delivered as a reviewable pull request.

## Environment available to the build

Node 22, npm 10, Wrangler 4 (local D1/R2/Queues via Miniflare), Chromium + Playwright for UI verification.

## What can be reused vs. built

Everything is built new. To avoid "rewriting later", the architecture front-loads the pieces that are
expensive to change:

1. A **versioned, shared form schema** (`packages/core`) used by editor, renderer and server.
2. **Immutable form versions** enforced by a database trigger, so history can never be rewritten.
3. **Workspace-scoped routing** (`/api/v1/w/:wid/*`) so tenant isolation is structural, not per-query discipline alone.
4. **Plan limits in the database**, read through one entitlement module.

## Stack decisions

| Concern | Choice | Why |
|---|---|---|
| Frontend | React 18, TypeScript (strict), Vite, Tailwind v4, Radix primitives, Zustand, dnd-kit, Zod | As recommended; Radix only for dialog/menu/tooltip/popover (accessibility), no full component kit |
| Backend | Cloudflare Workers + Hono | Hono is ~14 KB, typed, and Workers-native; keeps routing modular across 15 modules |
| Data | D1 (relational), R2 (uploads), Queues (email/webhooks), Cache API (public schemas) | As recommended |
| QR | `uqr` (generate, tiny, isomorphic) and `jsqr` (scan fallback, lazy-loaded) | Native `BarcodeDetector` is used when available |
| Charts | Hand-written SVG | Avoids a ~100 KB chart dependency for three chart types |
| Email | Resend over `fetch` | No SDK needed |
| Payments | Stripe / Razorpay over `fetch` + webhook signature verification | No SDKs needed |
| Monitoring | Workers observability + Sentry envelope API | No SDK needed |
