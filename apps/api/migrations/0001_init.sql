-- 0001_init.sql — initial schema for the Universal Form & RSVP platform.
-- Conventions:
--   * Primary keys are random prefixed ids (e.g. frm_xxx) — never sequential, safe to expose.
--   * Timestamps are ISO-8601 UTC strings. Event-local time zones are stored separately.
--   * Soft delete via deleted_at where records may be restored or are referenced historically.
--   * Every tenant-owned row carries workspace_id for isolation and indexed access.

PRAGMA foreign_keys = ON;

-- ───────────── Identity & workspace ─────────────
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX users_email_active ON users(email) WHERE deleted_at IS NULL;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- SHA-256 of the session token; raw token only lives in the cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  branding TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user ON workspace_members(user_id);

CREATE TABLE invitations_to_workspace (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX invitations_to_workspace_ws ON invitations_to_workspace(workspace_id);

-- ───────────── Forms ─────────────
CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  overrides TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE INDEX themes_ws ON themes(workspace_id);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  schema TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE INDEX templates_ws ON templates(workspace_id);

CREATE TABLE forms (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'form' CHECK (kind IN ('form','rsvp')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
  draft_schema TEXT NOT NULL,
  draft_revision INTEGER NOT NULL DEFAULT 1,
  published_version_id TEXT,
  access TEXT NOT NULL DEFAULT 'public' CHECK (access IN ('public','password','invite_only')),
  password_hash TEXT,
  closes_at TEXT,                         -- RSVP / submission deadline (UTC)
  late_policy TEXT NOT NULL DEFAULT 'block' CHECK (late_policy IN ('block','allow','flag')),
  closed_message TEXT,
  template_id TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX forms_slug ON forms(slug);
CREATE INDEX forms_ws ON forms(workspace_id, deleted_at, updated_at);

CREATE TABLE form_versions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  schema TEXT NOT NULL,
  published_by TEXT REFERENCES users(id),
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (form_id, version)
);
-- Published versions are immutable: historical submissions always reference the exact schema they answered.
CREATE TRIGGER form_versions_immutable BEFORE UPDATE ON form_versions
BEGIN
  SELECT RAISE(ABORT, 'form_versions are immutable');
END;

-- ───────────── Events ─────────────
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  venue_name TEXT,
  address TEXT,
  cover_image TEXT,
  capacity INTEGER,
  rsvp_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','active','completed','cancelled')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX events_slug ON events(slug);
CREATE INDEX events_ws ON events(workspace_id, deleted_at, starts_at);

CREATE TABLE event_sessions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  ends_at TEXT,
  venue_name TEXT,
  address TEXT,
  capacity INTEGER,
  form_id TEXT REFERENCES forms(id) ON DELETE SET NULL,   -- optional session-specific questions
  option_id TEXT,                                          -- maps an event_selection option to this session
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE INDEX event_sessions_event ON event_sessions(event_id, sort_order);

CREATE TABLE event_forms (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (event_id, form_id)
);
CREATE INDEX event_forms_form ON event_forms(form_id);

-- ───────────── Guests ─────────────
CREATE TABLE guest_groups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX guest_groups_name ON guest_groups(workspace_id, name) WHERE deleted_at IS NULL;

CREATE TABLE households (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX households_name ON households(workspace_id, name) WHERE deleted_at IS NULL;

CREATE TABLE guests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  email_normalized TEXT,
  phone TEXT,
  phone_normalized TEXT,
  group_id TEXT REFERENCES guest_groups(id) ON DELETE SET NULL,
  household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
  dietary TEXT,
  notes TEXT,
  attributes TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
-- Dedupe: one active guest per email per workspace (guests are reused across events).
CREATE UNIQUE INDEX guests_email ON guests(workspace_id, email_normalized) WHERE email_normalized IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX guests_ws ON guests(workspace_id, deleted_at, name);
CREATE INDEX guests_phone ON guests(workspace_id, phone_normalized);
CREATE INDEX guests_household ON guests(household_id);

CREATE TABLE event_guests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  rsvp_status TEXT NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending','accepted','declined','maybe')),
  rsvp_at TEXT,
  party_size INTEGER NOT NULL DEFAULT 0,
  adults INTEGER NOT NULL DEFAULT 0,
  children INTEGER NOT NULL DEFAULT 0,
  plus_ones_allowed INTEGER NOT NULL DEFAULT 0,
  meal TEXT,
  dietary TEXT,
  latest_submission_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (event_id, guest_id)
);
CREATE INDEX event_guests_event ON event_guests(event_id, rsvp_status);
CREATE INDEX event_guests_guest ON event_guests(guest_id);

CREATE TABLE event_guest_sessions (
  event_guest_id TEXT NOT NULL REFERENCES event_guests(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES event_sessions(id) ON DELETE CASCADE,
  rsvp_status TEXT NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending','accepted','declined','maybe')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (event_guest_id, session_id)
);
CREATE INDEX event_guest_sessions_session ON event_guest_sessions(session_id);

-- ───────────── Invitations ─────────────
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_guest_id TEXT NOT NULL UNIQUE REFERENCES event_guests(id) ON DELETE CASCADE,
  form_id TEXT REFERENCES forms(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sent','delivered','failed')),
  sent_at TEXT,
  delivered_at TEXT,
  opened_at TEXT,
  responded_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX invitations_event ON invitations(event_id, status);

CREATE TABLE invitation_tokens (
  token TEXT PRIMARY KEY,                 -- 128-bit random, URL-safe; never a database id
  invitation_id TEXT NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('rsvp','checkin')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT
);
CREATE UNIQUE INDEX invitation_tokens_active ON invitation_tokens(invitation_id, purpose) WHERE revoked_at IS NULL;

-- ───────────── Submissions ─────────────
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  form_version_id TEXT NOT NULL REFERENCES form_versions(id),
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  invitation_id TEXT REFERENCES invitations(id) ON DELETE SET NULL,
  guest_id TEXT REFERENCES guests(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','spam','reviewed','archived')),
  respondent_name TEXT,
  respondent_email TEXT,
  rsvp_status TEXT,
  party_size INTEGER NOT NULL DEFAULT 0,
  is_late INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  duplicate_of TEXT,
  spam_score INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT
);
CREATE INDEX submissions_form ON submissions(form_id, deleted_at, created_at);
CREATE INDEX submissions_ws ON submissions(workspace_id, deleted_at, created_at);
CREATE INDEX submissions_event ON submissions(event_id, created_at);
CREATE INDEX submissions_dedupe ON submissions(form_id, dedupe_key);
CREATE UNIQUE INDEX submissions_idem ON submissions(form_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Normalized answers for filtering, reporting and analytics (meal counts, etc.)
CREATE TABLE answers (
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  field_type TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_json TEXT,
  PRIMARY KEY (submission_id, field_id)
);
CREATE INDEX answers_form_field ON answers(form_id, field_id, value_text);

-- Response history (created, edited, status changed, deleted)
CREATE TABLE submission_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_user_id TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX submission_events_sub ON submission_events(submission_id, created_at);

-- Funnel analytics: views → starts → completions per visit
CREATE TABLE form_visits (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop','mobile','tablet')),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX form_visits_form ON form_visits(form_id, created_at);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  submission_id TEXT REFERENCES submissions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX uploads_form ON uploads(form_id);

-- ───────────── Attendance ─────────────
CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_guest_id TEXT NOT NULL REFERENCES event_guests(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES event_sessions(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('qr','manual')),
  is_override INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  checked_in_by TEXT REFERENCES users(id),
  attendee_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  undone_at TEXT,
  undone_by TEXT
);
-- Prevent duplicate active check-ins for the same guest and session (NULL session = whole event)
CREATE UNIQUE INDEX checkins_unique ON checkins(event_guest_id, IFNULL(session_id, '')) WHERE undone_at IS NULL;
CREATE INDEX checkins_event ON checkins(event_id, created_at);

-- ───────────── Infrastructure ─────────────
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('webhook','slack','google_sheets','zapier')),
  name TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  signing_secret TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX integrations_ws ON integrations(workspace_id);

CREATE TABLE email_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (workspace_id, type)
);

CREATE TABLE email_suppressions (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  reason TEXT NOT NULL DEFAULT 'unsubscribe',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, email)
);

CREATE TABLE notification_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                       -- invitation, rsvp_confirmation, reminder, organizer_notification, webhook, ...
  channel TEXT NOT NULL CHECK (channel IN ('email','webhook')),
  recipient TEXT NOT NULL,
  subject TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','delivered','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  provider_message_id TEXT,
  invitation_id TEXT REFERENCES invitations(id) ON DELETE SET NULL,
  idempotency_key TEXT UNIQUE,
  scheduled_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX notification_jobs_ws ON notification_jobs(workspace_id, status, created_at);

CREATE TABLE subscription_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_monthly_inr INTEGER NOT NULL,
  price_monthly_usd INTEGER NOT NULL,
  limits TEXT NOT NULL,
  features TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL CHECK (status IN ('active','trialing','past_due','canceled')),
  trial_plan_id TEXT REFERENCES subscription_plans(id),
  trial_ends_at TEXT,
  provider TEXT CHECK (provider IN ('stripe','razorpay')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  current_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE custom_domains (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed')),
  verification_token TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX audit_logs_ws ON audit_logs(workspace_id, created_at);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
