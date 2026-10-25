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
	s := State{Frame: Frame{Status: "playing", Tiles: []Tile{}, Tray: []int{}, Reserve: []int{}}, Mode: "fun", Capacity: 7}
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
	for _, mode := range []string{"classic", "quartet", "fun"} {
		for stage := 1; stage <= 2; stage++ {
			c := DefaultConfig(mode, stage)
			s, route, e := NewBoard(c, 97)
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
			apply("undo", 0)
			apply("pick", route[0])
			apply("shovel", 0)
			apply("pick", route[0])
			apply("hint", 0)
			for _, id := range route[1:] {
				apply("pick", id)
			}
			fixtures = append(fixtures, map[string]any{"mode": mode, "stage": stage, "initial": initial, "events": events})
		}
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
