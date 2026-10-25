-- name: GetAppSetting :one
SELECT key, value, version, updated_at FROM app_settings WHERE key = $1;

-- name: UpdateAppSetting :one
UPDATE app_settings SET value = sqlc.arg(value), version = version + 1, updated_at = now()
WHERE key = sqlc.arg(key) AND version = sqlc.arg(version)
RETURNING key, value, version, updated_at;
