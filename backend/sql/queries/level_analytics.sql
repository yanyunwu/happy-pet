-- name: LevelAnalyticsSummary :one
SELECT count(*) AS attempts,
 count(DISTINCT s.user_id) AS players,
 count(*) FILTER (WHERE s.status='won') AS won,
 count(*) FILTER (WHERE s.status='lost') AS lost,
 count(*) FILTER (WHERE s.status='abandoned') AS abandoned,
 count(*) FILTER (WHERE s.status='playing') AS unfinished,
 COALESCE(avg(EXTRACT(EPOCH FROM (s.ended_at-s.started_at))) FILTER (
  WHERE s.status='won' AND s.ended_at>=s.started_at
 ),0)::double precision AS avg_win_duration_seconds,
 count(*) FILTER (WHERE s.status='won' AND s.ended_at>=s.started_at) AS win_duration_samples,
 COALESCE(avg((s.state->>'moves')::double precision) FILTER (WHERE s.status='won'),0)::double precision AS avg_win_moves,
 count(s.state->>'moves') FILTER (WHERE s.status='won') AS win_move_samples
FROM game_sessions s
WHERE s.level_id=sqlc.arg(level_id)
 AND (sqlc.arg(revision_id)::text='' OR s.revision_id=sqlc.arg(revision_id))
 AND s.started_at>=sqlc.arg(started_from)::timestamptz
 AND s.started_at<sqlc.arg(started_before)::timestamptz;

-- name: LevelAnalyticsDaily :many
SELECT to_char(s.started_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')::text AS day,
 count(*) AS attempts,
 count(*) FILTER (WHERE s.status='won') AS won,
 count(*) FILTER (WHERE s.status='lost') AS lost,
 count(*) FILTER (WHERE s.status='abandoned') AS abandoned,
 count(*) FILTER (WHERE s.status='playing') AS unfinished
FROM game_sessions s
WHERE s.level_id=sqlc.arg(level_id)
 AND (sqlc.arg(revision_id)::text='' OR s.revision_id=sqlc.arg(revision_id))
 AND s.started_at>=sqlc.arg(started_from)::timestamptz
 AND s.started_at<sqlc.arg(started_before)::timestamptz
GROUP BY 1 ORDER BY 1;

-- name: LevelAnalyticsTools :many
SELECT (e.action->>'type')::text AS tool_type,
 count(*) AS uses,
 count(DISTINCT e.session_id) AS sessions
FROM game_sessions s JOIN game_events e ON e.session_id=s.id
WHERE s.level_id=sqlc.arg(level_id)
 AND (sqlc.arg(revision_id)::text='' OR s.revision_id=sqlc.arg(revision_id))
 AND s.started_at>=sqlc.arg(started_from)::timestamptz
 AND s.started_at<sqlc.arg(started_before)::timestamptz
 AND e.action->>'type' IN ('undo','shovel','hint','shuffle','unlock_slot')
GROUP BY 1;

-- name: ListLevelAnalyticsRevisions :many
SELECT id,version,title,created_at FROM level_revisions WHERE level_id=$1 ORDER BY version DESC;
