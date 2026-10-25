package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"happy-pet/api/internal/config"
	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/game"
	"happy-pet/api/internal/users"
	schema "happy-pet/api/sql"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
)

type fakeWechat struct{}

func (fakeWechat) Exchange(_ context.Context, code string) (users.WechatIdentity, error) {
	if !strings.HasPrefix(code, "qa-") {
		return users.WechatIdentity{}, users.Invalid("测试凭证无效")
	}
	return users.WechatIdentity{OpenID: code}, nil
}
func testStore(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("API_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://happy_pet:happy-pet-local-only@127.0.0.1:5432/happy_pet?sslmode=disable"
	}
	ctx := context.Background()
	base, e := users.Open(ctx, dsn)
	if e != nil {
		t.Fatalf("start isolated development database with make db-up: %v", e)
	}
	name := "qa_" + users.NewID()
	if _, e = base.ExecContext(ctx, `CREATE SCHEMA "`+name+`"`); e != nil {
		t.Fatal(e)
	}
	address, _ := url.Parse(dsn)
	query := address.Query()
	query.Set("search_path", name)
	address.RawQuery = query.Encode()
	db, e := users.Open(ctx, address.String())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close(); _, _ = base.ExecContext(ctx, `DROP SCHEMA "`+name+`" CASCADE`); base.Close() })
	if e = schema.Initialize(ctx, db); e != nil {
		t.Fatal(e)
	}
	if e = game.Seed(ctx, db); e != nil {
		t.Fatal(e)
	}
	return db
}

type harness struct {
	db     *sql.DB
	router http.Handler
	users  *users.Service
	games  *game.Service
	cookie *http.Cookie
}

func setup(t *testing.T) *harness {
	db := testStore(t)
	u := users.New(db, strings.Repeat("test-secret-", 4), fakeWechat{})
	_, e := u.Create(context.Background(), users.CreateInput{Username: "qa-admin", Password: "qa-password-123", Nickname: "测试管理员"}, "admin")
	if e != nil {
		t.Fatal(e)
	}
	cfg := config.Config{JWTSecret: strings.Repeat("test-secret-", 4), AdminOrigin: "http://127.0.0.1:5173"}
	h := &harness{db: db, users: u, games: game.New(db), router: New(u, cfg, nil)}
	w := h.call("POST", "/api/v1/admin/auth/login", map[string]any{"username": "qa-admin", "password": "qa-password-123"}, "")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	h.cookie = w.Result().Cookies()[0]
	return h
}
func (h *harness) call(method, path string, body any, token string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(b))
	r.Header.Set("Content-Type", "application/json")
	if token == "admin" && h.cookie != nil {
		r.AddCookie(h.cookie)
	} else if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.router.ServeHTTP(w, r)
	return w
}
func decode[T any](t *testing.T, w *httptest.ResponseRecorder, want int) T {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status %d expected %d: %s", w.Code, want, w.Body.String())
	}
	var v T
	if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
		t.Fatal(e)
	}
	return v
}
func login(t *testing.T, h *harness, code string) users.Session {
	return decode[users.Session](t, h.call("POST", "/api/v1/auth/wechat", map[string]string{"code": code}, ""), 200)
}
func TestGameLifecycleAndIsolation(t *testing.T) {
	h := setup(t)
	a := login(t, h, "qa-player-a")
	b := login(t, h, "qa-player-b")
	again := login(t, h, "qa-player-a")
	if again.User.ID != a.User.ID {
		t.Fatal("duplicate player")
	}
	if h.call("GET", "/api/v1/admin/users", nil, a.AccessToken).Code != 401 {
		t.Fatal("player entered admin")
	}
	var wg sync.WaitGroup
	errors := make(chan string, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := h.call("POST", "/api/v1/user/signin", map[string]any{}, a.AccessToken)
			if w.Code != 200 {
				errors <- w.Body.String()
			}
		}()
	}
	wg.Wait()
	close(errors)
	for e := range errors {
		t.Fatal(e)
	}
	assets := decode[game.Assets](t, h.call("GET", "/api/v1/user/assets", nil, a.AccessToken), 200)
	if assets.Coins != 20 || assets.Bag["hint"] != 1 || assets.SignInCount != 1 {
		t.Fatal("signin duplicated", assets)
	}
	adjust := game.Adjustment{RequestID: "qa-adjustment-000001", Asset: "coins", Delta: 50, Reason: "测试资产补偿"}
	for i := 0; i < 2; i++ {
		decode[game.Assets](t, h.call("POST", "/api/v1/admin/users/"+a.User.ID+"/assets", adjust, "admin"), 200)
	}
	adjust.Delta = 51
	if h.call("POST", "/api/v1/admin/users/"+a.User.ID+"/assets", adjust, "admin").Code != 409 {
		t.Fatal("changed idempotent payload")
	}
	assets = decode[game.Assets](t, h.call("GET", "/api/v1/user/assets", nil, a.AccessToken), 200)
	if assets.Coins != 70 {
		t.Fatal("duplicate grant")
	}
	for _, mode := range []string{"classic", "quartet", "fun"} {
		start := game.StartInput{Mode: mode, RequestID: "qa-start-unique-" + mode}
		session := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", start, a.AccessToken), 200)
		repeat := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", start, a.AccessToken), 200)
		if repeat.ID != session.ID {
			t.Fatal("start duplicate")
		}
		if h.call("POST", "/api/v1/user/sessions/"+session.ID+"/finish", map[string]string{"outcome": "won"}, a.AccessToken).Code != 409 {
			t.Fatal("forged win accepted")
		}
		if h.call("POST", "/api/v1/user/sessions/"+session.ID+"/finish", map[string]string{"outcome": "abandoned"}, b.AccessToken).Code != 404 {
			t.Fatal("cross player access")
		}
		c := game.DefaultConfig(mode, 1)
		_, route, e := game.NewBoard(c, uint32(session.Seed))
		if e != nil {
			t.Fatal(e)
		}
		events := []game.Action{}
		for i, id := range route {
			events = append(events, game.Action{Seq: i + 1, Type: "pick", TileID: id, At: int64(i * 200)})
		}
		batch := map[string]any{"events": events}
		result := decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", batch, a.AccessToken), 200)
		if result.State.Status != "won" {
			t.Fatal("not won")
		}
		decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", batch, a.AccessToken), 200)
		win := decode[game.FinishResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/finish", map[string]string{"outcome": "won"}, a.AccessToken), 200)
		win2 := decode[game.FinishResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/finish", map[string]string{"outcome": "won"}, a.AccessToken), 200)
		if win.RewardCoins != 10 || !win.HasNext || win.Assets.Coins != win2.Assets.Coins {
			t.Fatal("settlement invalid")
		}
		replay := decode[map[string]any](t, h.call("GET", "/api/v1/admin/sessions/"+session.ID+"/replay", nil, "admin"), 200)
		if len(replay["events"].([]any)) != len(route) {
			t.Fatal("replay steps")
		}
		second := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Mode: mode, PreviousSessionID: session.ID, RequestID: "qa-second-unique-" + mode}, a.AccessToken), 200)
		if second.Ordinal != 2 || len(second.State.Tiles) != 108 {
			t.Fatal("not continuous stage 2")
		}
		species := map[int]bool{}
		for _, tile := range second.State.Tiles {
			species[tile.Kind] = true
		}
		if len(species) != 15 {
			t.Fatal("missing species")
		}
		// Change and publish while the previous round is running; its revision is immutable.
		levels, e := h.games.Levels(context.Background(), false)
		if e != nil {
			t.Fatal(e)
		}
		for _, l := range levels {
			if l.ID == second.LevelID {
				l.Config.RewardCoins = 77
				draft, e := h.games.SaveLevel(context.Background(), l.ID, game.DraftInput{Mode: l.Mode, Ordinal: l.Ordinal, Title: "新版" + l.Title, Config: l.Config, DraftVersion: l.DraftVersion})
				if e != nil {
					t.Fatal(e)
				}
				publicLevels, err := h.games.Levels(context.Background(), true)
				if err != nil {
					t.Fatal(err)
				}
				for _, visible := range publicLevels {
					if visible.ID == l.ID && (visible.Title != l.Title || visible.Config.RewardCoins != 30) {
						t.Fatal("unpublished draft leaked to players")
					}
				}
				published, e := h.games.Publish(context.Background(), l.ID, "qa-admin", draft.DraftVersion)
				if e != nil {
					t.Fatal(e)
				}
				if published.RevisionID == second.RevisionID {
					t.Fatal("revision overwritten")
				}
				recovered, err := h.games.Recovery(context.Background(), a.User.ID, second.ID)
				if err != nil || recovered.Title != second.Title {
					t.Fatal("historical title changed", err)
				}
			}
		}
		_, route, e = game.NewBoard(game.DefaultConfig(mode, 2), uint32(second.Seed))
		if e != nil {
			t.Fatal(e)
		}
		for offset := 0; offset < len(route); offset += 50 {
			events = []game.Action{}
			for i := offset; i < min(offset+50, len(route)); i++ {
				events = append(events, game.Action{Seq: i + 1, Type: "pick", TileID: route[i], At: int64(i * 100)})
			}
			decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+second.ID+"/events", map[string]any{"events": events}, a.AccessToken), 200)
		}
		final := decode[game.FinishResult](t, h.call("POST", "/api/v1/user/sessions/"+second.ID+"/finish", map[string]string{"outcome": "won"}, a.AccessToken), 200)
		if final.RewardCoins != 30 || final.HasNext {
			t.Fatal("in-flight reward changed", final)
		}
	}
	u, e := h.users.Update(context.Background(), a.User.ID, users.UpdateInput{Nickname: a.User.Nickname, Status: "disabled"})
	if e != nil || u.Status != "disabled" {
		t.Fatal(e)
	}
	if h.call("GET", "/api/v1/user/assets", nil, a.AccessToken).Code != 401 {
		t.Fatal("disabled session retained")
	}
}
func TestToolsAndFailure(t *testing.T) {
	h := setup(t)
	a := login(t, h, "qa-tools-player")
	ctx := context.Background()
	level := game.DefaultConfig("classic", 2)
	level.FreeTools = map[string]int{"undo": 0, "shovel": 0, "hint": 0, "shuffle": 0}
	original, e := h.games.SaveLevel(ctx, "", game.DraftInput{Mode: "classic", Ordinal: 3, Title: "工具测试", Config: level})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = h.games.Publish(ctx, original.ID, "test", original.DraftVersion); e != nil {
		t.Fatal(e)
	}
	// Create a verified session directly from the public stage one API, then exercise tools.
	session, e := h.games.Start(ctx, a.User.ID, game.StartInput{Mode: "classic", RequestID: "qa-tools-session-0001"})
	if e != nil {
		t.Fatal(e)
	}
	_, route, _ := game.NewBoard(game.DefaultConfig("classic", 1), uint32(session.Seed))
	events := []game.Action{{Seq: 1, Type: "pick", TileID: route[0]}, {Seq: 2, Type: "undo"}, {Seq: 3, Type: "pick", TileID: route[0]}, {Seq: 4, Type: "shovel"}, {Seq: 5, Type: "pick", TileID: route[0]}, {Seq: 6, Type: "hint"}, {Seq: 7, Type: "shuffle"}}
	result, e := h.games.Events(ctx, a.User.ID, session.ID, events)
	if e != nil {
		t.Fatal(e)
	}
	if result.State.Tools["undo"] != 0 || len(result.State.Tray) != 0 || len(result.State.Reserve) != 0 {
		t.Fatal("tool state")
	}
	if _, e = h.games.Events(ctx, a.User.ID, session.ID, []game.Action{{Seq: 8, Type: "shuffle"}}); e == nil {
		t.Fatal("spent nonexistent bag item")
	}
	if _, e = h.games.Adjust(ctx, a.User.ID, "test", game.Adjustment{RequestID: "qa-grant-shuffle-0001", Asset: "shuffle", Delta: 1, Reason: "测试道具"}); e != nil {
		t.Fatal(e)
	}
	result, e = h.games.Events(ctx, a.User.ID, session.ID, []game.Action{{Seq: 8, Type: "shuffle"}})
	if e != nil {
		t.Fatal(e)
	}
	if result.Assets.Bag["shuffle"] != 0 {
		t.Fatal("bag not consumed")
	}
	result, e = h.games.Events(ctx, a.User.ID, session.ID, []game.Action{{Seq: 8, Type: "shuffle"}})
	if e != nil || result.Assets.Bag["shuffle"] != 0 {
		t.Fatal("retry consumed twice")
	}
	if _, e = h.games.Finish(ctx, a.User.ID, session.ID, "abandoned"); e != nil {
		t.Fatal(e)
	}
	// Deliberately fill the seven slots on a hard board.
	first, e := h.games.Start(ctx, a.User.ID, game.StartInput{Mode: "classic", RequestID: "qa-lose-first-00001"})
	if e != nil {
		t.Fatal(e)
	}
	_, route, _ = game.NewBoard(game.DefaultConfig("classic", 1), uint32(first.Seed))
	events = []game.Action{}
	for i, id := range route {
		events = append(events, game.Action{Seq: i + 1, Type: "pick", TileID: id})
	}
	if _, e = h.games.Events(ctx, a.User.ID, first.ID, events); e != nil {
		t.Fatal(e)
	}
	if _, e = h.games.Finish(ctx, a.User.ID, first.ID, "won"); e != nil {
		t.Fatal(e)
	}
	hard, e := h.games.Start(ctx, a.User.ID, game.StartInput{Mode: "classic", PreviousSessionID: first.ID, RequestID: "qa-lose-hard-00001"})
	if e != nil {
		t.Fatal(e)
	}
	state := hard.State
	events = []game.Action{}
	for state.Status == "playing" {
		chosen := -1
		best := 100
		for _, tile := range state.Tiles {
			if !state.Open(tile.ID) {
				continue
			}
			held := 0
			for _, id := range state.Tray {
				if state.Tiles[id].Kind == tile.Kind {
					held++
				}
			}
			if held < best {
				best = held
				chosen = tile.ID
			}
		}
		if chosen < 0 {
			t.Fatal("no moves")
		}
		if e = state.Pick(chosen); e != nil {
			t.Fatal(e)
		}
		events = append(events, game.Action{Seq: len(events) + 1, Type: "pick", TileID: chosen})
	}
	if state.Status != "lost" {
		t.Skip("rare random seed cleared under adversarial policy")
	}
	for start := 0; start < len(events); start += 64 {
		if _, e = h.games.Events(ctx, a.User.ID, hard.ID, events[start:min(start+64, len(events))]); e != nil {
			t.Fatal(e)
		}
	}
	result2, e := h.games.Finish(ctx, a.User.ID, hard.ID, "lost")
	if e != nil || result2.RewardCoins != 0 {
		t.Fatal("loss rewards", e)
	}
	row, e := dbgen.New(h.db).GetSession(ctx, hard.ID)
	if e != nil || !row.Settled || row.Status != "lost" {
		t.Fatal("loss not persisted")
	}
}
