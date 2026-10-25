package game

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// Encode new rule fields through JSON so the initial tests exercise the old
// implementation and fail for its behavior, rather than a missing Go field.
func customConfig(t *testing.T, rules [][]int, quantities []int) Config {
	t.Helper()
	c := DefaultConfig("classic", 1)
	c.Columns, c.Rows = 6, 8
	c.Counts = make([]int, 15)
	copy(c.Counts, quantities)
	c.Layers = []Layer{}
	total := 0
	for _, n := range quantities {
		total += n
	}
	for i := 0; i < total; i++ {
		z := i / 48
		if len(c.Layers) <= z {
			c.Layers = append(c.Layers, Layer{Z: z, Cells: []Cell{}})
		}
		c.Layers[z].Cells = append(c.Layers[z].Cells, Cell{X: (i % 6) * 2, Y: ((i % 48) / 6) * 2})
	}
	data := map[string]any{}
	if err := json.Unmarshal(raw(c), &data); err != nil {
		t.Fatal(err)
	}
	data["rulesVersion"], data["rules"] = "pet-rules-2", rules
	if err := json.Unmarshal(raw(data), &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func customState(t *testing.T, rules [][]int, kinds []int) State {
	t.Helper()
	s := State{Frame: Frame{Tiles: []Tile{}, Tray: []int{}, Reserve: []int{}, Status: "playing"}, Mode: "classic", Capacity: 7, Tools: map[string]int{}}
	for id, kind := range kinds {
		s.Tiles = append(s.Tiles, Tile{ID: id, Kind: kind, X: float64(id * 100)})
	}
	data := map[string]any{}
	if err := json.Unmarshal(raw(s), &data); err != nil {
		t.Fatal(err)
	}
	data["rulesVersion"], data["rules"] = "pet-rules-2", rules
	if err := json.Unmarshal(raw(data), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCustomRulesMatchWholePatterns(t *testing.T) {
	for _, tc := range []struct {
		name  string
		rules [][]int
		kinds []int
	}{
		{"three", [][]int{{3}}, []int{0, 0, 0}},
		{"four", [][]int{{4}}, []int{0, 0, 0, 0}},
		{"two-pairs", [][]int{{2, 2}}, []int{0, 1, 0, 1}},
		{"three-plus-two", [][]int{{2, 3}}, []int{0, 1, 0, 1, 0}},
		{"three-pairs", [][]int{{2, 2, 2}}, []int{0, 1, 2, 0, 1, 2}},
		{"five", [][]int{{5}}, []int{0, 0, 0, 0, 0}},
		{"two-plus-one", [][]int{{2, 1}}, []int{0, 1, 0}},
		{"seven-before-full-loss", [][]int{{7}}, []int{0, 0, 0, 0, 0, 0, 0}},
		{"mixed-patterns", [][]int{{3}, {2, 2}}, []int{0, 0, 0, 1, 2, 1, 2}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := customState(t, tc.rules, tc.kinds)
			for id := range tc.kinds {
				if err := s.Pick(id); err != nil {
					t.Fatal(err)
				}
			}
			if s.Status != "won" || s.Cleared != len(tc.kinds) || len(s.Tray) != 0 {
				t.Fatalf("configured pattern did not clear: status=%s cleared=%d tray=%v", s.Status, s.Cleared, s.Tray)
			}
		})
	}
	for _, rule := range [][][]int{{{2, 2}}, {{2, 1}}, {{3, 2}}, {{2, 2, 2}}} {
		s := customState(t, rule, []int{0, 0, 0, 0, 0, 0, 0})
		for id := range s.Tiles {
			if err := s.Pick(id); err != nil {
				t.Fatal(err)
			}
		}
		if s.Cleared != 0 || s.Status != "lost" {
			t.Fatal("one kind filled multiple slots of a rule", rule, s.Cleared)
		}
	}
}

func TestCustomRulesGeneratorWitnessAndTools(t *testing.T) {
	for _, tc := range []struct {
		rules  [][]int
		counts []int
	}{
		{[][]int{{4}}, []int{8, 4}},
		{[][]int{{2, 2}}, []int{4, 4, 4}},
		{[][]int{{3, 2}}, []int{6, 4, 3, 2}},
		{[][]int{{2, 2, 2}}, []int{4, 4, 4}},
		{[][]int{{5}}, []int{5, 10}},
		{[][]int{{2, 1}}, []int{4, 2}},
		{[][]int{{3}, {2, 2}}, []int{3, 2, 2}},
		{[][]int{{3, 1}, {2, 2}}, []int{5, 3, 4}},
		{[][]int{{7}}, []int{14, 7}},
	} {
		c := customConfig(t, tc.rules, tc.counts)
		for seed := uint32(1); seed <= 12; seed++ {
			s, route, err := NewBoard(c, seed)
			if err != nil {
				t.Fatalf("%v/%v: %v", tc.rules, tc.counts, err)
			}
			before := cloneFrame(s.Frame)
			if err = s.Pick(route[0]); err != nil {
				t.Fatal(err)
			}
			if err = s.Tool("undo", seed); err != nil || !reflect.DeepEqual(s.Frame, before) {
				t.Fatal("custom-rule undo failed", err)
			}
			if err = s.Pick(route[0]); err != nil {
				t.Fatal(err)
			}
			if err = s.Tool("shovel", seed); err != nil {
				t.Fatal(err)
			}
			if err = s.Pick(route[0]); err != nil {
				t.Fatal(err)
			}
			for _, id := range route[1:] {
				if err = s.Pick(id); err != nil {
					t.Fatal(err)
				}
			}
			if s.Status != "won" {
				t.Fatal("generated custom witness did not win", tc.rules, tc.counts, seed)
			}
			s, _, err = NewBoard(c, seed)
			if err != nil {
				t.Fatal(err)
			}
			if err = s.Tool("shuffle", seed); err != nil {
				t.Fatal("custom shuffle failed", err)
			}
		}
	}
}

func TestCustomRulesRejectInvalidAndPreemptedPatterns(t *testing.T) {
	for _, rules := range [][][]int{nil, {}, {{}}, {{0, 3}}, {{-1, 3}}, {{1}}, {{8}}, {{4, 4}}, {{3, 2}, {2, 3}}, {{2}, {3}, {4}, {5}, {6}, {7}, {2, 1}}} {
		if err := Validate(customConfig(t, rules, []int{6})); err == nil {
			t.Fatal("invalid rules accepted", rules)
		}
	}
	for _, rules := range [][][]int{{{3}, {4}}, {{4}, {3}}} {
		if err := Validate(customConfig(t, rules, []int{4})); err == nil {
			t.Fatal("arithmetic grouping accepted a pattern preempted by triples", rules)
		}
	}
	legacy := customConfig(t, [][]int{{2}}, []int{6})
	legacy.RulesVersion = "pet-rules-1"
	if err := Validate(legacy); err == nil {
		t.Fatal("v1 accepted nondefault rules")
	}
}

func TestCustomShuffleFailureLeavesStateUntouched(t *testing.T) {
	// This remainder cannot form a 3+2 group, although classic would accept six.
	s := customState(t, [][]int{{3, 2}}, []int{0, 0, 0, 0, 0, 0})
	before := string(raw(s))
	if err := s.Tool("shuffle", 1); err == nil {
		t.Fatal("unmatchable custom remainder shuffled")
	}
	if string(raw(s)) != before {
		t.Fatal("failed shuffle mutated state")
	}
}

func TestLegacyRuleVersionStillBuildsOriginalBoard(t *testing.T) {
	for _, mode := range []string{"classic", "quartet", "fun"} {
		c := DefaultConfig(mode, 1)
		if mode == "fun" {
			c.Rules = [][]int{{3}, {2, 2}}
			c.Counts[0] = 3
			c.Layers[0].Cells = c.Layers[0].Cells[:7]
		}
		data := map[string]any{}
		if err := json.Unmarshal(raw(c), &data); err != nil {
			t.Fatal(err)
		}
		data["rulesVersion"] = "pet-rules-1"
		delete(data, "rules")
		var legacy Config
		if err := json.Unmarshal(raw(data), &legacy); err != nil {
			t.Fatal(err)
		}
		s, route, err := NewBoard(legacy, 97)
		if err != nil {
			t.Fatal(err)
		}
		if s.RulesVersion != "pet-rules-1" || !strings.Contains(string(raw(s)), `"rules":`) {
			t.Fatal("legacy board lost its actual version or canonical rules")
		}
		current, currentRoute, err := NewBoard(c, 97)
		if err != nil || !reflect.DeepEqual(s.Frame, current.Frame) || !reflect.DeepEqual(route, currentRoute) {
			t.Fatal("new default rules changed the old board difficulty or witness", err)
		}
		for _, id := range route {
			if err := s.Pick(id); err != nil {
				t.Fatal(err)
			}
		}
		if s.Status != "won" {
			t.Fatal("legacy witness changed")
		}
	}
}

func TestRulePriorityAndTrayCandidateOrder(t *testing.T) {
	for _, tc := range []struct {
		kinds []int
		rules [][]int
		want  []int
	}{
		{[]int{9, 1, 9, 1, 9, 2, 2}, [][]int{{2, 2}, {3}}, []int{0, 1, 2, 3}},
		{[]int{9, 1, 9, 1, 9, 2, 2}, [][]int{{3}, {2, 2}}, []int{0, 2, 4}},
		{[]int{7, 9, 9, 7, 7, 9}, [][]int{{3, 2}}, []int{0, 1, 2, 3, 4}},
		{[]int{5, 4, 4}, [][]int{{2, 1}}, []int{0, 1, 2}},
		{[]int{0, 0, 0, 0, 0}, [][]int{{3, 2}}, nil},
	} {
		if got := matchRules(tc.kinds, tc.rules); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("kinds=%v rules=%v got=%v want=%v", tc.kinds, tc.rules, got, tc.want)
		}
	}
	input := [][]int{{1, 3}, {2, 2}}
	canonical, err := CanonicalRules("classic", RulesVersion, input)
	if err != nil || !reflect.DeepEqual(canonical, [][]int{{3, 1}, {2, 2}}) || !reflect.DeepEqual(input, [][]int{{1, 3}, {2, 2}}) {
		t.Fatal("normalization changed priority or mutated its input", canonical, input, err)
	}
}

func TestCustomCombinationSearchBudget(t *testing.T) {
	counts := []int{6, 4}
	if _, err := decomposePatterns(counts, [][]int{{3, 2}}, 1); !errors.Is(err, errComplexRules) {
		t.Fatal("search budget did not report the actionable complexity error", err)
	}
	if !reflect.DeepEqual(counts, []int{6, 4}) {
		t.Fatal("search modified caller counts")
	}
	groups, err := decomposePatterns(counts, [][]int{{3, 2}}, combinationBudget)
	if err != nil || len(groups) != 2 {
		t.Fatal("valid decomposition failed with normal budget", groups, err)
	}
}

func TestPriorityAwarePatternFeasibility(t *testing.T) {
	for _, tc := range []struct {
		name  string
		rules [][]int
		valid bool
	}{
		{"five-before-pairs", [][]int{{3, 2}, {2, 2}}, true},
		{"five-before-triples", [][]int{{3, 2}, {3}}, true},
		{"pairs-before-five", [][]int{{2, 2}, {3, 2}}, false},
		{"triples-before-five", [][]int{{3}, {3, 2}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := customConfig(t, tc.rules, []int{3, 2})
			if !tc.valid {
				if err := Validate(cfg); err == nil {
					t.Fatal("lower-priority five-tile rule incorrectly bypassed an earlier match")
				}
				return
			}
			for seed := uint32(1); seed <= 8; seed++ {
				s, route, err := NewBoard(cfg, seed)
				if err != nil {
					t.Fatal("a realizable five-tile pattern was rejected", err)
				}
				for i, id := range route {
					if err = s.Pick(id); err != nil {
						t.Fatal(err)
					}
					if i < len(route)-1 && s.Cleared != 0 {
						t.Fatal("generated group matched before all five tiles arrived")
					}
				}
				if s.Status != "won" || s.Matches != 1 {
					t.Fatal("higher-priority five-tile rule did not clear the full group")
				}
				s = customState(t, tc.rules, []int{0, 0, 0, 1, 1})
				if err = s.Tool("shuffle", seed); err != nil {
					t.Fatal("shuffle rejected a realizable priority-sensitive group", err)
				}
				r := &rng{seed}
				for i := len(s.Tiles) - 1; i > 0; i-- {
					r.next()
				}
				if err = verifyWitness(s, order(s.Tiles, r)); err != nil {
					t.Fatal("shuffle did not preserve its playable draw order", err)
				}
			}
		})
	}
}
