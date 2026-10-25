package httpapi

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"testing/fstest"

	"happy-pet/api/internal/game"
	"happy-pet/api/internal/users"
	schema "happy-pet/api/sql"
)

func TestFirstDeploymentBaselineAndGenericInitialization(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	var versions string
	if err := h.db.QueryRowContext(ctx, "SELECT string_agg(version::text,',' ORDER BY version) FROM schema_migrations").Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != "0,1,2,3,4" {
		t.Fatalf("first deployment must include the profile, settings and admin migrations, got %s", versions)
	}
	var tables int
	if err := h.db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'").Scan(&tables); err != nil || tables != 13 {
		t.Fatal("baseline table inventory", tables, err)
	}
	var old sql.NullString
	if err := h.db.QueryRowContext(ctx, "SELECT to_regclass('level_catalog_seeds')::text").Scan(&old); err != nil || old.Valid {
		t.Fatal("catalog-specific table still exists", err)
	}
	var count int
	if err := h.db.QueryRowContext(ctx, "SELECT count(*) FROM system_initializations WHERE init_key IN ('level_catalog:standard','level_catalog:campaign') AND recorded_at IS NOT NULL").Scan(&count); err != nil || count != 2 {
		t.Fatal("catalog initialization records missing", count, err)
	}
	if _, err := h.db.ExecContext(ctx, "INSERT INTO system_initializations(init_key) VALUES('pet_album:defaults:v1')"); err != nil {
		t.Fatal("generic initialization key rejected", err)
	}
	if err := game.Seed(ctx, h.db); err != nil {
		t.Fatal(err)
	}
	if err := h.db.QueryRowContext(ctx, "SELECT count(*) FROM levels").Scan(&count); err != nil || count != 12 {
		t.Fatal("repeated startup changed levels", count, err)
	}
	if err := h.db.QueryRowContext(ctx, "SELECT count(*) FROM system_initializations").Scan(&count); err != nil || count != 4 {
		t.Fatal("unrelated initialization record lost", count, err)
	}
}

func TestAdoptPopulatedFirstDeploymentBaseline(t *testing.T) {
	db := legacyProfileStore(t, false)
	ctx := context.Background()
	// Only this isolated test schema: adoption must not replay template inserts.
	if _, err := db.ExecContext(ctx, "DELETE FROM level_templates WHERE id='template-nine-grid'"); err != nil {
		t.Fatal(err)
	}
	runner, err := schema.Default()
	if err != nil {
		t.Fatal(err)
	}
	result, err := runner.Apply(ctx, db, nil)
	if err != nil || !result.Adopted || result.Fresh || result.Version != 4 || len(result.Applied) != 3 || result.Applied[0] != "002_user_avatar_url.sql" || result.Applied[1] != "003_app_settings.sql" || result.Applied[2] != "004_admin_accounts.sql" {
		t.Fatal("baseline adoption did not apply the expected upgrades", result, err)
	}
	if err := game.Seed(ctx, db); err != nil {
		t.Fatal(err)
	}
	var templates, levels, admins int
	if err := db.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM level_templates),(SELECT count(*) FROM levels),(SELECT count(*) FROM admin_accounts)").Scan(&templates, &levels, &admins); err != nil {
		t.Fatal(err)
	}
	if templates != 2 || levels != 12 || admins != 1 {
		t.Fatal("adoption reset existing records", templates, levels, admins)
	}
	assertLegacyProfileRetained(t, db)
}

func TestProfileMigrationUpgradesTrackedBaselineOnce(t *testing.T) {
	db := legacyProfileStore(t, true)
	ctx := context.Background()
	var baselineChecksum string
	if err := db.QueryRowContext(ctx, "SELECT checksum FROM schema_migrations WHERE version=1").Scan(&baselineChecksum); err != nil {
		t.Fatal(err)
	}
	runner, err := schema.Default()
	if err != nil {
		t.Fatal(err)
	}
	result, err := runner.Apply(ctx, db, nil)
	if err != nil || result.Adopted || result.Fresh || result.Version != 4 || len(result.Applied) != 3 || result.Applied[0] != "002_user_avatar_url.sql" || result.Applied[1] != "003_app_settings.sql" || result.Applied[2] != "004_admin_accounts.sql" {
		t.Fatal("tracked baseline did not upgrade exactly once", result, err)
	}
	assertLegacyProfileRetained(t, db)
	var afterChecksum string
	if err = db.QueryRowContext(ctx, "SELECT checksum FROM schema_migrations WHERE version=1").Scan(&afterChecksum); err != nil || afterChecksum != baselineChecksum {
		t.Fatal("upgrade rewrote baseline history", afterChecksum, err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE users SET avatar_url='https://qlogo.cn/retained/132' WHERE username='retained-admin'"); err != nil {
		t.Fatal(err)
	}
	result, err = runner.Apply(ctx, db, nil)
	if err != nil || len(result.Applied) != 0 || result.Version != 4 {
		t.Fatal("repeated startup replayed migrations", result, err)
	}
	var avatar string
	if err = db.QueryRowContext(ctx, "SELECT avatar_url FROM users WHERE username='retained-admin'").Scan(&avatar); err != nil || avatar != "https://qlogo.cn/retained/132" {
		t.Fatal("repeated startup reset the avatar", avatar, err)
	}
}

func TestProfileMigrationStillRejectsUntrackedSchemaDrift(t *testing.T) {
	db := legacyProfileStore(t, false)
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, "ALTER TABLE users ADD COLUMN unexpected_profile_field text"); err != nil {
		t.Fatal(err)
	}
	if err := schema.Initialize(ctx, db); err == nil {
		t.Fatal("schema drift was adopted")
	}
	var ledger sql.NullString
	var nickname string
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('schema_migrations')::text,(SELECT nickname FROM users WHERE username='retained-admin')").Scan(&ledger, &nickname); err != nil || ledger.Valid || nickname != "保留昵称" {
		t.Fatal("failed adoption modified the legacy database", ledger, nickname, err)
	}
}

// Construct the actual released 001 schema, not a current schema with its
// ledger deleted: later columns must never weaken strict baseline adoption.
func legacyProfileStore(t *testing.T, tracked bool) *sql.DB {
	t.Helper()
	db := emptyTestStore(t)
	ctx := context.Background()
	files := fstest.MapFS{}
	for _, name := range []string{"000_schema_migrations.sql", "001_initial.sql"} {
		data, err := os.ReadFile("../../sql/migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		files[name] = &fstest.MapFile{Data: data}
	}
	if tracked {
		runner, err := schema.New(files)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = runner.Apply(ctx, db, nil); err != nil {
			t.Fatal(err)
		}
	} else if _, err := db.ExecContext(ctx, string(files["001_initial.sql"].Data)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO users(id,username,nickname,role,avatar_media_id,session_version,remark) VALUES($1,'retained-admin','保留昵称','admin','retained-media',7,'保留备注')", users.NewID()); err != nil {
		t.Fatal(err)
	}
	if err := game.Seed(ctx, db); err != nil {
		t.Fatal(err)
	}
	return db
}

func assertLegacyProfileRetained(t *testing.T, db *sql.DB) {
	t.Helper()
	var nickname, avatar, media, remark string
	var sessionVersion int
	if err := db.QueryRowContext(context.Background(), "SELECT nickname,avatar_url,avatar_media_id,session_version,remark FROM users WHERE username='retained-admin' AND role='user'").Scan(&nickname, &avatar, &media, &sessionVersion, &remark); err != nil || nickname != "保留昵称" || avatar != "" || media != "retained-media" || sessionVersion != 8 || remark != "保留备注" {
		t.Fatal("profile migration lost legacy data", nickname, avatar, media, sessionVersion, remark, err)
	}
	if err := db.QueryRowContext(context.Background(), "SELECT nickname,remark,session_version FROM admin_accounts WHERE username='retained-admin'").Scan(&nickname, &remark, &sessionVersion); err != nil || nickname != "保留昵称" || remark != "保留备注" || sessionVersion != 7 {
		t.Fatal("administrator profile was not preserved", err)
	}
}
