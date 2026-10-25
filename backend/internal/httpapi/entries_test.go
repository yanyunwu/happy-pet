package httpapi

import (
	"context"
	"strings"
	"testing"

	"happy-pet/api/internal/game"
)

func TestOriginalEntriesStaySeparateFromCampaign(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	player := login(t, h, "qa-entry-player")
	cfg := game.DefaultConfig("classic", 1)
	cfg.Rows = 1
	cfg.Layers = []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0, Y: 0}, {X: 2, Y: 0}, {X: 4, Y: 0}}}}
	cfg.Counts = make([]int, 15)
	cfg.Counts[0] = 3
	levels, e := h.games.Levels(ctx, false)
	if e != nil {
		t.Fatal(e)
	}
	var classic game.LevelView
	for _, l := range levels {
		if l.ID == "classic-1" {
			classic = l
		}
		if strings.HasPrefix(l.ID, "standard-") && l.Entry != "standard" {
			t.Fatal("challenge level lost its entry")
		}
	}
	draft, e := h.games.SaveLevel(ctx, classic.ID, game.DraftInput{Mode: "classic", Ordinal: 1, Title: "后台定制关卡", Config: cfg, DraftVersion: classic.DraftVersion})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = h.games.Publish(ctx, draft.ID, "test", draft.DraftVersion); e != nil {
		t.Fatal(e)
	}
	third, e := h.games.SaveLevel(ctx, "", game.DraftInput{Mode: "classic", Ordinal: 3, Title: "新增第三关", Config: cfg})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = h.games.Publish(ctx, third.ID, "test", third.DraftVersion); e != nil {
		t.Fatal(e)
	}
	// Disabling campaign quartet levels must not disable challenge quartet levels.
	for _, id := range []string{"quartet-1", "quartet-2"} {
		if e = h.games.Enabled(ctx, id, false); e != nil {
			t.Fatal(e)
		}
	}
	for _, mode := range []string{"classic", "quartet", "fun"} {
		previous := ""
		for stage := 1; stage <= 2; stage++ {
			session, e := h.games.Start(ctx, player.User.ID, game.StartInput{Entry: "standard", Mode: mode, PreviousSessionID: previous, RequestID: "standard-entry-stage-" + mode + string(rune('0'+stage))})
			if e != nil {
				t.Fatal(e)
			}
			if session.Entry != "standard" || session.Ordinal != int32(stage) || !strings.HasPrefix(session.LevelID, "standard-") {
				t.Fatal("wrong entry", session.LevelID)
			}
			config := game.DefaultConfig(mode, stage)
			expected, route, e := game.NewBoard(config, uint32(session.Seed))
			if e != nil {
				t.Fatal(e)
			}
			if len(session.State.Tiles) != len(expected.Tiles) {
				t.Fatal("campaign edits changed original entry")
			}
			if _, e = h.games.Start(ctx, player.User.ID, game.StartInput{Entry: "campaign", Mode: mode, PreviousSessionID: session.ID, RequestID: "entry-forgery-check-" + mode + string(rune('0'+stage))}); e == nil {
				t.Fatal("cross-entry predecessor accepted")
			}
			for start := 0; start < len(route); start += 64 {
				actions := []game.Action{}
				for i := start; i < min(start+64, len(route)); i++ {
					actions = append(actions, game.Action{Seq: i + 1, Type: "pick", TileID: route[i], At: int64(i * 100)})
				}
				if _, e = h.games.Events(ctx, player.User.ID, session.ID, actions); e != nil {
					t.Fatal(e)
				}
			}
			result, e := h.games.Finish(ctx, player.User.ID, session.ID, "won")
			if e != nil {
				t.Fatal(e)
			}
			if result.HasNext != (stage == 1) {
				t.Fatal("seeded challenge round must advance through its two stages")
			}
			previous = session.ID
		}
		if _, e = h.games.Start(ctx, player.User.ID, game.StartInput{Entry: "standard", Mode: mode, PreviousSessionID: previous, RequestID: "standard-no-third-" + mode}); e == nil {
			t.Fatal("original entry reached a third stage")
		}
		if _, e = h.games.Start(ctx, player.User.ID, game.StartInput{Entry: "campaign", Mode: mode, PreviousSessionID: previous, RequestID: "completed-cross-entry-" + mode}); e == nil {
			t.Fatal("completed round crossed entry")
		}
	}
	campaign, e := h.games.Start(ctx, player.User.ID, game.StartInput{Entry: "campaign", Mode: "classic", RequestID: "campaign-custom-start-1"})
	if e != nil {
		t.Fatal(e)
	}
	if campaign.Title != "后台定制关卡" || len(campaign.State.Tiles) != 3 || campaign.Entry != "campaign" {
		t.Fatal("campaign ignored its configuration")
	}
	if _, e = h.games.Start(ctx, player.User.ID, game.StartInput{Entry: "standard", Mode: "classic", RequestID: "campaign-custom-start-1"}); e == nil {
		t.Fatal("idempotency key crossed entry")
	}
	if _, e = h.games.Start(ctx, player.User.ID, game.StartInput{Entry: "other", Mode: "classic", RequestID: "unknown-entry-request"}); e == nil {
		t.Fatal("unknown entry accepted")
	}
	for _, mode := range []string{"classic", "quartet", "fun"} {
		id := "standard-" + mode + "-1"
		if e = h.games.Enabled(ctx, id, false); e != nil {
			t.Fatal(e)
		}
		if _, e = h.games.Publish(ctx, id, "test", 1); e != nil {
			t.Fatal(e)
		}
		if _, e = h.games.SaveLevel(ctx, id, game.DraftInput{Entry: "standard", Mode: mode, Ordinal: 1, Title: "更新挑战关卡", Config: game.DefaultConfig(mode, 1), DraftVersion: 1}); e != nil {
			t.Fatal(e)
		}
	}
	records := decode[map[string]any](t, h.call("GET", "/api/v1/admin/sessions?entry=standard", nil, "admin"), 200)
	if records["total"].(float64) != 6 {
		t.Fatal("entry filter failed", records["total"])
	}
	for _, v := range records["items"].([]any) {
		row := v.(map[string]any)
		if row["entry"] != "standard" {
			t.Fatal("mixed entry list")
		}
		replay := decode[map[string]any](t, h.call("GET", "/api/v1/admin/sessions/"+row["id"].(string)+"/replay", nil, "admin"), 200)
		if replay["session"].(map[string]any)["entry"] != "standard" {
			t.Fatal("replay lost its entry")
		}
	}
}
