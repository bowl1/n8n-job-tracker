CREATE TYPE job_status AS ENUM (
  'discovered',
  'filtered_out',
  'parsing_failed',
  'evaluated',
  'not_recommended',
  'low_priority',
  'needs_human_review',
  'skipped',
  'approved_to_apply',
  'application_material_ready',
  'email_opened'
);

CREATE TYPE recommendation_enum AS ENUM ('APPLY', 'REVIEW', 'SKIP');
CREATE TYPE cv_variant AS ENUM ('A1', 'D1', 'S1');

CREATE TABLE IF NOT EXISTS candidate_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_version cv_variant NOT NULL,
  profile_data JSONB,
  full_name TEXT,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  work_experience JSONB NOT NULL DEFAULT '[]'::jsonb,
  projects JSONB NOT NULL DEFAULT '[]'::jsonb,
  education JSONB NOT NULL DEFAULT '[]'::jsonb,
  work_permit TEXT,
  target_role_families JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_job_id TEXT UNIQUE,
  source TEXT NOT NULL,
  status job_status NOT NULL DEFAULT 'discovered',
  company TEXT,
  title TEXT,
  location TEXT,
  job_url TEXT,
  description TEXT,
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_data JSONB,
  parsed_data JSONB,
  requirement_analysis JSONB,
  fit_analysis JSONB,
  fit_score INTEGER,
  fit_recommendation recommendation_enum,
  seniority_match TEXT,
  hard_blockers JSONB DEFAULT '[]'::jsonb,
  strong_matches JSONB DEFAULT '[]'::jsonb,
  main_gaps JSONB DEFAULT '[]'::jsonb,
  recommended_cv cv_variant,
  selected_cv cv_variant,
  filter_reasons JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  application_material_ready_at TIMESTAMPTZ,
  email_opened_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS application_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  material_type TEXT NOT NULL,
  content TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_external_job_id ON jobs(external_job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_company_title ON jobs(company, title);
CREATE INDEX IF NOT EXISTS idx_events_job_id ON job_events(job_id, created_at);
