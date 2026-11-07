package main

import (
	"encoding/json"
	"happy-pet/api/internal/game"
	"testing"
)

func TestCatalogValidAndDistinct(t *testing.T) {
	levels := generate()
	if len(levels) != 192 {
		t.Fatalf("got %d levels", len(levels))
	}
	seen := map[string]bool{}
	for i, level := range levels {
		if level.Entry != "campaign" || level.Ordinal != i%64+1 {
			t.Fatalf("invalid identity at %d", i)
		}
		if err := game.Validate(level.Config); err != nil {
			t.Fatalf("%s/%d: %v", level.Mode, level.Ordinal, err)
		}
		b, _ := json.Marshal(level.Config.Layers)
		key := level.Mode + string(b)
		if seen[key] {
			t.Fatalf("duplicate layout %s/%d", level.Mode, level.Ordinal)
		}
		seen[key] = true
		for seed := uint32(0); seed < 4; seed++ {
			state, route, err := game.NewBoard(level.Config, seed)
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range route {
				if err = state.Pick(id); err != nil {
					t.Fatal(err)
				}
			}
			if state.Status != "won" {
				t.Fatalf("unsolved %s/%d seed %d", level.Mode, level.Ordinal, seed)
			}
		}
	}
}
