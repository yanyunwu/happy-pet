-- name: GetAdminAccount :one
SELECT * FROM admin_accounts WHERE id=$1;

-- name: GetAdminAccountByUsername :one
SELECT * FROM admin_accounts WHERE username=$1;

-- name: GetAdminAccountByTokenHash :one
SELECT * FROM admin_accounts WHERE access_token_hash=$1 AND status='active' AND deleted_at IS NULL;

-- name: CreateAdminAccount :one
INSERT INTO admin_accounts(id,username,password_hash,nickname,remark) VALUES($1,$2,$3,$4,$5) RETURNING *;

-- name: CountActiveAdminAccounts :one
SELECT count(*) FROM admin_accounts WHERE status='active' AND deleted_at IS NULL;

-- name: CountAllAdminAccounts :one
SELECT count(*) FROM admin_accounts;

-- name: ListAdminAccounts :many
SELECT * FROM admin_accounts
WHERE (sqlc.arg(include_deleted)::boolean OR deleted_at IS NULL)
  AND (sqlc.arg(q)::text='' OR nickname ILIKE '%' || sqlc.arg(q) || '%' OR COALESCE(username,'') ILIKE '%' || sqlc.arg(q) || '%' OR id=sqlc.arg(q))
  AND (sqlc.arg(status)::text='' OR (sqlc.arg(status)='deleted' AND deleted_at IS NOT NULL) OR (status=sqlc.arg(status) AND deleted_at IS NULL))
ORDER BY created_at DESC,id DESC
LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);

-- name: CountAdminAccounts :one
SELECT count(*) FROM admin_accounts
WHERE (sqlc.arg(include_deleted)::boolean OR deleted_at IS NULL)
  AND (sqlc.arg(q)::text='' OR nickname ILIKE '%' || sqlc.arg(q) || '%' OR COALESCE(username,'') ILIKE '%' || sqlc.arg(q) || '%' OR id=sqlc.arg(q))
  AND (sqlc.arg(status)::text='' OR (sqlc.arg(status)='deleted' AND deleted_at IS NOT NULL) OR (status=sqlc.arg(status) AND deleted_at IS NULL));

-- name: UpdateAdminAccount :one
UPDATE admin_accounts SET nickname=$2,status=$3,remark=$4,updated_at=now(),
 session_version=session_version+CASE WHEN status<>$3 THEN 1 ELSE 0 END,
 access_token_hash=CASE WHEN status<>$3 THEN NULL ELSE access_token_hash END,
 access_token_hint=CASE WHEN status<>$3 THEN '' ELSE access_token_hint END,
 access_token_updated_at=CASE WHEN status<>$3 THEN NULL ELSE access_token_updated_at END
WHERE id=$1 AND deleted_at IS NULL RETURNING *;

-- name: DeleteAdminAccount :exec
UPDATE admin_accounts SET deleted_at=now(),updated_at=now(),session_version=session_version+1,
 access_token_hash=NULL,access_token_hint='',access_token_updated_at=NULL WHERE id=$1 AND deleted_at IS NULL;

-- name: RestoreAdminAccount :one
UPDATE admin_accounts SET deleted_at=NULL,status='disabled',updated_at=now(),session_version=session_version+1,
 access_token_hash=NULL,access_token_hint='',access_token_updated_at=NULL WHERE id=$1 AND deleted_at IS NOT NULL RETURNING *;

-- name: UpdateAdminPassword :exec
UPDATE admin_accounts SET password_hash=$2,updated_at=now(),session_version=session_version+1,
 access_token_hash=NULL,access_token_hint='',access_token_updated_at=NULL WHERE id=$1 AND deleted_at IS NULL;

-- name: TouchAdminLogin :one
UPDATE admin_accounts SET last_login_at=now(),updated_at=now() WHERE id=$1 AND status='active' AND deleted_at IS NULL RETURNING *;

-- name: RevokeAdminSessions :exec
UPDATE admin_accounts SET session_version=session_version+1 WHERE id=$1;

-- name: SetAdminAccessToken :one
UPDATE admin_accounts SET access_token_hash=$2,access_token_hint=$3,access_token_updated_at=now(),updated_at=now()
WHERE id=$1 AND deleted_at IS NULL AND status='active' RETURNING *;

-- name: RevokeAdminAccessToken :exec
UPDATE admin_accounts SET access_token_hash=NULL,access_token_hint='',access_token_updated_at=NULL,updated_at=now() WHERE id=$1;

-- name: LockAdminAdministration :exec
SELECT pg_advisory_xact_lock(531284528);
