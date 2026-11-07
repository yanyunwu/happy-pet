-- Preserve the inventory-use policy of legacy sessions before deleting actions.
UPDATE game_sessions s
SET state = jsonb_set(s.state, '{bagUsed}', COALESCE((
    SELECT jsonb_object_agg(t.tool, true)
    FROM (
        SELECT DISTINCT CASE WHEN e.action->>'type' = 'draw' THEN 'hint' ELSE e.action->>'type' END AS tool
        FROM game_events e
        JOIN asset_ledger l ON l.user_id = s.user_id
          AND l.request_key = 'session:' || s.id || ':' || e.seq::text
        WHERE e.session_id = s.id
          AND (s.state->'tools') ? (CASE WHEN e.action->>'type' = 'draw' THEN 'hint' ELSE e.action->>'type' END)
    ) t
), '{}'::jsonb), true)
WHERE (s.state->'bagUsed' IS NULL OR s.state->'bagUsed' = 'null'::jsonb)
  AND EXISTS (SELECT 1 FROM game_events e WHERE e.session_id=s.id AND e.action->>'type'='hint');

-- Remove only the inventory charges tied to old hint actions.  Current
-- balances and all draw, award, and other tool ledger rows remain unchanged.
DELETE FROM asset_ledger l
USING game_events e, game_sessions s
WHERE e.action->>'type'='hint' AND s.id=e.session_id AND l.user_id=s.user_id
  AND l.asset='hint'
  AND l.request_key='session:' || e.session_id || ':' || e.seq::text;

DELETE FROM game_events WHERE action->>'type'='hint';
