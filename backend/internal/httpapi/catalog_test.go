package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/game"
)

type catalogLevel struct {
	game.LevelView
	Entry string `json:"entry"`
}

type catalogTemplate struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Layout    json.RawMessage `json:"layout"`
	Version   int32           `json:"version"`
	UpdatedAt string          `json:"updatedAt"`
}

func catalogDraft(entry, mode string, ordinal int32, cfg game.Config) map[string]any {
	return map[string]any{"entry": entry, "mode": mode, "ordinal": ordinal, "title": "目录测试关卡", "config": cfg, "draftVersion": 0}
}

func publishCatalogLevel(t *testing.T, h *harness, level catalogLevel) catalogLevel {
	t.Helper()
	return decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels/"+level.ID+"/publish", map[string]any{"draftVersion": level.DraftVersion}, "admin"), 200)
}

func TestUnifiedCatalogExposesAndEditsBothEntries(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-unified-catalog")
	for _, endpoint := range []struct{ path, token string }{{"/api/v1/admin/levels", "admin"}, {"/api/v1/user/levels", player.AccessToken}} {
		levels := decode[[]catalogLevel](t, h.call("GET", endpoint.path, nil, endpoint.token), 200)
		counts := map[string]int{}
		for _, level := range levels {
			counts[level.Entry+"/"+level.Mode]++
		}
		for _, entry := range []string{"standard", "campaign"} {
			for _, mode := range []string{"classic", "quartet", "fun"} {
				if counts[entry+"/"+mode] != 2 {
					t.Fatalf("%s: expected two seeded %s/%s levels, got %v", endpoint.path, entry, mode, counts)
				}
			}
		}
	}

	levels := decode[[]catalogLevel](t, h.call("GET", "/api/v1/admin/levels", nil, "admin"), 200)
	var original catalogLevel
	for _, level := range levels {
		if level.ID == "standard-classic-1" {
			original = level
		}
	}
	body := catalogDraft("standard", "classic", 1, original.Config)
	body["draftVersion"] = original.DraftVersion
	body["title"] = "可编辑挑战关卡"
	draft := decode[catalogLevel](t, h.call("PUT", "/api/v1/admin/levels/"+original.ID, body, "admin"), 200)
	if draft.Entry != "standard" || draft.DraftVersion != original.DraftVersion+1 {
		t.Fatal("challenge edit lost identity or version", draft)
	}
	public := decode[[]catalogLevel](t, h.call("GET", "/api/v1/user/levels", nil, player.AccessToken), 200)
	for _, level := range public {
		if level.ID == original.ID && level.Title != original.Title {
			t.Fatal("unpublished challenge draft exposed")
		}
	}
	published := publishCatalogLevel(t, h, draft)
	if published.Title != "可编辑挑战关卡" || published.RevisionID == original.RevisionID {
		t.Fatal("challenge revision was not published")
	}
	decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels/"+draft.ID+"/enabled", map[string]bool{"enabled": false}, "admin"), 200)
	public = decode[[]catalogLevel](t, h.call("GET", "/api/v1/user/levels", nil, player.AccessToken), 200)
	for _, level := range public {
		if level.ID == draft.ID {
			t.Fatal("disabled challenge level exposed")
		}
	}
	decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels/"+draft.ID+"/enabled", map[string]bool{"enabled": true}, "admin"), 200)

	for _, entry := range []string{"standard", "campaign"} {
		body = catalogDraft(entry, "classic", 10000, game.DefaultConfig("classic", 1))
		created := decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", body, "admin"), 200)
		publishCatalogLevel(t, h, created)
		for field, changed := range map[string]any{"entry": map[string]string{"standard": "campaign", "campaign": "standard"}[entry], "mode": "fun", "ordinal": 10001} {
			attempt := catalogDraft(entry, "classic", 10000, created.Config)
			attempt["draftVersion"] = created.DraftVersion
			attempt[field] = changed
			if field == "mode" {
				cfg := created.Config
				cfg.Mode = "fun"
				attempt["config"] = cfg
			}
			decode[map[string]any](t, h.call("PUT", "/api/v1/admin/levels/"+created.ID, attempt, "admin"), 400)
		}
		decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels", body, "admin"), 409)
	}
	body = catalogDraft("campaign", "classic", 2147483647, game.DefaultConfig("classic", 1))
	delete(body, "entry")
	legacy := decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", body, "admin"), 200)
	if legacy.Entry != "campaign" {
		t.Fatal("missing entry no longer defaults to campaign")
	}
	body["ordinal"] = int64(2147483648)
	decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels", body, "admin"), 400)
	body["ordinal"] = 0
	decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels", body, "admin"), 400)
	if err := game.Seed(context.Background(), h.db); err != nil {
		t.Fatal(err)
	}
	stored, err := dbgen.New(h.db).GetLevel(context.Background(), original.ID)
	if err != nil || stored.Title != "可编辑挑战关卡" || stored.PublishedRevision.String != published.RevisionID {
		t.Fatal("restart changed an edited challenge level", err)
	}
}

func finishCatalogWin(t *testing.T, h *harness, token string, session game.SessionView) game.FinishResult {
	t.Helper()
	revision, err := dbgen.New(h.db).GetRevision(context.Background(), session.RevisionID)
	if err != nil {
		t.Fatal(err)
	}
	var cfg game.Config
	if err = json.Unmarshal(revision.Config, &cfg); err != nil {
		t.Fatal(err)
	}
	_, route, err := game.NewBoard(cfg, uint32(session.Seed))
	if err != nil {
		t.Fatal(err)
	}
	for offset := 0; offset < len(route); offset += 64 {
		events := []game.Action{}
		for i := offset; i < min(offset+64, len(route)); i++ {
			events = append(events, game.Action{Seq: i + 1, Type: "pick", TileID: route[i], At: int64(i * 100)})
		}
		decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": events}, token), 200)
	}
	return decode[game.FinishResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/finish", map[string]string{"outcome": "won"}, token), 200)
}

func TestCampaignProgressResumesAndRewardsStayIdempotent(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-campaign-resume")
	start := func(entry, mode, request, previous string) game.SessionView {
		t.Helper()
		return decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Entry: entry, Mode: mode, RequestID: request, PreviousSessionID: previous}, player.AccessToken), 200)
	}
	// An open board with six kinds makes seven nonmatching picks a deterministic loss.
	cfg := game.DefaultConfig("classic", 1)
	cfg.Columns, cfg.Rows = 6, 3
	cfg.Layers = []game.Layer{{Z: 0, Cells: []game.Cell{}}}
	cfg.Counts = make([]int, 15)
	for y := 0; y < 3; y++ {
		for x := 0; x < 6; x++ {
			cfg.Layers[0].Cells = append(cfg.Layers[0].Cells, game.Cell{X: 2 * x, Y: 2 * y})
		}
	}
	for i := 0; i < 6; i++ {
		cfg.Counts[i] = 3
	}
	secondDraft, err := h.games.SaveLevel(context.Background(), "classic-2", game.DraftInput{Mode: "classic", Ordinal: 2, Title: "可重试第二关", Config: cfg, DraftVersion: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.games.Publish(context.Background(), secondDraft.ID, "test", secondDraft.DraftVersion); err != nil {
		t.Fatal(err)
	}
	first := start("campaign", "classic", "qa-campaign-first-0001", "")
	duplicate := start("campaign", "classic", "qa-campaign-first-0002", "")
	win := finishCatalogWin(t, h, player.AccessToken, first)
	if win.RewardCoins != 10 || !win.HasNext {
		t.Fatal("first win did not reward or advance", win)
	}
	duplicateWin := finishCatalogWin(t, h, player.AccessToken, duplicate)
	if duplicateWin.RewardCoins != 0 || duplicateWin.Assets.Coins != win.Assets.Coins {
		t.Fatal("same level rewarded twice", duplicateWin)
	}
	second := start("campaign", "classic", "qa-campaign-fresh-second", "")
	if second.Ordinal != 2 {
		t.Fatalf("fresh entry must resume first uncleared level, got %d", second.Ordinal)
	}
	for _, mode := range []string{"quartet", "fun"} {
		if next := start("campaign", mode, "qa-independent-rule-"+mode, ""); next.Ordinal != 1 {
			t.Fatal("campaign progress leaked across rules", next.Ordinal)
		}
	}
	challenge := start("standard", "classic", "qa-challenge-first-round", "")
	finishCatalogWin(t, h, player.AccessToken, challenge)
	if next := start("standard", "classic", "qa-challenge-next-round", ""); next.Ordinal != 1 {
		t.Fatal("new challenge round did not restart at first level")
	}
	state := second.State
	events := []game.Action{}
	for state.Status == "playing" {
		chosen, fewest := -1, 100
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
			if held < fewest {
				chosen, fewest = tile.ID, held
			}
		}
		if err := state.Pick(chosen); err != nil {
			t.Fatal(err)
		}
		events = append(events, game.Action{Seq: len(events) + 1, Type: "pick", TileID: chosen})
	}
	if state.Status != "lost" {
		t.Fatal("test loss board unexpectedly cleared")
	}
	decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+second.ID+"/events", map[string]any{"events": events}, player.AccessToken), 200)
	decode[game.FinishResult](t, h.call("POST", "/api/v1/user/sessions/"+second.ID+"/finish", map[string]string{"outcome": "lost"}, player.AccessToken), 200)
	retry := start("campaign", "classic", "qa-campaign-retry-second", "")
	if retry.Ordinal != 2 {
		t.Fatal("loss reset campaign progress")
	}
	if result := finishCatalogWin(t, h, player.AccessToken, retry); result.HasNext {
		t.Fatal("all-cleared campaign reported more levels")
	}
	repeated := decode[game.FinishResult](t, h.call("POST", "/api/v1/user/sessions/"+first.ID+"/finish", map[string]string{"outcome": "won"}, player.AccessToken), 200)
	if repeated.HasNext {
		t.Fatal("finish includes an already cleared campaign level")
	}
	completed := decode[map[string]any](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Entry: "campaign", Mode: "classic", RequestID: "qa-campaign-completed-001"}, player.AccessToken), 404)
	if completed["error"].(map[string]any)["code"] != "CAMPAIGN_COMPLETE" {
		t.Fatal("wrong completion status", completed)
	}
	third := decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", catalogDraft("campaign", "classic", 3, game.DefaultConfig("classic", 1)), "admin"), 200)
	publishCatalogLevel(t, h, third)
	if next := start("campaign", "classic", "qa-campaign-new-release", ""); next.LevelID != third.ID {
		t.Fatal("newly released level did not resume completed campaign")
	}
}

func TestLevelTemplateCRUDAndGeometryIsolation(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-template-player")
	for _, token := range []string{"", player.AccessToken} {
		decode[map[string]any](t, h.call("GET", "/api/v1/admin/level-templates", nil, token), 401)
		decode[map[string]any](t, h.call("POST", "/api/v1/admin/level-templates", map[string]any{}, token), 401)
		decode[map[string]any](t, h.call("PUT", "/api/v1/admin/level-templates/missing", map[string]any{}, token), 401)
		decode[map[string]any](t, h.call("DELETE", "/api/v1/admin/level-templates/missing?version=1", nil, token), 401)
	}
	seeded := decode[[]catalogTemplate](t, h.call("GET", "/api/v1/admin/level-templates", nil, "admin"), 200)
	if len(seeded) != 3 {
		t.Fatalf("expected three starter templates, got %d", len(seeded))
	}
	wantSizes := map[string]int{"九宫叠层": 18, "双层长廊": 16, "森林阶梯": 108}
	for _, template := range seeded {
		var layout struct {
			Layers []game.Layer `json:"layers"`
		}
		if err := json.Unmarshal(template.Layout, &layout); err != nil {
			t.Fatal(err)
		}
		count := 0
		for _, layer := range layout.Layers {
			count += len(layer.Cells)
		}
		if wantSizes[template.Name] != count || template.Version != 1 || template.UpdatedAt == "" {
			t.Fatal("invalid starter template", template.Name, count)
		}
	}
	layout := map[string]any{"columns": 5, "rows": 1, "layers": []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0}, {X: 2}, {X: 4}, {X: 6}, {X: 8}}}}}
	body := map[string]any{"name": "五格自由布局", "layout": layout, "version": 0}
	created := decode[catalogTemplate](t, h.call("POST", "/api/v1/admin/level-templates", body, "admin"), 200)
	if created.ID == "" || created.Version != 1 {
		t.Fatal("five-cell geometry template was not created")
	}
	body["version"], body["name"] = created.Version, "更新后的五格"
	updated := decode[catalogTemplate](t, h.call("PUT", "/api/v1/admin/level-templates/"+created.ID, body, "admin"), 200)
	if updated.Version != 2 || updated.Name != "更新后的五格" {
		t.Fatal("template update did not increment version")
	}
	decode[map[string]any](t, h.call("PUT", "/api/v1/admin/level-templates/"+created.ID, body, "admin"), 409)
	decode[map[string]any](t, h.call("DELETE", "/api/v1/admin/level-templates/"+created.ID+"?version=1", nil, "admin"), 409)
	for _, invalidLayout := range []map[string]any{
		{"columns": 0, "rows": 1, "layers": layout["layers"]},
		{"columns": 7, "rows": 1, "layers": layout["layers"]},
		{"columns": 5, "rows": 0, "layers": layout["layers"]},
		{"columns": 5, "rows": 9, "layers": layout["layers"]},
		{"columns": 5, "rows": 1, "layers": []game.Layer{}},
		{"columns": 5, "rows": 1, "layers": []game.Layer{{Z: 0, Cells: []game.Cell{}}}},
		{"columns": 5, "rows": 1, "layers": []game.Layer{{Z: -1, Cells: []game.Cell{{X: 0}, {X: 2}, {X: 4}}}}},
		{"columns": 5, "rows": 1, "layers": []game.Layer{{Z: 8, Cells: []game.Cell{{X: 0}, {X: 2}, {X: 4}}}}},
		{"columns": 5, "rows": 1, "layers": []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0}, {X: 2}, {X: 4}}}, {Z: 0, Cells: []game.Cell{{X: 0}}}}},
		{"columns": 5, "rows": 1, "layers": []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0}, {X: 2}}}}},
		{"columns": 5, "rows": 1, "layers": []game.Layer{{Z: 0, Cells: []game.Cell{{X: -1}, {X: 2}, {X: 4}}}}},
		{"columns": 5, "rows": 1, "layers": []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0}, {X: 2}, {X: 10}}}}},
		{"columns": 5, "rows": 1, "layers": []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0}, {X: 2}, {X: 4, Y: 2}}}}},
		{"columns": 5, "rows": 1, "layers": []any{map[string]any{"z": 0, "cells": []any{map[string]any{"x": 0.5, "y": 0}, game.Cell{X: 2}, game.Cell{X: 4}}}}},
		{"columns": 3, "rows": 1, "layers": []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0}, {X: 1}, {X: 4}}}}},
		{"columns": 5, "rows": 1, "layers": layout["layers"], "counts": []int{5}},
		{"columns": 5, "rows": 1, "layers": layout["layers"], "mode": "classic"},
		{"columns": 5, "rows": 1, "layers": layout["layers"], "rewardCoins": 10},
		{"columns": 5, "rows": 1, "layers": layout["layers"], "freeTools": map[string]int{"hint": 1}},
	} {
		decode[map[string]any](t, h.call("POST", "/api/v1/admin/level-templates", map[string]any{"name": "无效布局", "layout": invalidLayout, "version": 0}, "admin"), 400)
	}
	for _, version := range []string{"", "0", "-1", "1.5", "2147483648"} {
		decode[map[string]any](t, h.call("DELETE", "/api/v1/admin/level-templates/"+created.ID+"?version="+version, nil, "admin"), 400)
	}
	decode[map[string]any](t, h.call("DELETE", "/api/v1/admin/level-templates/"+created.ID+"?version=2", nil, "admin"), 200)
	decode[map[string]any](t, h.call("PUT", "/api/v1/admin/level-templates/"+created.ID, body, "admin"), 404)
	decode[map[string]any](t, h.call("DELETE", "/api/v1/admin/level-templates/"+seeded[0].ID+"?version=1", nil, "admin"), 200)
	if err := game.Seed(context.Background(), h.db); err != nil {
		t.Fatal(err)
	}
	remaining := decode[[]catalogTemplate](t, h.call("GET", "/api/v1/admin/level-templates", nil, "admin"), 200)
	if len(remaining) != 2 {
		t.Fatal("restart resurrected a deleted template")
	}
	// Import is a copy of geometry into the draft, with no relationship to template lifecycle.
	var copied struct {
		Columns int          `json:"columns"`
		Rows    int          `json:"rows"`
		Layers  []game.Layer `json:"layers"`
	}
	if err := json.Unmarshal(remaining[0].Layout, &copied); err != nil {
		t.Fatal(err)
	}
	cfg := game.DefaultConfig("classic", 1)
	cfg.Columns, cfg.Rows, cfg.Layers = copied.Columns, copied.Rows, copied.Layers
	level := decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", catalogDraft("campaign", "classic", 3, cfg), "admin"), 200)
	decode[catalogTemplate](t, h.call("PUT", "/api/v1/admin/level-templates/"+remaining[0].ID, map[string]any{"name": "模板已改变", "layout": layout, "version": 1}, "admin"), 200)
	decode[map[string]any](t, h.call("DELETE", fmt.Sprintf("/api/v1/admin/level-templates/%s?version=2", remaining[0].ID), nil, "admin"), 200)
	levels := decode[[]catalogLevel](t, h.call("GET", "/api/v1/admin/levels", nil, "admin"), 200)
	for _, saved := range levels {
		if saved.ID == level.ID && !reflect.DeepEqual(saved.Config.Layers, copied.Layers) {
			t.Fatal("template lifecycle modified copied level geometry")
		}
	}
}

func TestCatalogEligibilityAndPredecessorValidation(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-catalog-eligibility")
	other := login(t, h, "qa-catalog-other-owner")
	ctx := context.Background()
	if err := h.games.Enabled(ctx, "classic-1", false); err != nil {
		t.Fatal(err)
	}
	// A draft must never become playable or affect hasNext before publication.
	decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", catalogDraft("campaign", "classic", 3, game.DefaultConfig("classic", 1)), "admin"), 200)
	start := func(input game.StartInput, token string, status int) game.SessionView {
		t.Helper()
		if status != 200 {
			decode[map[string]any](t, h.call("POST", "/api/v1/user/sessions", input, token), status)
			return game.SessionView{}
		}
		return decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", input, token), status)
	}
	second := start(game.StartInput{Entry: "campaign", Mode: "classic", RequestID: "qa-eligible-second-001"}, player.AccessToken, 200)
	if second.Ordinal != 2 {
		t.Fatal("disabled campaign level was playable")
	}
	start(game.StartInput{Entry: "campaign", Mode: "classic", PreviousSessionID: second.ID, RequestID: "qa-unsettled-previous-001"}, player.AccessToken, 409)
	result := finishCatalogWin(t, h, player.AccessToken, second)
	if result.HasNext {
		t.Fatal("disabled or unpublished campaign level affected hasNext")
	}
	start(game.StartInput{Entry: "campaign", Mode: "classic", PreviousSessionID: second.ID, RequestID: "qa-foreign-previous-001"}, other.AccessToken, 400)
	start(game.StartInput{Entry: "campaign", Mode: "quartet", PreviousSessionID: second.ID, RequestID: "qa-cross-rule-previous-001"}, player.AccessToken, 409)
	start(game.StartInput{Entry: "standard", Mode: "classic", PreviousSessionID: second.ID, RequestID: "qa-cross-entry-previous-001"}, player.AccessToken, 409)
	if err := h.games.Enabled(ctx, "classic-1", true); err != nil {
		t.Fatal(err)
	}
	result = decode[game.FinishResult](t, h.call("POST", "/api/v1/user/sessions/"+second.ID+"/finish", map[string]string{"outcome": "won"}, player.AccessToken), 200)
	if !result.HasNext {
		t.Fatal("newly enabled earlier uncleared level was skipped by finish")
	}
	first := start(game.StartInput{Entry: "campaign", Mode: "classic", PreviousSessionID: second.ID, RequestID: "qa-earlier-uncleared-001"}, player.AccessToken, 200)
	if first.Ordinal != 1 {
		t.Fatal("campaign predecessor ordinal hid an earlier uncleared level")
	}
	if result = finishCatalogWin(t, h, player.AccessToken, first); result.HasNext {
		t.Fatal("already cleared higher campaign level affected hasNext")
	}
	third := decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", catalogDraft("standard", "classic", 3, game.DefaultConfig("classic", 1)), "admin"), 200)
	publishCatalogLevel(t, h, third)
	if err := h.games.Enabled(ctx, "standard-classic-2", false); err != nil {
		t.Fatal(err)
	}
	challenge := start(game.StartInput{Entry: "standard", Mode: "classic", RequestID: "qa-extensible-challenge-1"}, player.AccessToken, 200)
	if result = finishCatalogWin(t, h, player.AccessToken, challenge); !result.HasNext {
		t.Fatal("additional published challenge level did not affect hasNext")
	}
	last := start(game.StartInput{Entry: "standard", Mode: "classic", PreviousSessionID: challenge.ID, RequestID: "qa-extensible-challenge-3"}, player.AccessToken, 200)
	if last.LevelID != third.ID || last.Ordinal != 3 {
		t.Fatal("challenge could not advance past the original two stages")
	}
	if result = finishCatalogWin(t, h, player.AccessToken, last); result.HasNext {
		t.Fatal("challenge included campaign levels")
	}
}

func TestSeedNeverRecreatesAnInitializedCatalog(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	// Only this test's isolated schema is modified. Remove a complete initialized
	// entry to prove the seed marker does not depend on remaining level contents.
	for _, statement := range []string{
		"UPDATE levels SET published_revision=NULL WHERE entry='standard'",
		"DELETE FROM level_revisions WHERE level_id IN (SELECT id FROM levels WHERE entry='standard')",
		"DELETE FROM levels WHERE entry='standard'",
	} {
		if _, err := h.db.ExecContext(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	if err := game.Seed(ctx, h.db); err != nil {
		t.Fatal(err)
	}
	levels, err := h.games.Levels(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(levels) != 6 {
		t.Fatal("restart resurrected a deleted challenge catalog", len(levels))
	}
}
