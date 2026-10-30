# 04 — Form schema specification (schemaVersion 1)

Source of truth: `packages/core/src/schema.ts` (Zod). The same schema is validated in the editor, renderer and Worker.

```jsonc
{
  "schemaVersion": 1,
  "form": { "title": "Wedding RSVP", "description": "We would love to celebrate with you." },
  "settings": {
    "layout": "standard | multistep | conversational",
    "submitLabel": "Submit RSVP",
    "allowMultipleSubmissions": false,
    "showProgress": true,
    "coverImage": "https://…", "logoUrl": "https://…", "hideBranding": false,
    "confirmation": {
      "title": "Thank you, {{full_name}}!", "message": "…", "declineMessage": "…",
      "showEventDetails": true, "showQrCode": true, "redirectUrl": "https://…"
    }
  },
  "theme": { "presetId": "romantic", "overrides": { "colors": { "primary": "#B56576" } } },
  "pages": [
    { "id": "page_1", "title": "Your details", "elements": [
      { "id": "attendance", "type": "attendance", "label": "Will you attend?", "required": true,
        "config": { "allowMaybe": false, "acceptLabel": "Joyfully accept", "declineLabel": "Regretfully decline" } },
      { "id": "guest_count", "type": "guest_count", "label": "Number of guests", "required": true,
        "config": { "minGuests": 1, "maxGuests": 4, "splitAdultsChildren": true } }
    ] }
  ],
  "logic": [
    { "id": "if_accepting", "combinator": "or",
      "conditions": [{ "fieldId": "attendance", "operator": "equals", "value": "accept" }],
      "actions": [{ "type": "show", "target": "guest_count" }] }
  ]
}
```

## Identifiers

`id`s for pages, elements, options and rules match `^[a-z][a-z0-9_]*$` (≤ 64 chars). They are **stable**: generated once (`short_text_3`, slugged option labels) and never derived from labels afterwards. Renaming a field ID in the inspector rewrites logic references; existing responses keep their original keys and continue to render via their own version.

## Elements

Each element: `id`, `type`, `label`, optional `description`, `placeholder`, `required`, `defaultValue`, `config` (type-specific, strict), `style` (per-element overrides: align, size, width full/half, fontSize, fontWeight, background, borderColor, radius, paddingY).

| Category | Types |
|---|---|
| Basic | `short_text` `long_text` `email` `phone` `number` `website` `date` `time` |
| Choice | `single_choice` `multiple_choice` `dropdown` `yes_no` `rating` `image_choice` |
| RSVP | `attendance` `guest_count` `guest_names` `plus_one` `meal_preference` `dietary` `accommodation` `transportation` `event_selection` `rsvp_deadline_info` |
| Advanced | `file_upload` `signature` `address` `country` `payment` `hidden` |
| Content | `heading` `paragraph` `image` `video` `divider` `spacer` `section` `rich_text` |

The **field registry** (`fields.ts`) defines, per type: category, name, description, icon, whether it collects input, its value kind, which inspector sections apply (the editor shows nothing else), sensible defaults and which logic operators make sense.

### Answer value shapes

| Value kind | Types | Shape |
|---|---|---|
| string | text types, single choice/dropdown/meal/accommodation/transportation (option id or custom “Other” text), `yes_no` (`yes`/`no`), `attendance` (`accept`/`decline`/`maybe`), `country` (ISO-2), `signature` (PNG data URL ≤ 300 KB), `hidden` | `"…"` |
| number | `number`, `rating` | `4` |
| string_list | `multiple_choice`, `image_choice`, `event_selection`, `guest_names` | `["a","b"]` |
| guest_count | `guest_count` | `{ "adults": 2, "children": 1 }` |
| plus_one | `plus_one` | `{ "bringing": true, "name": "Sam" }` |
| dietary | `dietary` | `{ "restrictions": ["nut_allergy"], "notes": "…" }` |
| address | `address` | `{ "line1", "line2", "city", "state", "postalCode", "country" }` |
| files | `file_upload` | `[{ "key": "uploads/<form>/<rand>/<name>", "name", "size", "type" }]` |
| payment | `payment` | server-set `{ "status": "pending", "amount", "currency" }` — never client-controlled |

## Logic

Rules: `combinator` (`and`/`or`), `conditions[]` (`fieldId`, `operator`, `value`), `actions[]`.

Operators: `equals`, `not_equals`, `contains`, `not_contains`, `greater_than`, `less_than`, `is_empty`, `is_not_empty`. Structured values are compared through a comparable projection (guest count → total, plus-one → yes/no, dietary → list).

Actions: `show`, `hide`, `require`, `unrequire`, `goto_page` (`target` page, optional `fromPage`), `skip_page`, `show_message`.

Semantics (implemented once in `logic.ts`):
- A field targeted by any `show` action is hidden until one of those rules matches. `hide` wins when matched.
- Visibility is resolved to a **fixed point**: an answer on a hidden field is treated as empty, so chained rules collapse correctly.
- The **page path** is computed from the first page following `goto_page` (forward only), `skip_page`, and pages with no visible content. Fields on pages outside the path are hidden, not validated and not stored.
- No user-provided JavaScript is ever executed.

## Validation

`validateAnswers(schema, answers, {pages?, query?})` returns `{ok, errors, cleaned, state}`. It validates only visible inputs, enforces required (including logic-driven), type rules (email, phone 7–15 digits, URL, ISO date, HH:MM time, ranges, steps, option membership, selection counts, guest min/max, upload key namespace and size) and returns sanitised `cleaned` answers with hidden/unknown keys removed. The Worker stores only `cleaned`.

## Versioning & compatibility

- `schemaVersion` is a literal; `migrateSchema()` upgrades older documents step by step on read (v0 — the flat `fields` array from the original brief — is migrated to pages). Documents newer than the running code are rejected rather than misrendered.
- Published versions are stored as-is forever; migration happens in memory.
- `checkIntegrity()` (duplicate IDs, dangling logic references, min > max, empty messages) runs on publish; autosave accepts shape-valid drafts and returns integrity issues as warnings.

## Themes

`theme = { presetId, overrides }`. Ten presets (Minimal, Modern, Elegant, Luxury, Editorial, Corporate, Playful, Colorful, Classic, Romantic) are full token sets (typography, colors, layout, appearance). `resolveTheme()` merges preset ← overrides; switching preset keeps overrides; element `style` overrides are applied after the theme and survive theme changes. Tokens become CSS custom properties (`themeToCssVars`) consumed by `renderer.css`.
