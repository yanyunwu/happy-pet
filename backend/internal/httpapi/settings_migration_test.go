package httpapi

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"testing/fstest"
	"time"

	schema "happy-pet/api/sql"
)

func TestAnnouncementMigrationUpgradesExistingProfileSchemaOnce(t *testing.T) {
	db := legacyProfileStore(t, true)
	ctx := context.Background()
	files := fstest.MapFS{}
	for _, name := range []string{"000_schema_migrations.sql", "001_initial.sql", "002_user_avatar_url.sql"} {
		data, err := os.ReadFile("../../sql/migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		files[name] = &fstest.MapFile{Data: data}
	}
	previous, err := schema.New(files)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := previous.Apply(ctx, db, nil); err != nil || result.Version != 2 {
		t.Fatal("cannot build previous release schema", result, err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE users SET avatar_url='https://qlogo.cn/retained/132' WHERE username='retained-admin'"); err != nil {
		t.Fatal(err)
	}
	// Compare every original business row, including JSON configs and timestamps.
	before := settingsMigrationSnapshot(t, db)
	runner, err := schema.Default()
	if err != nil {
		t.Fatal(err)
	}
	result, err := runner.Apply(ctx, db, nil)
	if err != nil || result.Adopted || result.Fresh || result.Version != 3 || len(result.Applied) != 1 || result.Applied[0] != "003_app_settings.sql" {
		t.Fatal("existing profile schema did not apply only the settings migration", result, err)
	}
	after := settingsMigrationSnapshot(t, db)
	for table, rows := range before {
		if after[table] != rows {
			t.Fatal("settings migration modified existing rows", table)
		}
	}
	var content, valueType string
	var version int
	var updatedAt time.Time
	if err := db.QueryRowContext(ctx, "SELECT value->>'content',jsonb_typeof(value),version,updated_at FROM app_settings WHERE key='announcement'").Scan(&content, &valueType, &version, &updatedAt); err != nil || content != initialAnnouncement || valueType != "object" || version != 1 || updatedAt.IsZero() {
		t.Fatal("announcement seed is missing or invalid", content, valueType, version, updatedAt, err)
	}
	var shape string
	if err := db.QueryRowContext(ctx, "SELECT string_agg(column_name || ':' || udt_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='app_settings'").Scan(&shape); err != nil || shape != "key:text,value:jsonb,version:int4,updated_at:timestamptz" {
		t.Fatal("settings table is not generic", shape, err)
	}
	for _, statement := range []string{
		`INSERT INTO app_settings(key,value) VALUES('announcement','{}')`,
		`INSERT INTO app_settings(key,value,version) VALUES('invalid-version','{}',0)`,
		`INSERT INTO app_settings(key,value,version) VALUES('negative-version','{}',-1)`,
		`INSERT INTO app_settings(key,value) VALUES('null-value',NULL)`,
	} {
		if _, err := db.ExecContext(ctx, statement); err == nil {
			t.Fatal("settings storage constraint was not enforced", statement)
		}
	}
	if _, err := db.ExecContext(ctx, `UPDATE app_settings SET value='{"content":"管理员已修改"}',version=2,updated_at='2026-01-02T03:04:05Z' WHERE key='announcement'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO app_settings(key,value) VALUES('future_setting','{"enabled":true,"limit":5}')`); err != nil {
		t.Fatal("generic settings rejected another key", err)
	}
	for range 2 {
		result, err = runner.Apply(ctx, db, nil)
		if err != nil || len(result.Applied) != 0 || result.Version != 3 {
			t.Fatal("repeated startup replayed settings migration", result, err)
		}
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT value->>'content',version,updated_at,(SELECT count(*) FROM app_settings) FROM app_settings WHERE key='announcement'").Scan(&content, &version, &updatedAt, &count); err != nil || content != "管理员已修改" || version != 2 || !updatedAt.Equal(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)) || count != 2 {
		t.Fatal("repeated startup overwrote settings", content, version, updatedAt, count, err)
	}
	var future string
	if err := db.QueryRowContext(ctx, "SELECT value->>'enabled' FROM app_settings WHERE key='future_setting'").Scan(&future); err != nil || future != "true" {
		t.Fatal("repeated startup changed unrelated settings", future, err)
	}
}

func settingsMigrationSnapshot(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	result := map[string]string{}
	for _, table := range []string{"users", "player_assets", "asset_ledger", "levels", "level_revisions", "game_sessions", "game_events", "level_clears", "system_initializations", "level_templates"} {
		var rows string
		if err := db.QueryRowContext(context.Background(), "SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text FROM "+table+" r").Scan(&rows); err != nil {
			t.Fatal(err)
		}
		result[table] = rows
	}
	return result
}
