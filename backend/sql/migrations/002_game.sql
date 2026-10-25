CREATE TABLE player_assets (
 user_id TEXT PRIMARY KEY REFERENCES users(id), coins BIGINT NOT NULL DEFAULT 0 CHECK(coins>=0),
 undo INTEGER NOT NULL DEFAULT 0 CHECK(undo>=0), shovel INTEGER NOT NULL DEFAULT 0 CHECK(shovel>=0),
 hint INTEGER NOT NULL DEFAULT 0 CHECK(hint>=0), shuffle INTEGER NOT NULL DEFAULT 0 CHECK(shuffle>=0),
 sign_in_count INTEGER NOT NULL DEFAULT 0, signed_on TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE asset_ledger (
 id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 asset TEXT NOT NULL CHECK(asset IN ('coins','undo','shovel','hint','shuffle')), delta BIGINT NOT NULL,
 balance BIGINT NOT NULL CHECK(balance>=0), reason TEXT NOT NULL, actor_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id,request_key,asset)
);
CREATE INDEX asset_ledger_user_idx ON asset_ledger(user_id,id DESC);
CREATE TABLE levels (
 id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('classic','quartet','fun')),
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 9999), title TEXT NOT NULL,
 draft JSONB NOT NULL, draft_version INTEGER NOT NULL DEFAULT 1,
 published_revision TEXT, enabled BOOLEAN NOT NULL DEFAULT false,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(mode,ordinal)
);
CREATE TABLE level_revisions (
 id TEXT PRIMARY KEY, level_id TEXT NOT NULL REFERENCES levels(id), version INTEGER NOT NULL,
 config JSONB NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(level_id,version)
);
ALTER TABLE levels ADD CONSTRAINT levels_published_fk FOREIGN KEY(published_revision) REFERENCES level_revisions(id);
CREATE TABLE game_sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 campaign_id TEXT NOT NULL, level_id TEXT NOT NULL REFERENCES levels(id), revision_id TEXT NOT NULL REFERENCES level_revisions(id),
 mode TEXT NOT NULL, ordinal INTEGER NOT NULL, seed BIGINT NOT NULL,
 initial JSONB NOT NULL, state JSONB NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'playing' CHECK(status IN ('playing','won','lost','abandoned')),
 settled BOOLEAN NOT NULL DEFAULT false, reward_coins INTEGER NOT NULL DEFAULT 0,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(), ended_at TIMESTAMPTZ, UNIQUE(user_id,request_key)
);
CREATE INDEX sessions_user_idx ON game_sessions(user_id,started_at DESC);
CREATE INDEX sessions_admin_idx ON game_sessions(started_at DESC,id DESC);
CREATE TABLE game_events (
 session_id TEXT NOT NULL REFERENCES game_sessions(id), seq INTEGER NOT NULL CHECK(seq>0),
 action JSONB NOT NULL, state JSONB NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(session_id,seq)
);
CREATE TABLE level_clears (
 user_id TEXT NOT NULL REFERENCES users(id), level_id TEXT NOT NULL REFERENCES levels(id),
 session_id TEXT NOT NULL REFERENCES game_sessions(id), cleared_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,level_id)
);
