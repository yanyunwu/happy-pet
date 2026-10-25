-- name: EnsureAssets :exec
INSERT INTO player_assets(user_id) VALUES($1) ON CONFLICT DO NOTHING;
-- name: GetAssets :one
SELECT * FROM player_assets WHERE user_id=$1;
-- name: LockAssets :one
SELECT * FROM player_assets WHERE user_id=$1 FOR UPDATE;
-- name: SetAssets :exec
UPDATE player_assets SET coins=$2,undo=$3,shovel=$4,hint=$5,shuffle=$6,sign_in_count=$7,signed_on=$8,updated_at=now() WHERE user_id=$1;
-- name: AddLedger :exec
INSERT INTO asset_ledger(user_id,request_key,asset,delta,balance,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7);
-- name: HasLedgerKey :one
SELECT count(*) FROM asset_ledger WHERE user_id=$1 AND request_key=$2;
-- name: LedgerByKey :many
SELECT * FROM asset_ledger WHERE user_id=$1 AND request_key=$2;
-- name: ListLedger :many
SELECT * FROM asset_ledger WHERE user_id=$1 ORDER BY id DESC LIMIT 100;
-- name: ListLevels :many
SELECT * FROM levels ORDER BY entry,mode,ordinal;
-- name: GetLevel :one
SELECT * FROM levels WHERE id=$1;
-- name: LockLevel :one
SELECT * FROM levels WHERE id=$1 FOR UPDATE;
-- name: CreateLevel :one
INSERT INTO levels(id,mode,ordinal,title,draft,entry) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;
-- name: SaveDraft :one
UPDATE levels SET title=$2,draft=$3,draft_version=draft_version+1,updated_at=now() WHERE id=$1 AND draft_version=$4 RETURNING *;
-- name: AddRevision :one
INSERT INTO level_revisions(id,level_id,version,config,created_by,title) VALUES($1,$2,$3,$4,$5,$6) RETURNING *;
-- name: GetRevision :one
SELECT * FROM level_revisions WHERE id=$1;
-- name: ListRevisions :many
SELECT * FROM level_revisions WHERE level_id=$1 ORDER BY version DESC;
-- name: PublishLevel :exec
UPDATE levels SET published_revision=$2,enabled=true,updated_at=now() WHERE id=$1;
-- name: EnableLevel :exec
UPDATE levels SET enabled=$2,updated_at=now() WHERE id=$1;
-- name: CreateSession :one
INSERT INTO game_sessions(id,user_id,request_key,campaign_id,level_id,revision_id,mode,ordinal,seed,initial,state,title,entry)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *;
-- name: GetSession :one
SELECT * FROM game_sessions WHERE id=$1;
-- name: GetSessionByRequest :one
SELECT * FROM game_sessions WHERE user_id=$1 AND request_key=$2;
-- name: LockSession :one
SELECT * FROM game_sessions WHERE id=$1 FOR UPDATE;
-- name: UpdateSession :exec
UPDATE game_sessions SET state=$2,last_seq=$3,status=$4 WHERE id=$1;
-- name: SettleSession :exec
UPDATE game_sessions SET settled=true,reward_coins=$2,ended_at=now(),status=$3 WHERE id=$1;
-- name: AddEvent :exec
INSERT INTO game_events(session_id,seq,action,state) VALUES($1,$2,$3,$4);
-- name: GetEvent :one
SELECT * FROM game_events WHERE session_id=$1 AND seq=$2;
-- name: ListEvents :many
SELECT * FROM game_events WHERE session_id=$1 ORDER BY seq;
-- name: ListSessions :many
SELECT s.id,s.user_id,s.entry,s.mode,s.ordinal,s.revision_id,s.status,s.settled,s.last_seq,s.reward_coins,s.started_at,
 (s.state->>'moves')::int AS moves,(s.state->>'cleared')::int AS cleared,jsonb_array_length(s.state->'tiles') AS total,
 u.nickname,s.title FROM game_sessions s JOIN users u ON u.id=s.user_id
WHERE (sqlc.arg(user_id)::text='' OR s.user_id=sqlc.arg(user_id)) AND (sqlc.arg(mode)::text='' OR s.mode=sqlc.arg(mode))
AND (sqlc.arg(status)::text='' OR s.status=sqlc.arg(status))
AND (sqlc.arg(entry)::text='' OR s.entry=sqlc.arg(entry))
ORDER BY s.started_at DESC,s.id DESC LIMIT sqlc.arg(page_limit) OFFSET sqlc.arg(page_offset);
-- name: CountSessions :one
SELECT count(*) FROM game_sessions s WHERE (sqlc.arg(user_id)::text='' OR s.user_id=sqlc.arg(user_id))
AND (sqlc.arg(mode)::text='' OR s.mode=sqlc.arg(mode)) AND (sqlc.arg(status)::text='' OR s.status=sqlc.arg(status))
AND (sqlc.arg(entry)::text='' OR s.entry=sqlc.arg(entry));
-- name: RecordClear :execrows
INSERT INTO level_clears(user_id,level_id,session_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING;
-- name: ListClears :many
SELECT level_id FROM level_clears WHERE user_id=$1;
