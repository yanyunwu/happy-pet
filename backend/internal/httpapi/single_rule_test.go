package httpapi

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/game"
)

func TestAuthoringRejectsMultipleRulesBeforeChanges(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	q := dbgen.New(h.db)
	config := game.DefaultConfig("classic", 1)
	config.Rules = [][]int{{3}, {2, 2}}
	before, err := q.GetLevel(ctx, "classic-1")
	if err != nil {
		t.Fatal(err)
	}
	body := catalogDraft("campaign", "classic", 3, config)
	decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels", body, "admin"), 400)
	body["ordinal"], body["draftVersion"] = 1, before.DraftVersion
	decode[map[string]any](t, h.call("PUT", "/api/v1/admin/levels/classic-1", body, "admin"), 400)
	decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels/preview", map[string]any{"config": config, "seed": 97}, "admin"), 400)
	after, err := q.GetLevel(ctx, "classic-1")
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("rejected authoring changed the draft", err)
	}
	levels, err := q.ListLevels(ctx)
	if err != nil || len(levels) != 12 {
		t.Fatal("rejected authoring created a level", len(levels), err)
	}
	// Existing multi-rule drafts remain readable but cannot be published.
	data, _ := json.Marshal(config)
	if _, err = h.db.ExecContext(ctx, "UPDATE levels SET draft=$2,enabled=false WHERE id=$1", before.ID, data); err != nil {
		t.Fatal(err)
	}
	before, err = q.GetLevel(ctx, before.ID)
	if err != nil {
		t.Fatal(err)
	}
	decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels/classic-1/publish", map[string]any{"draftVersion": before.DraftVersion}, "admin"), 400)
	after, err = q.GetLevel(ctx, before.ID)
	revisions, revisionErr := q.ListRevisions(ctx, before.ID)
	if err != nil || revisionErr != nil || !reflect.DeepEqual(before, after) || len(revisions) != 1 {
		t.Fatal("rejected publish changed level/revision/enabled state", err, revisionErr)
	}
	// Missing v1 fun rules canonicalize to the historical TWO rules, so they
	// cannot bypass the single-rule requirement through omitted JSON fields.
	config.Mode, config.RulesVersion, config.Rules = "fun", game.LegacyRulesVersion, nil
	decode[map[string]any](t, h.call("POST", "/api/v1/admin/levels", catalogDraft("campaign", "fun", 3, config), "admin"), 400)
}

func TestAuthoringAcceptsEachSingleRule(t *testing.T) {
	h := setup(t)
	for i, rule := range [][]int{{3}, {4}, {2, 2}, {3, 2}, {2, 2, 2}} {
		config := game.DefaultConfig("classic", 1)
		config.Columns, config.Rows = 6, 1
		config.Rules = [][]int{rule}
		config.Counts = make([]int, 15)
		config.Layers = []game.Layer{{Z: 0, Cells: []game.Cell{}}}
		for kind, count := range rule {
			config.Counts[kind] = count
			for n := 0; n < count; n++ {
				config.Layers[0].Cells = append(config.Layers[0].Cells, game.Cell{X: len(config.Layers[0].Cells) * 2})
			}
		}
		draft := decode[catalogLevel](t, h.call("POST", "/api/v1/admin/levels", catalogDraft("campaign", "classic", int32(3+i), config), "admin"), 200)
		decode[game.State](t, h.call("POST", "/api/v1/admin/levels/preview", map[string]any{"config": config, "seed": 97}, "admin"), 200)
		publishCatalogLevel(t, h, draft)
	}
}
