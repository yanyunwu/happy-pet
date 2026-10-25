package httpapi

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"happy-pet/api/internal/config"
	"happy-pet/api/internal/database"
	"happy-pet/api/internal/game"
	"happy-pet/api/internal/users"
	schema "happy-pet/api/sql"
)

func TestAdministratorMigrationPreservesIdentityHistoryAndInvalidatesLegacySessions(t *testing.T) {
	db := legacyProfileStore(t, true)
	ctx := context.Background()
	hash, err := bcrypt.GenerateFromPassword([]byte("legacy-password-123"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	var retainedID string
	if err = db.QueryRow("UPDATE users SET password_hash=$1,wechat_openid='qa-migrated-player' WHERE username='retained-admin' RETURNING id", string(hash)).Scan(&retainedID); err != nil {
		t.Fatal(err)
	}
	pureID, deletedID, assetsID := users.NewID(), users.NewID(), users.NewID()
	for _, item := range []struct {
		id, name, status string
		deleted          bool
	}{{pureID, "pure-admin", "active", false}, {deletedID, "deleted-admin", "disabled", true}, {assetsID, "assets-admin", "active", false}} {
		if _, err = db.Exec("INSERT INTO users(id,username,password_hash,nickname,role,status,session_version,created_at,updated_at,last_login_at,deleted_at) VALUES($1,$2,$3,'旧管理员','admin',$4,9,'2025-01-01Z','2025-02-01Z','2025-02-01Z',CASE WHEN $5 THEN '2025-03-01Z'::timestamptz END)", item.id, item.name, string(hash), item.status, item.deleted); err != nil {
			t.Fatal(err)
		}
	}
	g := game.New(db)
	if _, err = g.SignIn(ctx, assetsID); err != nil {
		t.Fatal(err)
	}
	started, err := g.Start(ctx, retainedID, game.StartInput{Mode: "classic", RequestID: "qa-migrated-session-01"})
	if err != nil {
		t.Fatal(err)
	}
	before := settingsMigrationSnapshot(t, db)
	runner, err := schema.Default()
	if err != nil {
		t.Fatal(err)
	}
	result, err := runner.Apply(ctx, db, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Version != 4 {
		t.Fatalf("admin identity migration missing: version %d", result.Version)
	}
	var count int
	if err = db.QueryRow("SELECT count(*) FROM admin_accounts").Scan(&count); err != nil || count != 4 {
		t.Fatal("legacy administrators not copied", count, err)
	}
	var password, status string
	var created, updated, last time.Time
	var deleted sql.NullTime
	if err = db.QueryRow("SELECT password_hash,status,created_at,updated_at,last_login_at,deleted_at FROM admin_accounts WHERE id=$1", deletedID).Scan(&password, &status, &created, &updated, &last, &deleted); err != nil || password != string(hash) || status != "disabled" || !deleted.Valid || !created.Equal(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)) || !updated.Equal(time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC)) || !last.Equal(updated) {
		t.Fatal("migration changed administrator identity", err)
	}
	if err = db.QueryRow("SELECT count(*) FROM users WHERE id IN ($1,$2)", pureID, deletedID).Scan(&count); err != nil || count != 0 {
		t.Fatal("administrator-only rows retained as players", count, err)
	}
	if err = db.QueryRow("SELECT count(*) FROM users WHERE id IN ($1,$2) AND role='user'", retainedID, assetsID).Scan(&count); err != nil || count != 2 {
		t.Fatal("player identities lost", count, err)
	}
	after := settingsMigrationSnapshot(t, db)
	for table, rows := range before {
		if table != "users" && after[table] != rows {
			t.Fatal("migration changed gameplay or audit data", table)
		}
	}
	if _, err = g.Recovery(ctx, retainedID, started.ID); err != nil {
		t.Fatal("legacy game lost", err)
	}
	u := users.New(db, strings.Repeat("test-secret-", 4), fakeWechat{})
	h := &harness{db: db, users: u, games: g, router: New(u, config.Config{JWTSecret: string(u.Secret)}, nil)}
	w := h.call("POST", "/api/v1/admin/auth/login", map[string]string{"username": "pure-admin", "password": "legacy-password-123"}, "")
	requireStatus(t, w, 200)
	legacy, err := jwt.NewWithClaims(jwt.SigningMethodHS256, users.Claims{Version: 9, RegisteredClaims: jwt.RegisteredClaims{Issuer: "happy-pet", Subject: pureID, Audience: jwt.ClaimStrings{"admin"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}).SignedString(u.Secret)
	if err != nil {
		t.Fatal(err)
	}
	requireStatus(t, adminRequest(h, "GET", "/api/v1/admin/auth/me", nil, "", "", &http.Cookie{Name: cookieName, Value: legacy}), 401)
	player := login(t, h, "qa-migrated-player")
	if player.User.ID != retainedID || player.User.Role != "user" {
		t.Fatal("migrated WeChat player not retained")
	}
	if _, err = runner.Apply(ctx, db, nil); err != nil {
		t.Fatal("repeated migration failed", err)
	}
}

func testDatabaseAddress(t *testing.T, db *sql.DB) string {
	t.Helper()
	base := os.Getenv("API_TEST_DATABASE_URL")
	if base == "" {
		base = "postgres://happy_pet:happy-pet-local-only@127.0.0.1:5432/happy_pet?sslmode=disable"
	}
	address, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	var name string
	if err = db.QueryRow("SELECT current_schema()").Scan(&name); err != nil {
		t.Fatal(err)
	}
	query := address.Query()
	query.Set("search_path", name)
	address.RawQuery = query.Encode()
	return address.String()
}

func TestAdministratorBootstrapUsesOnlyAdminAccountsAndPreservesExistingCredentials(t *testing.T) {
	db := emptyTestStore(t)
	cfg := config.Config{DatabaseURL: testDatabaseAddress(t, db), JWTSecret: strings.Repeat("test-secret-", 4), AdminUsername: "bootstrap-admin", AdminPassword: "bootstrap-password-123"}
	ctx := context.Background()
	opened, result, err := database.Open(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	opened.Close()
	if !result.Fresh || result.Version != 4 {
		t.Fatal("fresh startup did not apply admin migration", result)
	}
	var admins, players int
	var before string
	if err = db.QueryRow("SELECT (SELECT count(*) FROM admin_accounts),(SELECT count(*) FROM users),(SELECT password_hash FROM admin_accounts WHERE username='bootstrap-admin')").Scan(&admins, &players, &before); err != nil || admins != 1 || players != 0 {
		t.Fatal("bootstrap mixed administrator and player identities", admins, players, err)
	}
	cfg.AdminPassword = "replacement-password-123"
	opened, result, err = database.Open(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	opened.Close()
	var after string
	if err = db.QueryRow("SELECT password_hash FROM admin_accounts WHERE username='bootstrap-admin'").Scan(&after); err != nil || before != after || result.Fresh || len(result.Applied) != 0 {
		t.Fatal("existing credentials were reset", err)
	}
	if _, err = db.Exec("DELETE FROM admin_accounts"); err != nil {
		t.Fatal(err)
	}
	if opened, _, err = database.Open(ctx, cfg); err == nil {
		opened.Close()
		t.Fatal("existing database without administrator silently bootstrapped")
	}
}
