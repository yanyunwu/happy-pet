package game

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestEveryDefaultBoardHasWitness(t *testing.T) {
	for _, mode := range []string{"classic", "quartet", "fun"} {
		for stage := 1; stage <= 2; stage++ {
			c := DefaultConfig(mode, stage)
			for seed := uint32(0); seed < 180; seed++ {
				s, route, e := NewBoard(c, seed)
				if e != nil {
					t.Fatal(e)
				}
				counts := make([]int, 15)
				for _, tile := range s.Tiles {
					counts[tile.Kind]++
				}
				if !reflect.DeepEqual(counts, c.Counts) {
					t.Fatal("wrong counts")
				}
				for _, id := range route {
					if e = s.Pick(id); e != nil {
						t.Fatalf("%s/%d/%d: %v", mode, stage, seed, e)
					}
				}
				if s.Status != "won" || s.Cleared != len(s.Tiles) {
					t.Fatalf("witness failed %s %d %d", mode, stage, seed)
				}
			}
		}
	}
}
func TestValidationAndFunDeadEnd(t *testing.T) {
	c := DefaultConfig("classic", 2)
	c.Counts[0]--
	if Validate(c) == nil {
		t.Fatal("mismatch accepted")
	}
	c = DefaultConfig("quartet", 2)
	c.Counts[0]--
	c.Counts[1]++
	if Validate(c) == nil {
		t.Fatal("non multiple accepted")
	}
	c = DefaultConfig("fun", 1)
	c.Layers[0].Cells[1] = c.Layers[0].Cells[0]
	if Validate(c) == nil {
		t.Fatal("overlap accepted")
	}
	s := State{Frame: Frame{Status: "playing", Tiles: []Tile{}, Tray: []int{}, Reserve: []int{}}, Mode: "fun", Capacity: 7, RulesVersion: LegacyRulesVersion}
	for id, k := range []int{0, 0, 0, 1, 1, 1} {
		s.Tiles = append(s.Tiles, Tile{ID: id, Kind: k, X: float64(id * 100)})
	}
	for _, id := range []int{0, 1, 3, 4} {
		if e := s.Pick(id); e != nil {
			t.Fatal(e)
		}
	}
	if e := s.Tool("shuffle", 1); e == nil {
		t.Fatal("impossible remainder shuffled")
	}
	if e := s.Pick(2); e != nil {
		t.Fatal(e)
	}
	if e := s.Pick(5); e != nil {
		t.Fatal(e)
	}
	if s.Status != "lost" {
		t.Fatal("leftover not lost")
	}
	if s.Tool("undo", 1) == nil {
		t.Fatal("resurrected loss")
	}
}
func TestParityFixtures(t *testing.T) {
	fixtures := []map[string]any{}
	type fixtureCase struct {
		name    string
		mode    string
		stage   int
		config  Config
		shuffle bool
		unlock  bool
	}
	cases := []fixtureCase{}
	for _, mode := range []string{"classic", "quartet", "fun"} {
		for stage := 1; stage <= 2; stage++ {
			cases = append(cases, fixtureCase{mode: mode, stage: stage, config: DefaultConfig(mode, stage)})
		}
	}
	for i, custom := range []struct {
		name   string
		rules  [][]int
		counts []int
	}{
		{"custom-four", [][]int{{4}}, []int{8, 4}},
		{"custom-three-plus-two", [][]int{{3, 2}}, []int{6, 4, 3, 2}},
		{"custom-three-pairs", [][]int{{2, 2, 2}}, []int{4, 4, 4}},
		{"custom-five", [][]int{{5}}, []int{5, 10}},
		{"custom-two-plus-one", [][]int{{2, 1}}, []int{4, 2}},
		{"custom-multiple", [][]int{{3, 1}, {2, 2}}, []int{5, 3, 4}},
		{"custom-seven", [][]int{{7}}, []int{7, 7}},
		{"custom-five-before-pairs", [][]int{{3, 2}, {2, 2}}, []int{3, 2}},
		{"custom-five-before-triples", [][]int{{3, 2}, {3}}, []int{3, 2}},
	} {
		cases = append(cases, fixtureCase{name: custom.name, mode: "classic", stage: i + 3, config: customConfig(t, custom.rules, custom.counts), shuffle: true})
	}
	for _, mode := range []string{"classic", "quartet", "fun"} {
		legacy := DefaultConfig(mode, 1)
		legacy.RulesVersion, legacy.Rules = LegacyRulesVersion, nil
		cases = append(cases, fixtureCase{name: "legacy-" + mode, mode: mode, stage: 1, config: legacy})
		cases = append(cases, fixtureCase{name: "extra-slot-" + mode, mode: mode, stage: 1, config: DefaultConfig(mode, 1), shuffle: true, unlock: true})
	}
	cases = append(cases, fixtureCase{name: "extra-slot-custom", mode: "classic", stage: 3, config: customConfig(t, [][]int{{3, 2}}, []int{6, 4, 3, 2}), shuffle: true, unlock: true})
	for _, tc := range cases {
		s, route, e := NewBoard(tc.config, 97)
		if e != nil {
			t.Fatal(e)
		}
		initial := s.Public()
		initial.Frame = cloneFrame(initial.Frame)
		initial.Tools = map[string]int{"undo": 1, "shovel": 1, "hint": 3, "shuffle": 1}
		events := []map[string]any{}
		apply := func(kind string, id int) {
			t.Helper()
			if kind == "pick" {
				e = s.Pick(id)
			} else if kind == "unlock_slot" {
				e = s.UnlockExtraSlot()
			} else {
				e = s.Tool(kind, 2026)
				if e == nil {
					s.Tools[kind]--
				}
			}
			if e != nil {
				t.Fatal(e)
			}
			events = append(events, map[string]any{"type": kind, "tileId": id, "state": json.RawMessage(raw(s.Public()))})
		}
		apply("pick", route[0])
		if tc.unlock {
			apply("unlock_slot", 0)
		}
		apply("undo", 0)
		apply("pick", route[0])
		apply("shovel", 0)
		apply("pick", route[0])
		apply("hint", 0)
		remaining := route[1:]
		if tc.shuffle {
			apply("shuffle", 0)
			// The shuffle consumed one random draw per position swap. Replay
			// its order selection against the resulting geometry to recover
			// the generated witness without relying on a greedy solver.
			r := &rng{2026}
			for i := len(s.Tiles) - 1; i > 0; i-- {
				r.next()
			}
			remaining = order(s.Tiles, r)
		}
		for _, id := range remaining {
			apply("pick", id)
		}
		if s.Status != "won" {
			t.Fatal("fixture did not finish its generated witness", tc.name)
		}
		fixtures = append(fixtures, map[string]any{"name": tc.name, "mode": tc.mode, "stage": tc.stage, "initial": initial, "events": events})
	}
	destination := filepath.Join("..", "..", "..", "artifacts")
	if e := os.MkdirAll(destination, 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(destination, "rule-fixtures.json"), raw(fixtures), 0644); e != nil {
		t.Fatal(e)
	}
}
func TestOpeningDifficultyDiagnostic(t *testing.T) {
	for _, mode := range []string{"classic", "quartet", "fun"} {
		wins := 0
		for seed := uint32(1); seed <= 100; seed++ {
			s, _, e := NewBoard(DefaultConfig(mode, 2), seed)
			if e != nil {
				t.Fatal(e)
			}
			for s.Status == "playing" {
				chosen, best := -1, -1
				held := []int{}
				for _, id := range s.Tray {
					held = append(held, s.Tiles[id].Kind)
				}
				for _, tile := range s.Tiles {
					if !s.Open(tile.ID) {
						continue
					}
					score := 0
					for _, k := range held {
						if k == tile.Kind {
							score++
						}
					}
					trial := append(append([]int{}, held...), tile.Kind)
					if len(match(trial, mode)) > 0 {
						score += 100
					}
					if score > best {
						best = score
						chosen = tile.ID
					}
				}
				if chosen < 0 {
					t.Fatal("no available tile")
				}
				if e = s.Pick(chosen); e != nil {
					t.Fatal(e)
				}
			}
			if s.Status == "won" {
				wins++
			}
		}
		t.Logf("%s hard level match-first bot (not human win rate): %d/100", mode, wins)
		if wins > 35 {
			t.Errorf("%s default challenge is too easily solved by a one-step greedy policy", mode)
		}
	}
}
