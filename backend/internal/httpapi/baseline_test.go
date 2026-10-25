package httpapi

import (
	"context"
	"database/sql"
	"testing"

	"happy-pet/api/internal/game"
	schema "happy-pet/api/sql"
)

func TestFirstDeploymentBaselineAndGenericInitialization(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	var versions string
	if err := h.db.QueryRowContext(ctx, "SELECT string_agg(version::text,',' ORDER BY version) FROM schema_migrations").Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != "0,1" {
		t.Fatalf("first deployment should use only bootstrap + baseline, got %s", versions)
	}
	var tables int
	if err := h.db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'").Scan(&tables); err != nil || tables != 11 {
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
	if err := h.db.QueryRowContext(ctx, "SELECT count(*) FROM system_initializations").Scan(&count); err != nil || count != 3 {
		t.Fatal("unrelated initialization record lost", count, err)
	}
}

func TestAdoptPopulatedFirstDeploymentBaseline(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	// Only this isolated test schema: adoption must not replay template inserts.
	if _, err := h.db.ExecContext(ctx, "DELETE FROM level_templates WHERE id='template-nine-grid'; DROP TABLE schema_migrations"); err != nil {
		t.Fatal(err)
	}
	if err := schema.Initialize(ctx, h.db); err != nil {
		t.Fatal(err)
	}
	if err := game.Seed(ctx, h.db); err != nil {
		t.Fatal(err)
	}
	var templates, levels, admins int
	if err := h.db.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM level_templates),(SELECT count(*) FROM levels),(SELECT count(*) FROM users WHERE role='admin')").Scan(&templates, &levels, &admins); err != nil {
		t.Fatal(err)
	}
	if templates != 2 || levels != 12 || admins != 1 {
		t.Fatal("adoption reset existing records", templates, levels, admins)
	}
}
