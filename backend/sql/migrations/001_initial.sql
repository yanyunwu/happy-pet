-- Complete business schema for a first deployment.
-- 000 creates the migration ledger; subsequent schema changes start at 002.
CREATE TABLE users (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
    username TEXT UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    wechat_openid TEXT UNIQUE,
    wechat_unionid TEXT NOT NULL DEFAULT '',
    avatar_media_id TEXT,
    nickname TEXT NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 32),
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    remark TEXT NOT NULL DEFAULT '' CHECK (char_length(remark) <= 500),
    session_version BIGINT NOT NULL DEFAULT 1,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CHECK (username IS NOT NULL OR wechat_openid IS NOT NULL)
);
CREATE INDEX users_created_at_idx ON users (created_at DESC, id);
CREATE INDEX users_status_idx ON users (status) WHERE deleted_at IS NULL;

CREATE TABLE player_assets (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    coins BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
    undo INTEGER NOT NULL DEFAULT 0 CHECK (undo >= 0),
    shovel INTEGER NOT NULL DEFAULT 0 CHECK (shovel >= 0),
    hint INTEGER NOT NULL DEFAULT 0 CHECK (hint >= 0),
    shuffle INTEGER NOT NULL DEFAULT 0 CHECK (shuffle >= 0),
    sign_in_count INTEGER NOT NULL DEFAULT 0,
    signed_on TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE asset_ledger (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    request_key TEXT NOT NULL,
    asset TEXT NOT NULL CHECK (asset IN ('coins', 'undo', 'shovel', 'hint', 'shuffle')),
    delta BIGINT NOT NULL,
    balance BIGINT NOT NULL CHECK (balance >= 0),
    reason TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, request_key, asset)
);
CREATE INDEX asset_ledger_user_idx ON asset_ledger (user_id, id DESC);

CREATE TABLE levels (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK (mode IN ('classic', 'quartet', 'fun')),
    ordinal INTEGER NOT NULL CHECK (ordinal > 0),
    title TEXT NOT NULL,
    draft JSONB NOT NULL,
    draft_version INTEGER NOT NULL DEFAULT 1,
    published_revision TEXT,
    enabled BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    entry TEXT NOT NULL DEFAULT 'campaign' CHECK (entry IN ('standard', 'campaign')),
    CONSTRAINT levels_entry_mode_ordinal_key UNIQUE (entry, mode, ordinal)
);

CREATE TABLE level_revisions (
    id TEXT PRIMARY KEY,
    level_id TEXT NOT NULL REFERENCES levels(id),
    version INTEGER NOT NULL,
    config JSONB NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    title TEXT NOT NULL DEFAULT '',
    UNIQUE (level_id, version)
);
ALTER TABLE levels ADD CONSTRAINT levels_published_fk
    FOREIGN KEY (published_revision) REFERENCES level_revisions(id);

CREATE TABLE game_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    request_key TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    level_id TEXT NOT NULL REFERENCES levels(id),
    revision_id TEXT NOT NULL REFERENCES level_revisions(id),
    mode TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    seed BIGINT NOT NULL,
    initial JSONB NOT NULL,
    state JSONB NOT NULL,
    last_seq INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'lost', 'abandoned')),
    settled BOOLEAN NOT NULL DEFAULT false,
    reward_coins INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    title TEXT NOT NULL DEFAULT '',
    entry TEXT NOT NULL DEFAULT 'campaign' CHECK (entry IN ('standard', 'campaign')),
    UNIQUE (user_id, request_key)
);
CREATE INDEX sessions_user_idx ON game_sessions (user_id, started_at DESC);
CREATE INDEX sessions_admin_idx ON game_sessions (started_at DESC, id DESC);
CREATE INDEX sessions_entry_idx ON game_sessions (entry, started_at DESC, id DESC);

CREATE TABLE game_events (
    session_id TEXT NOT NULL REFERENCES game_sessions(id),
    seq INTEGER NOT NULL CHECK (seq > 0),
    action JSONB NOT NULL,
    state JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, seq)
);

CREATE TABLE level_clears (
    user_id TEXT NOT NULL REFERENCES users(id),
    level_id TEXT NOT NULL REFERENCES levels(id),
    session_id TEXT NOT NULL REFERENCES game_sessions(id),
    cleared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, level_id)
);

CREATE TABLE system_initializations (
    init_key TEXT PRIMARY KEY CHECK (btrim(init_key) <> '' AND char_length(init_key) <= 200),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE system_initializations IS '系统初始化记录表';
COMMENT ON COLUMN system_initializations.init_key IS '初始化任务唯一标识，使用业务前缀，例如 level_catalog:standard';
COMMENT ON COLUMN system_initializations.recorded_at IS '初始化记录写入时间';

CREATE TABLE level_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    layout JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Geometry-only starter templates. Each level receives its own imported copy.

INSERT INTO level_templates(id,name,layout) VALUES
 ('template-nine-grid','九宫叠层','{"columns":3,"rows":3,"layers":[{"z":0,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0},{"x":0,"y":2},{"x":2,"y":2},{"x":4,"y":2},{"x":0,"y":4},{"x":2,"y":4},{"x":4,"y":4}]},{"z":1,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0},{"x":0,"y":2},{"x":2,"y":2},{"x":4,"y":2},{"x":0,"y":4},{"x":2,"y":4},{"x":4,"y":4}]}]}'::jsonb),
 ('template-double-corridor','双层长廊','{"columns":4,"rows":2,"layers":[{"z":0,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0},{"x":6,"y":0},{"x":0,"y":2},{"x":2,"y":2},{"x":4,"y":2},{"x":6,"y":2}]},{"z":1,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0},{"x":6,"y":0},{"x":0,"y":2},{"x":2,"y":2},{"x":4,"y":2},{"x":6,"y":2}]}]}'::jsonb),
 ('template-forest-steps','森林阶梯','{"columns":6,"rows":8,"layers":[{"z":0,"cells":[{"x":0,"y":0},{"x":2,"y":0},{"x":4,"y":0},{"x":6,"y":0},{"x":8,"y":0},{"x":10,"y":0},{"x":0,"y":2},{"x":2,"y":2},{"x":4,"y":2},{"x":6,"y":2},{"x":8,"y":2},{"x":10,"y":2},{"x":0,"y":4},{"x":2,"y":4},{"x":4,"y":4},{"x":6,"y":4},{"x":8,"y":4},{"x":10,"y":4},{"x":0,"y":6},{"x":2,"y":6},{"x":4,"y":6},{"x":6,"y":6},{"x":8,"y":6},{"x":10,"y":6},{"x":0,"y":8},{"x":2,"y":8},{"x":4,"y":8},{"x":6,"y":8},{"x":8,"y":8},{"x":10,"y":8},{"x":0,"y":10},{"x":2,"y":10},{"x":4,"y":10},{"x":6,"y":10},{"x":8,"y":10},{"x":10,"y":10},{"x":0,"y":12},{"x":2,"y":12},{"x":4,"y":12},{"x":6,"y":12},{"x":8,"y":12},{"x":10,"y":12},{"x":0,"y":14},{"x":2,"y":14},{"x":4,"y":14},{"x":6,"y":14},{"x":8,"y":14},{"x":10,"y":14}]},{"z":1,"cells":[{"x":1,"y":1},{"x":3,"y":1},{"x":5,"y":1},{"x":7,"y":1},{"x":9,"y":1},{"x":1,"y":3},{"x":3,"y":3},{"x":5,"y":3},{"x":7,"y":3},{"x":9,"y":3},{"x":1,"y":5},{"x":3,"y":5},{"x":5,"y":5},{"x":7,"y":5},{"x":9,"y":5},{"x":1,"y":7},{"x":3,"y":7},{"x":5,"y":7},{"x":7,"y":7},{"x":9,"y":7},{"x":1,"y":9},{"x":3,"y":9},{"x":5,"y":9},{"x":7,"y":9},{"x":9,"y":9},{"x":1,"y":11},{"x":3,"y":11},{"x":5,"y":11},{"x":7,"y":11},{"x":9,"y":11},{"x":1,"y":13},{"x":3,"y":13},{"x":5,"y":13},{"x":7,"y":13},{"x":9,"y":13}]},{"z":2,"cells":[{"x":2,"y":2},{"x":4,"y":2},{"x":6,"y":2},{"x":8,"y":2},{"x":2,"y":5},{"x":4,"y":5},{"x":6,"y":5},{"x":8,"y":5},{"x":2,"y":8},{"x":4,"y":8},{"x":6,"y":8},{"x":8,"y":8},{"x":2,"y":11},{"x":4,"y":11},{"x":6,"y":11},{"x":8,"y":11}]},{"z":3,"cells":[{"x":3,"y":4},{"x":5,"y":4},{"x":7,"y":4},{"x":3,"y":10},{"x":5,"y":10},{"x":7,"y":10}]},{"z":4,"cells":[{"x":3,"y":11},{"x":5,"y":11},{"x":7,"y":11}]}]}'::jsonb);
