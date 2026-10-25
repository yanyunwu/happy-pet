-- Administrators are a separate principal; player identities and audit IDs survive.
CREATE TABLE admin_accounts (
    id TEXT PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
    -- Historical WeChat-only administrators may not have a password username.
    username TEXT UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    nickname TEXT NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 32),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    remark TEXT NOT NULL DEFAULT '' CHECK (char_length(remark) <= 500),
    session_version BIGINT NOT NULL DEFAULT 1,
    access_token_hash TEXT UNIQUE CHECK (access_token_hash ~ '^[a-f0-9]{64}$'),
    access_token_hint TEXT NOT NULL DEFAULT '',
    access_token_updated_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX admin_accounts_created_at_idx ON admin_accounts (created_at DESC, id DESC);

INSERT INTO admin_accounts (id,username,password_hash,nickname,status,remark,session_version,last_login_at,created_at,updated_at,deleted_at)
SELECT id,username,password_hash,nickname,status,remark,session_version,last_login_at,created_at,updated_at,deleted_at
FROM users WHERE role='admin';

-- Never cascade away player data. Even an otherwise empty legacy asset/profile
-- record is retained conservatively; audit actor IDs remain unchanged text IDs.
DELETE FROM users u WHERE role='admin'
  AND wechat_openid IS NULL AND wechat_unionid=''
  AND avatar_media_id IS NULL AND avatar_url=''
  AND NOT EXISTS (SELECT 1 FROM player_assets a WHERE a.user_id=u.id)
  AND NOT EXISTS (SELECT 1 FROM asset_ledger a WHERE a.user_id=u.id)
  AND NOT EXISTS (SELECT 1 FROM game_sessions g WHERE g.user_id=u.id)
  AND NOT EXISTS (SELECT 1 FROM level_clears c WHERE c.user_id=u.id);

UPDATE users SET role='user',session_version=session_version+1 WHERE role='admin';
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role='user');
