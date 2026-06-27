-- Explicit front-end builder flag (allows a second community assignment)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_front_end_builder BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_front_end_builder
  ON profiles(is_front_end_builder) WHERE is_front_end_builder = true;
