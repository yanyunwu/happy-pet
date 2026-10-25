package httpapi

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/game"
	"happy-pet/api/internal/users"
)

func customRulePayload(t *testing.T, rules [][]int, counts []int) map[string]any {
	t.Helper()
	cfg := game.DefaultConfig("classic", 1)
	cfg.Columns, cfg.Rows = 5, 1
	cfg.Layers = []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0}, {X: 2}, {X: 4}, {X: 6}, {X: 8}}}}
	cfg.Counts = make([]int, 15)
	copy(cfg.Counts, counts)
	data, _ := json.Marshal(cfg)
	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatal(err)
	}
	body["rulesVersion"], body["rules"] = "pet-rules-2", rules
	return body
}

func TestCustomRulesPublishAndRevisionSnapshots(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-custom-rules-player")
	ctx := context.Background()
	for _, id := range []string{"classic-1", "classic-2"} {
		if err := h.games.Enabled(ctx, id, false); err != nil {
			t.Fatal(err)
		}
	}
	config := customRulePayload(t, [][]int{{2, 3}}, []int{3, 2})
	body := map[string]any{"entry": "campaign", "mode": "classic", "ordinal": 3, "title": "三加二组合", "config": config, "draftVersion": 0}
	draft := decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", body, "admin"), 200)
	encoded, _ := json.Marshal(draft.Config)
	var saved struct {
		Rules [][]int `json:"rules"`
	}
	if err := json.Unmarshal(encoded, &saved); err != nil || !reflect.DeepEqual(saved.Rules, [][]int{{3, 2}}) {
		t.Fatal("saved rules were not canonicalized", saved.Rules, err)
	}
	firstRevision := publishCatalogLevel(t, h, draft)
	session := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Entry: "campaign", Mode: "classic", RequestID: "qa-custom-session-first"}, player.AccessToken), 200)
	if session.State.RulesVersion != "pet-rules-2" {
		t.Fatal("new session did not use the new rules version")
	}
	body["draftVersion"], body["config"] = draft.DraftVersion, customRulePayload(t, [][]int{{5}}, []int{5})
	updated := decode[catalogLevel](t, h.call("PUT", "/api/v1/admin/levels/"+draft.ID, body, "admin"), 200)
	secondRevision := publishCatalogLevel(t, h, updated)
	if firstRevision.RevisionID == secondRevision.RevisionID {
		t.Fatal("custom rules changed an existing revision")
	}
	if result := finishCatalogWin(t, h, player.AccessToken, session); result.Status != "won" {
		t.Fatal("existing custom-rule session used newly published rules")
	}
	replay := decode[map[string]any](t, h.call("GET", "/api/v1/admin/sessions/"+session.ID+"/replay", nil, "admin"), 200)
	rules := replay["config"].(map[string]any)["rules"]
	if !reflect.DeepEqual(rules, []any{[]any{float64(3), float64(2)}}) {
		t.Fatal("replay rules were overwritten", rules)
	}
	other := login(t, h, "qa-custom-rules-other")
	newSession := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Entry: "campaign", Mode: "classic", RequestID: "qa-custom-session-second"}, other.AccessToken), 200)
	if newSession.RevisionID != secondRevision.RevisionID {
		t.Fatal("new session ignored newly published rules")
	}
	finishCatalogWin(t, h, other.AccessToken, newSession)
	for _, invalidRules := range [][][]int{{{3, 2}, {2, 3}}, {{8}}, {{0, 5}}, {{1}}} {
		body["config"] = customRulePayload(t, invalidRules, []int{3, 2})
		body["ordinal"] = 4
		decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels", body, "admin"), 400)
	}
}

func TestLegacyV1SessionContinuesWithoutRulesField(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-legacy-rules-player")
	ctx := context.Background()
	q := dbgen.New(h.db)
	level, err := q.GetLevel(ctx, "classic-1")
	if err != nil {
		t.Fatal(err)
	}
	// Simulate historical JSON stored by the old service without rewriting it
	// through the new save endpoint.
	if _, err = h.db.ExecContext(ctx, `UPDATE level_revisions SET config=(config-'rules') || '{"rulesVersion":"pet-rules-1"}'::jsonb WHERE id=$1`, level.PublishedRevision.String); err != nil {
		t.Fatal(err)
	}
	session := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Mode: "classic", RequestID: "qa-legacy-session-0001"}, player.AccessToken), 200)
	if session.State.RulesVersion != "pet-rules-1" {
		t.Fatal("legacy revision was started under the wrong version")
	}
	if _, err = h.db.ExecContext(ctx, `UPDATE game_sessions SET state=state-'rules',initial=initial-'rules' WHERE id=$1`, session.ID); err != nil {
		t.Fatal(err)
	}
	finishCatalogWin(t, h, player.AccessToken, session)
	replay := decode[map[string]any](t, h.call("GET", "/api/v1/admin/sessions/"+session.ID+"/replay", nil, "admin"), 200)
	config := replay["config"].(map[string]any)
	if config["rulesVersion"] != "pet-rules-1" || config["rules"] != nil {
		t.Fatal("legacy immutable revision JSON was rewritten", config)
	}
}

func TestHistoricalCustomShuffleFailureDoesNotConsumeAssetsOrChangeSession(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-custom-shuffle-failure")
	ctx := context.Background()
	for _, id := range []string{"classic-1", "classic-2"} {
		if err := h.games.Enabled(ctx, id, false); err != nil {
			t.Fatal(err)
		}
	}
	cfg := game.DefaultConfig("classic", 1)
	cfg.Rules = [][]int{{3, 1}}
	cfg.Columns, cfg.Rows = 4, 2
	cfg.Layers = []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0}, {X: 2}, {X: 4}, {X: 6}, {X: 0, Y: 2}, {X: 2, Y: 2}, {X: 4, Y: 2}, {X: 6, Y: 2}}}}
	cfg.Counts = make([]int, 15)
	copy(cfg.Counts, []int{3, 3, 2})
	cfg.FreeTools["shuffle"] = 0
	draft := decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", catalogDraft("campaign", "classic", 3, cfg), "admin"), 200)
	published := publishCatalogLevel(t, h, draft)
	// A historical multi-rule revision remains playable even though new writes
	// no longer accept it. Construct that old snapshot only in this test schema.
	cfg.Rules = [][]int{{3, 1}, {2, 2}}
	data, _ := json.Marshal(cfg)
	if _, err := h.db.ExecContext(ctx, "UPDATE level_revisions SET config=$2 WHERE id=$1", published.RevisionID, data); err != nil {
		t.Fatal(err)
	}
	if _, err := h.games.Adjust(ctx, player.User.ID, "test", game.Adjustment{RequestID: "qa-custom-shuffle-grant", Asset: "shuffle", Delta: 1, Reason: "验证失败重排"}); err != nil {
		t.Fatal(err)
	}
	session := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Mode: "classic", RequestID: "qa-custom-dead-end-start"}, player.AccessToken), 200)
	events := []game.Action{}
	for _, kind := range []int{0, 1} {
		picked := 0
		for _, tile := range session.State.Tiles {
			if tile.Kind == kind && picked < 2 {
				events = append(events, game.Action{Seq: len(events) + 1, Type: "pick", TileID: tile.ID})
				picked++
			}
		}
	}
	result := decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": events}, player.AccessToken), 200)
	if result.State.Cleared != 4 || result.State.Status != "playing" {
		t.Fatal("did not reach the intended custom dead end")
	}
	before, err := dbgen.New(h.db).GetSession(ctx, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	decode[map[string]any](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []game.Action{{Seq: 5, Type: "shuffle"}}}, player.AccessToken), 400)
	after, err := dbgen.New(h.db).GetSession(ctx, session.ID)
	if err != nil || string(after.State) != string(before.State) || after.LastSeq != before.LastSeq {
		t.Fatal("failed shuffle changed persisted session state", err)
	}
	assets := decode[game.Assets](t, h.call("GET", "/api/v1/user/assets", nil, player.AccessToken), 200)
	if assets.Bag["shuffle"] != 1 {
		t.Fatal("failed shuffle consumed the player's bag item")
	}
	// A v1 draft with explicit custom rules must fail before it can be published.
	cfg.RulesVersion, cfg.Rules = "pet-rules-1", [][]int{{2}}
	_, err = h.games.SaveLevel(ctx, "", game.DraftInput{Mode: "classic", Ordinal: 4, Title: "旧版本自定义规则", Config: cfg})
	appErr, ok := err.(*users.Error)
	if !ok || appErr.Status != 400 {
		t.Fatal("legacy draft accepted custom rules", err)
	}
}

func TestMultiplePriorityRulesCannotBeAuthored(t *testing.T) {
	h := setup(t)
	for i, rules := range [][][]int{{{3, 2}, {2, 2}}, {{3, 2}, {3}}} {
		body := map[string]any{"entry": "campaign", "mode": "classic", "ordinal": 3 + i, "title": "优先五张消除", "config": customRulePayload(t, rules, []int{3, 2}), "draftVersion": 0}
		decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels", body, "admin"), 400)
	}
}
