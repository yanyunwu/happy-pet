-- Keep existing media references as a fallback for pre-profile users.
ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''
    CHECK (char_length(avatar_url) <= 2048);
