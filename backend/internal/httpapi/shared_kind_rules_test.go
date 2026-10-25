package httpapi

import (
	"context"
	"reflect"
	"testing"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/game"
)

func TestSharedKindRulesAuthoringAndSessionEvents(t *testing.T) {
	for _, tc := range []struct {
		name string
		rule []int
		want []int
	}{
		{"two-pairs", []int{2, 2}, []int{2, 2}},
		{"one-plus-three", []int{1, 3}, []int{3, 1}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := setup(t)
			ctx := context.Background()
			for _, id := range []string{"classic-1", "classic-2"} {
				if err := h.games.Enabled(ctx, id, false); err != nil {
					t.Fatal(err)
				}
			}
			cfg := game.DefaultConfig("classic", 1)
			cfg.Columns, cfg.Rows = 4, 1
			cfg.Rules = [][]int{tc.rule}
			cfg.Counts = make([]int, 15)
			cfg.Counts[0] = 4
			cfg.Layers = []game.Layer{{Z: 0, Cells: []game.Cell{{X: 0}, {X: 2}, {X: 4}, {X: 6}}}}
			draft := decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", catalogDraft("campaign", "classic", 3, cfg), "admin"), 200)
			if !reflect.DeepEqual(draft.Config.Rules, [][]int{tc.want}) {
				t.Fatal("saved rule was rewritten as an expanded pattern", draft.Config.Rules)
			}
			preview := decode[game.State](t, h.call("POST", "/api/v1/admin/levels/preview", map[string]any{"config": cfg, "seed": 97}, "admin"), 200)
			if !reflect.DeepEqual(preview.Rules, [][]int{tc.want}) || len(preview.Tiles) != 4 {
				t.Fatal("preview lost its configured rule or tile count", preview)
			}
			published := publishCatalogLevel(t, h, draft)
			q := dbgen.New(h.db)
			before, err := q.GetRevision(ctx, published.RevisionID)
			if err != nil {
				t.Fatal(err)
			}
			player := login(t, h, "qa-shared-kind-"+tc.name)
			session := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Entry: "campaign", Mode: "classic", RequestID: "qa-shared-kind-start-" + tc.name}, player.AccessToken), 200)
			if session.RevisionID != published.RevisionID || !reflect.DeepEqual(session.State.Rules, [][]int{tc.want}) || session.State.RulesVersion != game.RulesVersion {
				t.Fatal("session did not retain the published rule and version", session)
			}
			events := []game.Action{}
			for i, tile := range session.State.Tiles {
				if tile.Kind != 0 {
					t.Fatal("single-kind configuration generated a different kind", tile)
				}
				events = append(events, game.Action{Seq: i + 1, Type: "pick", TileID: tile.ID})
			}
			partial := decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": events[:3]}, player.AccessToken), 200)
			if partial.State.Cleared != 0 || len(partial.State.Tray) != 3 || partial.State.Status != "playing" {
				t.Fatal("partial same-kind combination cleared", partial.State)
			}
			complete := decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": events[3:]}, player.AccessToken), 200)
			if complete.State.Cleared != 4 || complete.State.Matches != 1 || len(complete.State.Tray) != 0 || complete.State.Status != "won" {
				t.Fatal("four identical tiles did not clear through the events API", complete.State)
			}
			finished := decode[game.FinishResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/finish", map[string]string{"outcome": "won"}, player.AccessToken), 200)
			if finished.Status != "won" {
				t.Fatal("shared-kind session could not finish", finished)
			}
			after, err := q.GetRevision(ctx, published.RevisionID)
			if err != nil || string(before.Config) != string(after.Config) {
				t.Fatal("playing rewrote the immutable revision", err)
			}
		})
	}
}
