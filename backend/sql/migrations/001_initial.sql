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

