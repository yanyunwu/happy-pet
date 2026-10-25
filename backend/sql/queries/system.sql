-- name: HasSystemInitialization :one
SELECT EXISTS(SELECT 1 FROM system_initializations WHERE init_key=$1);

-- name: RecordSystemInitialization :exec
INSERT INTO system_initializations(init_key) VALUES($1) ON CONFLICT DO NOTHING;
