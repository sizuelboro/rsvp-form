# 07 — Testing

| Suite | Command | What it proves |
|---|---|---|
| Core unit tests (27) | `npm test -w @rsvp/core` | All 20 templates and every field type validate; integrity checks; every logic operator; AND/OR; cascading visibility; goto/skip page paths; messages; validation of every value kind; hidden-field stripping; per-step validation; payment state can’t be forged; upload key namespace; RSVP derivation; theme override persistence across presets; legacy schema migration; future-version rejection |
| Renderer tests (8) | `npm test -w @rsvp/renderer` | Every template renders in all three layouts; logic shows/hides fields live; client validation blocks submit; server field errors map back to fields; multi-step validation + goto navigation + back; conversational auto-advance reveals follow-ups; confirmation with QR; Markdown never renders markup or `javascript:` links |
| API end-to-end (29) | `npm run dev:api` then `npm run test:api` | Real Worker + local D1/R2/Queues: auth, CSRF, **workspace isolation**, template creation, **autosave conflict (409)**, **immutable versions (DB trigger)**, live form unchanged by drafts, server validation, idempotency, duplicate flagging, silent spam quarantine, funnel analytics, deadlines + late policies, password protection, **upload magic-byte rejection**, CSV formula escaping, response history, CSV import dedupe (dry-run and re-import), **invitations require `confirm: true`**, queue delivery, invitation RSVP + edit-in-place, session RSVPs, meal labels, QR SVG, cross-form token rejection, **check-in duplicate prevention + override + undo**, cross-tenant check-in rejection, capacity, **server-side plan limits**, role permissions, account export/deletion |
| Browser journey (24 steps) | `python3 e2e/ui_journey.py` | Sign up → templates → editor (insert, inspector, autosave “Saved”, undo/redo, duplicate/delete, theme presets, logic builder, mobile + conversational preview, publish, reload persistence) → mobile public submission with validation → responses + drawer → create event → assign form → CSV import preview → publish event → send invitations behind confirmation → delivered status → guest RSVPs via personal link with prefill + QR → mobile check-in + override prompt → analytics → **no horizontal overflow on 9 mobile pages** → **no console errors** |
| Typecheck | `npm run typecheck` | Strict TypeScript (`noUncheckedIndexedAccess`) in all four packages |

Screenshots from the browser journey are written to `/tmp/shots`.

## Manual QA checklist

1. **Form editor** — create from a template; drag an element from the left panel between two fields; click a label on the canvas and type; toggle Required; ⌘Z / ⌘⇧Z; duplicate (⌘D) and delete (Del); switch Desktop/Mobile canvas; change theme preset then a color — switch presets again and confirm the color override persists; collapse a Section.
2. **Autosave & conflicts** — open the same form in two tabs, edit both; the second save shows the conflict banner with *Load their version / Keep my changes*. Go offline (DevTools) and edit: “Save failed” appears and retries automatically when back online.
3. **Logic** — in the Classic Wedding template preview, choose Accept/Decline and watch fields appear/disappear; in Multi-Event Wedding choose “Sorry, I can’t make it” and confirm it jumps to the last page.
4. **Publishing** — publish, edit the title, reload the public link: the old title stays until you publish again. Version history lists both versions.
5. **Public form** — on a phone, submit invalid data (see inline errors), then valid data; try a password-protected form; set a past deadline with each late policy.
6. **Event** — create an event with sessions; import a CSV with a duplicate email (preview shows it skipped); send invitations (button disabled until the confirmation box is ticked); open a guest’s link from the row menu, RSVP, reopen the link (shows status + QR, *Change my response*).
7. **Check-in** — open Check-in on a phone, scan the QR on another screen (or paste the code), scan again (duplicate warning), check in a declined guest (override prompt), undo.
8. **Analytics** — accepted vs. checked-in are shown separately; export the event report CSV.
9. **Permissions** — on the Business plan invite a Viewer; as the viewer, editing and sending are unavailable and API calls return 403.
