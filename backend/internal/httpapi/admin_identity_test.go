package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"happy-pet/api/internal/admins"
	"happy-pet/api/internal/game"
	"happy-pet/api/internal/users"
)

func adminRequest(h *harness, method, path string, body any, token, target string, cookie *http.Cookie) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(b))
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	if target != "" {
		r.Header.Set("X-User-ID", target)
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.router.ServeHTTP(w, r)
	return w
}

func TestAdministratorLastActiveProtectionIsConcurrent(t *testing.T) {
	h := setup(t)
	service := admins.New(h.db, string(h.users.Secret))
	created, err := service.Create(context.Background(), admins.CreateInput{Username: "concurrent-admin", Password: "concurrent-password-123", Nickname: "并发管理员"})
	if err != nil {
		t.Fatal(err)
	}
	self := decode[map[string]any](t, h.call("GET", "/api/v1/admin/auth/me", nil, "admin"), 200)
	status := "disabled"
	results := make(chan error, 2)
	var ready sync.WaitGroup
	start := make(chan struct{})
	for _, id := range []string{created.ID, self["id"].(string)} {
		ready.Add(1)
		go func() {
			ready.Done()
			<-start
			_, err := service.Update(context.Background(), id, admins.UpdateInput{Status: &status})
			results <- err
		}()
	}
	ready.Wait()
	close(start)
	success := 0
	for range 2 {
		if err := <-results; err == nil {
			success++
		}
	}
	count, err := service.Q.CountActiveAdminAccounts(context.Background())
	if err != nil || success != 1 || count != 1 {
		t.Fatal("concurrent updates removed last administrator", success, count, err)
	}
}

func TestAdministratorTokenRotationRejectsStaleTokenManagement(t *testing.T) {
	for _, operation := range []string{"rotate", "revoke"} {
		t.Run(operation, func(t *testing.T) {
			h := setup(t)
			old := tokenFor(t, h, h.cookie, "")
			service := admins.New(h.db, string(h.users.Secret))
			principal, err := service.AuthenticateAccessToken(context.Background(), old)
			if err != nil {
				t.Fatal(err)
			}
			current := tokenFor(t, h, h.cookie, "")
			if operation == "rotate" {
				_, err = service.SetAccessToken(context.Background(), principal, "")
			} else {
				err = service.RevokeAccessToken(context.Background(), principal)
			}
			if err == nil {
				t.Fatal("stale authenticated token modified the replacement token")
			}
			requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, current), 200)
		})
	}
}

func TestAdministratorTokenRejectsNullAndNonStringInput(t *testing.T) {
	h := setup(t)
	for _, input := range []any{nil, 123, true, []string{"token"}} {
		requireStatus(t, h.call("PUT", "/api/v1/admin/auth/access-token", map[string]any{"accessToken": input}, "admin"), 400)
	}
}

func requireStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status %d expected %d: %s", w.Code, want, w.Body.String())
	}
}

func tokenFor(t *testing.T, h *harness, cookie *http.Cookie, value string) string {
	t.Helper()
	v := decode[map[string]any](t, adminRequest(h, "PUT", "/api/v1/admin/auth/access-token", map[string]string{"accessToken": value}, "", "", cookie), 200)
	token, _ := v["accessToken"].(string)
	if len(token) < 32 || len(token) > 128 || v["hint"] == token || v["updatedAt"] == nil {
		t.Fatal("invalid token response")
	}
	return token
}

func TestAdministratorAndPlayerAccountsAreSeparate(t *testing.T) {
	h := setup(t)
	page := decode[users.Page](t, h.call("GET", "/api/v1/admin/users", nil, "admin"), 200)
	if page.Total != 0 {
		t.Fatal("administrator leaked into player list", page.Total)
	}
	accounts := decode[map[string]any](t, h.call("GET", "/api/v1/admin/accounts", nil, "admin"), 200)
	if accounts["total"] != float64(1) {
		t.Fatal("initial administrator missing")
	}
	created := decode[users.User](t, h.call("POST", "/api/v1/admin/users", users.CreateInput{Username: "manual-player", Password: "player-password-123", Nickname: "普通玩家"}, "admin"), 201)
	if created.Role != "user" {
		t.Fatal("player creation grants administrator authority")
	}
	requireStatus(t, h.call("POST", "/api/v1/admin/auth/login", map[string]string{"username": "manual-player", "password": "player-password-123"}, ""), 401)
	var adminsInUsers int
	if err := h.db.QueryRow("SELECT count(*) FROM users WHERE role <> 'user'").Scan(&adminsInUsers); err != nil || adminsInUsers != 0 {
		t.Fatal("non-player rows remain", err)
	}
	if _, err := h.db.Exec("UPDATE users SET role='admin' WHERE id=$1", created.ID); err == nil {
		t.Fatal("database still permits player promotion")
	}
}

func TestAdministratorAccessTokenLifecycleAndExplicitBearerPrecedence(t *testing.T) {
	h := setup(t)
	info := decode[map[string]any](t, h.call("GET", "/api/v1/admin/auth/access-token", nil, "admin"), 200)
	if info["configured"] != false || info["hint"] != "" || info["updatedAt"] != nil {
		t.Fatal("unexpected initial token state", info)
	}
	token := tokenFor(t, h, h.cookie, "")
	me := decode[map[string]any](t, h.call("GET", "/api/v1/admin/auth/me", nil, token), 200)
	for _, key := range []string{"passwordHash", "password_hash", "accessToken", "accessTokenHash", "access_token_hash"} {
		if _, exists := me[key]; exists {
			t.Fatal("credential leaked", key)
		}
	}
	var digest, hint string
	if err := h.db.QueryRow("SELECT access_token_hash,access_token_hint FROM admin_accounts WHERE id=$1", me["id"]).Scan(&digest, &hint); err != nil {
		t.Fatal(err)
	}
	want := sha256.Sum256([]byte(token))
	if digest != hex.EncodeToString(want[:]) || strings.Contains(hint, token) {
		t.Fatal("token was not stored as a digest")
	}
	statusBody := h.call("GET", "/api/v1/admin/auth/access-token", nil, "admin")
	requireStatus(t, statusBody, 200)
	if strings.Contains(statusBody.Body.String(), token) || strings.Contains(statusBody.Body.String(), digest) {
		t.Fatal("token status leaked credentials")
	}
	requireStatus(t, adminRequest(h, "GET", "/api/v1/admin/auth/me", nil, "invalid-explicit-token", "", h.cookie), 401)
	for _, header := range []string{"", "Basic invalid", "Bearer", "Bearer first second"} {
		r := httptest.NewRequest("GET", "/api/v1/admin/auth/me", nil)
		r.AddCookie(h.cookie)
		r.Header.Set("Authorization", header)
		w := httptest.NewRecorder()
		h.router.ServeHTTP(w, r)
		requireStatus(t, w, 401)
	}
	requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, h.cookie.Value), 401)
	custom := strings.Repeat("new-token-", 5)
	if got := tokenFor(t, h, h.cookie, custom); got != custom {
		t.Fatal("custom token changed")
	}
	requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, token), 401)
	requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, custom), 200)
	for _, invalid := range []string{"short", strings.Repeat("x", 129), strings.Repeat("a", 31) + " ", strings.Repeat("a", 31) + "\n", strings.Repeat("界", 32)} {
		requireStatus(t, h.call("PUT", "/api/v1/admin/auth/access-token", map[string]string{"accessToken": invalid}, "admin"), 400)
	}
	requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, custom), 200)
	requireStatus(t, h.call("DELETE", "/api/v1/admin/auth/access-token", nil, "admin"), 204)
	requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, custom), 401)
	info = decode[map[string]any](t, h.call("GET", "/api/v1/admin/auth/access-token", nil, "admin"), 200)
	if info["configured"] != false || info["hint"] != "" || info["updatedAt"] != nil {
		t.Fatal("revocation retained token metadata", info)
	}
}

func TestAdministratorTokenTargetsPlayersAndPreservesOwnershipRules(t *testing.T) {
	h := setup(t)
	token := tokenFor(t, h, h.cookie, "")
	a := login(t, h, "qa-token-target-a")
	b := login(t, h, "qa-token-target-b")
	requireStatus(t, h.call("GET", "/api/v1/user/me", nil, token), 400)
	requireStatus(t, adminRequest(h, "GET", "/api/v1/user/me", nil, token, "invalid", nil), 400)
	requireStatus(t, adminRequest(h, "GET", "/api/v1/user/me", nil, token, users.NewID(), nil), 404)
	requireStatus(t, adminRequest(h, "GET", "/api/v1/user/me", nil, a.AccessToken, b.User.ID, nil), 403)
	me := decode[users.User](t, adminRequest(h, "GET", "/api/v1/user/me", nil, token, a.User.ID, nil), 200)
	if me.ID != a.User.ID {
		t.Fatal("wrong target")
	}
	for _, path := range []string{"/api/v1/admin/users", "/api/v1/admin/users/stats", "/api/v1/admin/accounts", "/api/v1/admin/levels", "/api/v1/admin/level-templates", "/api/v1/admin/sessions", "/api/v1/admin/settings", "/api/v1/admin/users/" + a.User.ID + "/assets", "/api/v1/admin/users/" + a.User.ID + "/ledger"} {
		requireStatus(t, h.call("GET", path, nil, token), 200)
	}
	for _, path := range []string{"/api/v1/user/me", "/api/v1/user/assets", "/api/v1/user/levels"} {
		requireStatus(t, adminRequest(h, "GET", path, nil, token, a.User.ID, nil), 200)
	}
	requireStatus(t, adminRequest(h, "POST", "/api/v1/user/signin", map[string]any{}, token, a.User.ID, nil), 200)
	requireStatus(t, adminRequest(h, "PATCH", "/api/v1/user/me", map[string]string{"nickname": "令牌玩家"}, token, a.User.ID, nil), 200)
	session := decode[game.SessionView](t, adminRequest(h, "POST", "/api/v1/user/sessions", game.StartInput{Mode: "classic", RequestID: "qa-token-session-01"}, token, a.User.ID, nil), 200)
	requireStatus(t, adminRequest(h, "GET", "/api/v1/user/sessions/"+session.ID, nil, token, a.User.ID, nil), 200)
	requireStatus(t, adminRequest(h, "GET", "/api/v1/user/sessions/"+session.ID, nil, token, b.User.ID, nil), 404)
	requireStatus(t, adminRequest(h, "POST", "/api/v1/user/sessions/"+session.ID+"/finish", map[string]string{"outcome": "won"}, token, a.User.ID, nil), 409)
	requireStatus(t, adminRequest(h, "POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []game.Action{{Seq: 5, Type: "pick", TileID: 0}}}, token, a.User.ID, nil), 409)
	requireStatus(t, h.call("GET", "/api/v1/admin/sessions/"+session.ID+"/replay", nil, token), 200)
	_, route, err := game.NewBoard(game.DefaultConfig("classic", 1), uint32(session.Seed))
	if err != nil {
		t.Fatal(err)
	}
	events := make([]game.Action, 0, len(route))
	for i, id := range route {
		events = append(events, game.Action{Seq: i + 1, Type: "pick", TileID: id, At: int64(i * 200)})
	}
	requireStatus(t, adminRequest(h, "POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": events}, token, a.User.ID, nil), 200)
	requireStatus(t, adminRequest(h, "POST", "/api/v1/user/sessions/"+session.ID+"/finish", map[string]string{"outcome": "won"}, token, a.User.ID, nil), 200)
	requireStatus(t, adminRequest(h, "POST", "/api/v1/user/logout", nil, token, b.User.ID, nil), 204)
	requireStatus(t, h.call("GET", "/api/v1/user/me", nil, b.AccessToken), 401)
	requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, token), 200)
	if _, err := h.users.Update(context.Background(), a.User.ID, users.UpdateInput{Nickname: a.User.Nickname, Status: "disabled"}); err != nil {
		t.Fatal(err)
	}
	requireStatus(t, adminRequest(h, "GET", "/api/v1/user/assets", nil, token, a.User.ID, nil), 404)
}

func TestAdministratorTokenWritesKeepAdministratorAuditIdentity(t *testing.T) {
	h := setup(t)
	token := tokenFor(t, h, h.cookie, "")
	player := login(t, h, "qa-token-audit-player")
	admin := decode[map[string]any](t, h.call("GET", "/api/v1/admin/auth/me", nil, token), 200)
	adminID := admin["id"].(string)
	requestID := "qa-token-audit-adjust-01"
	adjust := game.Adjustment{RequestID: requestID, Asset: "coins", Delta: 25, Reason: "管理员令牌补偿"}
	requireStatus(t, h.call("POST", "/api/v1/admin/users/"+player.User.ID+"/assets", adjust, token), 200)
	var actor string
	if err := h.db.QueryRow("SELECT actor_id FROM asset_ledger WHERE user_id=$1 AND request_key=$2", player.User.ID, "admin:"+requestID).Scan(&actor); err != nil || actor != adminID {
		t.Fatal("asset audit lost administrator identity", err)
	}
	settings := decode[announcementSettings](t, h.call("GET", "/api/v1/admin/settings", nil, token), 200)
	requireStatus(t, h.call("PUT", "/api/v1/admin/settings", map[string]any{"announcement": "访问令牌公告", "version": settings.Version}, token), 200)
	created := decode[map[string]any](t, h.call("POST", "/api/v1/admin/accounts", admins.CreateInput{Username: "token-created-admin", Password: "token-created-password", Nickname: "令牌管理员"}, token), 201)
	requireStatus(t, h.call("PATCH", "/api/v1/admin/accounts/"+created["id"].(string), map[string]string{"remark": "令牌修改"}, token), 200)
	requireStatus(t, h.call("DELETE", "/api/v1/admin/accounts/"+created["id"].(string), nil, token), 204)
	level := decode[game.LevelView](t, h.call("POST", "/api/v1/admin/levels", game.DraftInput{Mode: "classic", Ordinal: 3, Title: "访问令牌关卡", Config: game.DefaultConfig("classic", 1)}, token), 200)
	requireStatus(t, h.call("POST", "/api/v1/admin/levels/"+level.ID+"/publish", map[string]any{"draftVersion": level.DraftVersion}, token), 200)
	if err := h.db.QueryRow("SELECT created_by FROM level_revisions WHERE level_id=$1 ORDER BY version DESC LIMIT 1", level.ID).Scan(&actor); err != nil || actor != adminID {
		t.Fatal("publication audit lost administrator identity", err)
	}
}

func TestPersonalPasswordChangeRevokesCredentialsAndRequiresCurrentPassword(t *testing.T) {
	h := setup(t)
	token := tokenFor(t, h, h.cookie, "")
	for _, body := range []map[string]string{{"currentPassword": "wrong-password", "password": "new-password-123"}, {"currentPassword": "qa-password-123", "password": "short"}} {
		w := h.call("POST", "/api/v1/admin/auth/password", body, "admin")
		if w.Code != 400 && w.Code != 401 {
			t.Fatal("invalid password update accepted", w.Code)
		}
	}
	requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, token), 200)
	w := h.call("POST", "/api/v1/admin/auth/password", map[string]string{"currentPassword": "qa-password-123", "password": "new-password-123"}, "admin")
	requireStatus(t, w, 204)
	if len(w.Result().Cookies()) != 1 || w.Result().Cookies()[0].MaxAge >= 0 {
		t.Fatal("password change did not clear cookie")
	}
	requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, "admin"), 401)
	requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, token), 401)
	requireStatus(t, h.call("POST", "/api/v1/admin/auth/login", map[string]string{"username": "qa-admin", "password": "qa-password-123"}, ""), 401)
	requireStatus(t, h.call("POST", "/api/v1/admin/auth/login", map[string]string{"username": "qa-admin", "password": "new-password-123"}, ""), 200)
}

func TestAdministratorCRUDGuardsLastActiveAndRevokesChangedAccounts(t *testing.T) {
	h := setup(t)
	self := decode[map[string]any](t, h.call("GET", "/api/v1/admin/auth/me", nil, "admin"), 200)
	selfID := self["id"].(string)
	requireStatus(t, h.call("DELETE", "/api/v1/admin/accounts/"+selfID, nil, "admin"), 409)
	requireStatus(t, h.call("PATCH", "/api/v1/admin/accounts/"+selfID, map[string]string{"nickname": "管理员", "status": "disabled", "remark": ""}, "admin"), 409)
	created := decode[map[string]any](t, h.call("POST", "/api/v1/admin/accounts", users.CreateInput{Username: "second-admin", Password: "second-password-123", Nickname: "第二管理员", Remark: "账号备注"}, "admin"), 201)
	id := created["id"].(string)
	requireStatus(t, h.call("GET", "/api/v1/admin/accounts/"+id, nil, "admin"), 200)
	requireStatus(t, h.call("GET", "/api/v1/admin/users/"+id, nil, "admin"), 404)
	page := decode[map[string]any](t, h.call("GET", "/api/v1/admin/accounts?q=second-admin&page=1&pageSize=1", nil, "admin"), 200)
	if page["total"] != float64(1) || len(page["items"].([]any)) != 1 {
		t.Fatal("account filtering is wrong")
	}
	loginAdmin := func(password string) *http.Cookie {
		w := h.call("POST", "/api/v1/admin/auth/login", map[string]string{"username": "second-admin", "password": password}, "")
		requireStatus(t, w, 200)
		return w.Result().Cookies()[0]
	}
	secondCookie := loginAdmin("second-password-123")
	token := tokenFor(t, h, secondCookie, strings.Repeat("same-token-", 5))
	requireStatus(t, h.call("PUT", "/api/v1/admin/auth/access-token", map[string]string{"accessToken": token}, "admin"), 409)
	checkRevoked := func() {
		requireStatus(t, h.call("GET", "/api/v1/admin/auth/me", nil, token), 401)
		requireStatus(t, adminRequest(h, "GET", "/api/v1/admin/auth/me", nil, "", "", secondCookie), 401)
	}
	requireStatus(t, h.call("PATCH", "/api/v1/admin/accounts/"+id, map[string]string{"nickname": "第二管理员", "status": "disabled", "remark": "停用"}, "admin"), 200)
	checkRevoked()
	requireStatus(t, h.call("PATCH", "/api/v1/admin/accounts/"+id, map[string]string{"nickname": "第二管理员", "status": "active", "remark": ""}, "admin"), 200)
	checkRevoked()
	secondCookie = loginAdmin("second-password-123")
	token = tokenFor(t, h, secondCookie, "")
	requireStatus(t, h.call("POST", "/api/v1/admin/accounts/"+id+"/password", map[string]string{"password": "reset-password-123"}, "admin"), 204)
	checkRevoked()
	secondCookie = loginAdmin("reset-password-123")
	token = tokenFor(t, h, secondCookie, "")
	requireStatus(t, h.call("DELETE", "/api/v1/admin/accounts/"+id, nil, "admin"), 204)
	checkRevoked()
	deleted := decode[map[string]any](t, h.call("GET", "/api/v1/admin/accounts?status=deleted", nil, "admin"), 200)
	if deleted["total"] != float64(1) {
		t.Fatal("deleted administrator missing")
	}
	restored := decode[map[string]any](t, h.call("POST", "/api/v1/admin/accounts/"+id+"/restore", nil, "admin"), 200)
	if restored["status"] != "disabled" || restored["deletedAt"] != nil {
		t.Fatal("restore should require deliberate enable")
	}
	checkRevoked()
}
