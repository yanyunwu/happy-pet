-- Titles belong to the published revision, just like the board and reward.
ALTER TABLE level_revisions ADD COLUMN title TEXT NOT NULL DEFAULT '';
UPDATE level_revisions r SET title=l.title FROM levels l WHERE l.id=r.level_id;
ALTER TABLE game_sessions ADD COLUMN title TEXT NOT NULL DEFAULT '';
UPDATE game_sessions s SET title=r.title FROM level_revisions r WHERE r.id=s.revision_id;
