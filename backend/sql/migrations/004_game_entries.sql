-- Keep the existing configurable campaign, and give the three original home
-- entries their own immutable two-stage catalog and session identity.
ALTER TABLE levels ADD COLUMN entry TEXT NOT NULL DEFAULT 'campaign'
    CHECK (entry IN ('standard','campaign'));
ALTER TABLE levels DROP CONSTRAINT levels_mode_ordinal_key;
ALTER TABLE levels ADD CONSTRAINT levels_entry_mode_ordinal_key UNIQUE(entry,mode,ordinal);
ALTER TABLE levels ADD CONSTRAINT standard_levels_two_stages CHECK(entry<>'standard' OR ordinal IN (1,2));
ALTER TABLE game_sessions ADD COLUMN entry TEXT NOT NULL DEFAULT 'campaign'
    CHECK (entry IN ('standard','campaign'));
CREATE INDEX sessions_entry_idx ON game_sessions(entry,started_at DESC,id DESC);
