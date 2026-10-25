package game

import (
	"reflect"
	"testing"
)

func TestPairMigrationFallsBackAfterPartialFill(t *testing.T) {
	c := DefaultConfig("fun", 1)
	c.RulesVersion, c.Rules = LegacyRulesVersion, nil
	c.Columns, c.Rows = 6, 1
	c.Counts = make([]int, 15)
	copy(c.Counts, []int{15, 15, 15})
	c.Layers = []Layer{}
	for z := 0; z < 8; z++ {
		layer := Layer{Z: z, Cells: []Cell{}}
		start, end := 0, 10
		if z == 0 {
			end = 6
		}
		if z == 7 {
			start, end = 1, 9
		}
		for x := start; x <= end; x += 2 {
			layer.Cells = append(layer.Cells, Cell{X: x})
		}
		c.Layers = append(c.Layers, layer)
	}
	if err := Validate(c); err != nil {
		t.Fatal("invalid legacy fixture", err)
	}
	before := string(raw(c))
	// There are 45 cells, but only two vacancies; 48 cannot fit. The result
	// must trim one ORIGINAL cell to 44 and discard both attempted additions.
	next, err := normalizeFunPairs(c)
	if err != nil {
		t.Fatal("fallback retained partial additions", err)
	}
	if string(raw(c)) != before {
		t.Fatal("normalization mutated its input")
	}
	if len(next.Layers[0].Cells) != 4 || len(next.Layers[7].Cells) != 4 {
		t.Fatal("fallback changed more than the final original cell", next.Layers)
	}
	board, route, err := NewBoard(next, 19)
	if err != nil || len(board.Tiles) != 44 {
		t.Fatal("trimmed conversion is invalid", err, len(board.Tiles))
	}
	if err = verifyWitness(board, route); err != nil {
		t.Fatal(err)
	}
}

func TestPairMigrationFillsVacancyAndBoundsDominantKind(t *testing.T) {
	for _, counts := range [][]int{{3, 2, 2}, {15}, {3, 3, 3, 3, 3}, {1, 1, 1, 3}} {
		c := customConfig(t, [][]int{{3}, {2, 2}}, counts)
		c.Mode = "fun"
		before := string(raw(c))
		next, err := normalizeFunPairs(c)
		if err != nil {
			t.Fatal(counts, err)
		}
		if string(raw(c)) != before || !reflect.DeepEqual(next.FreeTools, c.FreeTools) || next.RewardCoins != c.RewardCoins {
			t.Fatal("conversion changed its input or unrelated settings")
		}
		for i, layer := range c.Layers {
			if !reflect.DeepEqual(next.Layers[i].Cells[:len(layer.Cells)], layer.Cells) {
				t.Fatal("conversion moved an existing cell")
			}
		}
		board, route, err := NewBoard(next, 71)
		if err != nil {
			t.Fatal(err)
		}
		if err = verifyWitness(board, route); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPairMigrationCountChangesAreMinimal(t *testing.T) {
	for a := 0; a <= 6; a++ {
		for b := 0; b <= 6; b++ {
			for c := 0; c <= 6; c++ {
				total := (a + b + c + 3) / 4 * 4
				if total == 0 {
					continue
				}
				previous := []int{a, b, c}
				next := nearestPairCounts(previous, total)
				cost := abs(next[0]-a) + abs(next[1]-b) + abs(next[2]-c)
				minimum := 1000
				for x := 0; x <= total/2; x += 2 {
					for y := 0; y <= total/2; y += 2 {
						z := total - x - y
						if z >= 0 && z <= total/2 {
							minimum = min(minimum, abs(x-a)+abs(y-b)+abs(z-c))
						}
					}
				}
				if _, err := pairGroups(next); err != nil || cost != minimum {
					t.Fatal("conversion changed more counts than necessary", previous, next, cost, minimum, err)
				}
			}
		}
	}
}

func TestPairMigrationPrefersExistingSpeciesWhenCostsTie(t *testing.T) {
	for _, tc := range []struct {
		previous []int
		want     []int
	}{
		{[]int{0, 6, 3}, []int{0, 6, 6}},
		{[]int{6, 0, 3}, []int{6, 0, 6}},
		{[]int{3, 6, 0}, []int{6, 6, 0}},
	} {
		c := customConfig(t, [][]int{{3}, {2, 2}}, tc.previous)
		c.Mode = "fun"
		next, err := normalizeFunPairs(c)
		if err != nil {
			t.Fatal(err)
		}
		want := make([]int, 15)
		copy(want, tc.want)
		if !reflect.DeepEqual(next.Counts, want) {
			t.Fatal("equal-cost normalization introduced an avoidable species", tc.previous, next.Counts, want)
		}
	}
}
