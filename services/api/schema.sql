CREATE TABLE IF NOT EXISTS organizations (
 id uuid PRIMARY KEY, name text NOT NULL, demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS units (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, parent_id uuid REFERENCES units(id), kind text NOT NULL CHECK(kind IN ('department','team')), UNIQUE(org_id, name)
);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand jsonb;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_revision integer NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, email text NOT NULL, password_hash text,
 roles text[] NOT NULL DEFAULT '{MEMBER}', unit_ids uuid[] NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
 external_id text, external_tenant text, removed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,email), UNIQUE(external_tenant,external_id)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS templates (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL, version integer NOT NULL DEFAULT 1,
 language text NOT NULL DEFAULT 'English', sections jsonb NOT NULL, published boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meetings (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), unit_id uuid REFERENCES units(id), owner_id uuid NOT NULL REFERENCES users(id),
 reviewer_id uuid REFERENCES users(id), title text NOT NULL, reference_number text, platform text NOT NULL, join_url text, scheduled_at timestamptz NOT NULL,
 timezone text NOT NULL DEFAULT 'Asia/Hong_Kong', duration_minutes integer NOT NULL DEFAULT 60,
 status text NOT NULL DEFAULT 'DRAFT', template_id uuid REFERENCES templates(id), consent boolean NOT NULL DEFAULT false,
 sample boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1, error text,
 file_path text, file_name text, mime_type text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE templates ADD COLUMN IF NOT EXISTS docx_data bytea;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS docx_name text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS docx_sha256 text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reference_number text;
CREATE INDEX IF NOT EXISTS meetings_org_date ON meetings(org_id,scheduled_at);
CREATE TABLE IF NOT EXISTS transcripts (
 id uuid PRIMARY KEY, meeting_id uuid NOT NULL REFERENCES meetings(id), version integer NOT NULL, segments jsonb NOT NULL,
 source text NOT NULL, is_final boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(meeting_id,version)
);
CREATE TABLE IF NOT EXISTS minutes (
 id uuid PRIMARY KEY, meeting_id uuid NOT NULL REFERENCES meetings(id), version integer NOT NULL, transcript_id uuid REFERENCES transcripts(id),
 content jsonb NOT NULL, status text NOT NULL DEFAULT 'DRAFT', revision integer NOT NULL DEFAULT 1,
 reviewer_comment text, approved_by uuid REFERENCES users(id), approved_at timestamptz, template_snapshot jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(meeting_id,version)
);
CREATE TABLE IF NOT EXISTS integrations (
 org_id uuid NOT NULL REFERENCES organizations(id), provider text NOT NULL, config jsonb NOT NULL DEFAULT '{}', secret text,
 status text NOT NULL DEFAULT 'NOT_CONFIGURED', checked_at timestamptz, PRIMARY KEY(org_id,provider)
);
CREATE TABLE IF NOT EXISTS rate_cards (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), provider text NOT NULL, model text NOT NULL,
 unit text NOT NULL CHECK(unit IN ('audio_minute','bot_minute','input_million_tokens','output_million_tokens')), usd_rate numeric(18,8) NOT NULL CHECK(usd_rate >= 0),
 hkd_per_usd numeric(18,8) NOT NULL CHECK(hkd_per_usd > 0), effective_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage (
 id uuid PRIMARY KEY, meeting_id uuid NOT NULL REFERENCES meetings(id), provider text NOT NULL, model text NOT NULL, unit text NOT NULL,
 quantity numeric(20,8) NOT NULL, usd numeric(20,8), hkd numeric(20,8), rate_snapshot jsonb, status text NOT NULL DEFAULT 'CALCULATED',
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Existing installations created the original constraint before Recall bot-runtime
-- billing was available. Recreate it at startup so the new unit is accepted safely.
ALTER TABLE rate_cards DROP CONSTRAINT IF EXISTS rate_cards_unit_check;
ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_unit_check CHECK(unit IN ('audio_minute','bot_minute','input_million_tokens','output_million_tokens'));
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, meeting_id uuid NOT NULL REFERENCES meetings(id), type text NOT NULL, status text NOT NULL DEFAULT 'PENDING',
 run_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0, error text, locked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(meeting_id,type) WHERE status IN ('PENDING','RUNNING');
CREATE TABLE IF NOT EXISTS audit (
 id bigserial PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), user_id uuid, meeting_id uuid,
 action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_states (
 state text PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), verifier text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS capture_connections (
 org_id uuid NOT NULL REFERENCES organizations(id), platform text NOT NULL CHECK(platform IN ('Teams','Zoom')),
 config jsonb NOT NULL DEFAULT '{}', secret text, webhook_secret text, enabled boolean NOT NULL DEFAULT false,
 checked_at timestamptz, webhook_checked_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(org_id,platform)
);
CREATE TABLE IF NOT EXISTS capture_sessions (
 meeting_id uuid PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE, org_id uuid NOT NULL REFERENCES organizations(id),
 platform text NOT NULL, bot_id uuid UNIQUE, config jsonb NOT NULL, secret text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING', last_event_at timestamptz, stop_requested boolean NOT NULL DEFAULT false,
 recording_id uuid, imported_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS capture_webhooks (
 org_id uuid NOT NULL REFERENCES organizations(id), platform text NOT NULL, event_id text NOT NULL,
 payload jsonb NOT NULL, processed_at timestamptz, error text, attempts integer NOT NULL DEFAULT 0,
 run_at timestamptz NOT NULL DEFAULT now(), received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(org_id,platform,event_id)
);
CREATE TABLE IF NOT EXISTS capture_preferences (
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 platform text NOT NULL CHECK(platform IN ('Teams','Zoom')), method text NOT NULL CHECK(method IN ('recall','direct')),
 PRIMARY KEY(org_id,platform)
);
CREATE TABLE IF NOT EXISTS direct_capture_connections (
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 platform text NOT NULL CHECK(platform IN ('Teams','Zoom')), config jsonb NOT NULL DEFAULT '{}', secret text,
 enabled boolean NOT NULL DEFAULT false, checked_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,platform)
);
ALTER TABLE capture_sessions ADD COLUMN IF NOT EXISTS polled_at timestamptz;
