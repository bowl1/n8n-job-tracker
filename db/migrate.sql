ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS profile_data JSONB;
CREATE INDEX IF NOT EXISTS candidate_profiles_version_idx ON candidate_profiles(profile_version, updated_at DESC);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirement_analysis JSONB;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fit_analysis JSONB;
