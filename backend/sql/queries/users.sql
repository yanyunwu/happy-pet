-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = $1;

-- name: GetUserByOpenID :one
SELECT * FROM users WHERE wechat_openid = $1;

-- name: CreateUser :one
INSERT INTO users (id, username, password_hash, wechat_openid, wechat_unionid, nickname, role, status, remark)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;

-- name: ListUsers :many
SELECT * FROM users
WHERE (sqlc.arg(include_deleted)::boolean OR deleted_at IS NULL)
  AND (sqlc.arg(q)::text = '' OR nickname ILIKE '%' || sqlc.arg(q) || '%' OR COALESCE(username, '') ILIKE '%' || sqlc.arg(q) || '%' OR id = sqlc.arg(q))
  AND (sqlc.arg(status)::text = '' OR (sqlc.arg(status) = 'deleted' AND deleted_at IS NOT NULL) OR (status = sqlc.arg(status) AND deleted_at IS NULL))
  AND (sqlc.arg(source)::text = '' OR (sqlc.arg(source) = 'wechat' AND wechat_openid IS NOT NULL) OR (sqlc.arg(source) = 'manual' AND wechat_openid IS NULL))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CountUsers :one
SELECT count(*) FROM users
WHERE (sqlc.arg(include_deleted)::boolean OR deleted_at IS NULL)
  AND (sqlc.arg(q)::text = '' OR nickname ILIKE '%' || sqlc.arg(q) || '%' OR COALESCE(username, '') ILIKE '%' || sqlc.arg(q) || '%' OR id = sqlc.arg(q))
  AND (sqlc.arg(status)::text = '' OR (sqlc.arg(status) = 'deleted' AND deleted_at IS NOT NULL) OR (status = sqlc.arg(status) AND deleted_at IS NULL))
  AND (sqlc.arg(source)::text = '' OR (sqlc.arg(source) = 'wechat' AND wechat_openid IS NOT NULL) OR (sqlc.arg(source) = 'manual' AND wechat_openid IS NULL));

-- name: UserStats :one
SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS total,
       count(*) FILTER (WHERE deleted_at IS NULL AND wechat_openid IS NOT NULL) AS wechat,
       count(*) FILTER (WHERE deleted_at IS NULL AND status = 'disabled') AS disabled,
       count(*) FILTER (WHERE deleted_at IS NULL AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')) AS today
FROM users;

-- name: CountActiveAdmins :one
SELECT count(*) FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL;

-- name: CountAllAdmins :one
SELECT count(*) FROM users WHERE role = 'admin';

-- name: UpdateUser :one
UPDATE users SET nickname = $2, status = $3, remark = $4, updated_at = now(),
session_version = session_version + CASE WHEN status <> $3 THEN 1 ELSE 0 END
WHERE id = $1 AND deleted_at IS NULL RETURNING *;

-- name: UpdateProfile :one
UPDATE users SET nickname = sqlc.arg(nickname),
 avatar_url=CASE WHEN sqlc.arg(update_avatar)::boolean THEN sqlc.arg(avatar_url)::text ELSE avatar_url END,
 avatar_media_id=CASE WHEN sqlc.arg(update_avatar)::boolean THEN NULL ELSE avatar_media_id END,
 updated_at=now() WHERE id=sqlc.arg(id) AND deleted_at IS NULL AND status='active' RETURNING *;

-- name: UpdatePassword :exec
UPDATE users SET password_hash = $2, session_version = session_version + 1, updated_at = now() WHERE id = $1 AND deleted_at IS NULL;

-- name: TouchLogin :one
UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1 AND status = 'active' AND deleted_at IS NULL RETURNING *;

-- name: RevokeSessions :exec
UPDATE users SET session_version = session_version + 1 WHERE id = $1;

-- name: DeleteUser :exec
UPDATE users SET deleted_at = now(), updated_at = now(), session_version = session_version + 1 WHERE id = $1 AND deleted_at IS NULL;

-- name: RestoreUser :one
UPDATE users SET deleted_at = NULL, status = 'disabled', updated_at = now(), session_version = session_version + 1 WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *;

-- name: LockUserAdministration :exec
SELECT pg_advisory_xact_lock(531284527);

-- name: LockWechatRegistration :exec
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(openid)::text, 0));
