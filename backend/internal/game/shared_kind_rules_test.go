package game

import (
	"reflect"
	"testing"
)

func TestSharedKindRulesConsumeEveryRequiredTileOnce(t *testing.T) {
	for _, tc := range []struct {
		name  string
		rule  []int
		kinds []int
		match bool
	}{
		{"two-pairs-distinct", []int{2, 2}, []int{0, 0, 1, 1}, true},
		{"two-pairs-same", []int{2, 2}, []int{0, 0, 0, 0}, true},
		{"two-pairs-not-three-one", []int{2, 2}, []int{0, 0, 0, 1}, false},
		{"two-pairs-cannot-reuse-pair", []int{2, 2}, []int{0, 0}, false},
		{"two-pairs-cannot-reuse-third-tile", []int{2, 2}, []int{0, 0, 0}, false},
		{"three-one-distinct", []int{3, 1}, []int{0, 0, 0, 1}, true},
		{"three-one-same", []int{3, 1}, []int{0, 0, 0, 0}, true},
		{"three-one-not-two-pairs", []int{3, 1}, []int{0, 0, 1, 1}, false},
		{"three-two-same", []int{3, 2}, []int{0, 0, 0, 0, 0}, true},
		{"three-two-not-four-one", []int{3, 2}, []int{0, 0, 0, 0, 1}, false},
		{"three-pairs-distinct", []int{2, 2, 2}, []int{0, 0, 1, 1, 2, 2}, true},
		{"three-pairs-partially-merged", []int{2, 2, 2}, []int{0, 0, 0, 0, 1, 1}, true},
		{"three-pairs-all-merged", []int{2, 2, 2}, []int{0, 0, 0, 0, 0, 0}, true},
		{"three-pairs-not-two-triples", []int{2, 2, 2}, []int{0, 0, 0, 1, 1, 1}, false},
		{"three-pairs-not-five-one", []int{2, 2, 2}, []int{0, 0, 0, 0, 0, 1}, false},
		{"three-pairs-cannot-reuse-four", []int{2, 2, 2}, []int{0, 0, 0, 0}, false},
		{"two-one-one-merge-singletons", []int{2, 1, 1}, []int{0, 0, 1, 1}, true},
		{"two-one-one-merge-unequal-groups", []int{2, 1, 1}, []int{0, 0, 0, 1}, true},
		{"two-one-one-all-merged", []int{2, 1, 1}, []int{0, 0, 0, 0}, true},
		{"three-two-one-merge-first-last", []int{3, 2, 1}, []int{0, 0, 0, 0, 1, 1}, true},
		{"three-two-one-merge-last-two", []int{3, 2, 1}, []int{0, 0, 0, 1, 1, 1}, true},
		{"three-two-one-merge-first-two", []int{3, 2, 1}, []int{0, 0, 0, 0, 0, 1}, true},
		{"three-two-one-cannot-split-group", []int{3, 2, 1}, []int{0, 0, 0, 0, 1, 2}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := matchRules(tc.kinds, [][]int{tc.rule})
			if !tc.match {
				if len(got) != 0 {
					t.Fatal("incomplete or incompatible groups cleared", got)
				}
				return
			}
			want := make([]int, len(tc.kinds))
			for i := range want {
				want[i] = i
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatal("must consume each required tile exactly once", got, want)
			}
		})
	}
}

func TestSharedKindRulesPreserveOriginalFirstAndRulePriority(t *testing.T) {
	for _, tc := range []struct {
		kinds []int
		rules [][]int
		want  []int
	}{
		{[]int{0, 0, 0, 0, 1, 1}, [][]int{{2, 2}}, []int{0, 1, 4, 5}},
		{[]int{0, 0, 0, 0, 1}, [][]int{{3, 1}}, []int{0, 1, 2, 4}},
		{[]int{0, 0, 0, 0}, [][]int{{2, 2}, {3}}, []int{0, 1, 2, 3}},
		{[]int{0, 0, 0, 0}, [][]int{{3}, {2, 2}}, []int{0, 1, 2}},
	} {
		if got := matchRules(tc.kinds, tc.rules); !reflect.DeepEqual(got, tc.want) {
			t.Fatal("rule priority or original distinct-kind preference changed", tc, got)
		}
	}
}

func TestSharedKindRulesExpandInDeterministicOrder(t *testing.T) {
	rules := [][]int{{3, 2, 1}, {2, 2}, {4}}
	before := string(raw(rules))
	got := [][]int{}
	for _, pattern := range triggerablePatterns(rules[:1]) {
		got = append(got, pattern.Counts)
	}
	want := [][]int{{3, 2, 1}, {4, 2}, {3, 3}, {5, 1}, {6}}
	if !reflect.DeepEqual(got, want) || string(raw(rules)) != before {
		t.Fatal("expansion order or input changed", got, want)
	}
	got = nil
	for _, pattern := range triggerablePatterns(rules[1:]) {
		got = append(got, pattern.Counts)
	}
	if !reflect.DeepEqual(got, [][]int{{2, 2}, {4}}) {
		t.Fatal("equivalent expanded patterns were not deduplicated", got)
	}
}

func TestSharedKindRulesClearBeforeFullTrayLoss(t *testing.T) {
	s := customState(t, [][]int{{2, 2}}, []int{0, 0, 0, 1, 2, 3, 0, 4})
	for id := 0; id < 6; id++ {
		if err := s.Pick(id); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.Tray) != 6 || s.Cleared != 0 {
		t.Fatal("an incomplete combination cleared")
	}
	if err := s.Pick(6); err != nil || s.Status != "playing" || s.Cleared != 4 || len(s.Tray) != 3 {
		t.Fatal("same-kind match did not clear before the full-tray loss check", s, err)
	}
	s = customState(t, [][]int{{3, 2, 2}}, []int{0, 0, 0, 0, 0, 0, 0})
	for id := range s.Tiles {
		if err := s.Pick(id); err != nil {
			t.Fatal(err)
		}
		if id < 6 && s.Cleared != 0 {
			t.Fatal("seven-tile combination cleared too early")
		}
	}
	if s.Status != "won" || s.Cleared != 7 || s.Matches != 1 {
		t.Fatal("merged seven-tile rule did not win on the last slot", s)
	}
}

func TestSharedKindRulesGeneratorAndShufflePreserveCounts(t *testing.T) {
	for _, tc := range []struct {
		rule   []int
		counts []int
	}{
		{[]int{2, 2}, []int{4}},
		{[]int{2, 2}, []int{188, 4}},
		{[]int{3, 1}, []int{4}},
		{[]int{3, 1}, []int{7, 1}},
		{[]int{3, 2}, []int{5}},
		{[]int{3, 2}, []int{8, 2}},
		{[]int{2, 2, 2}, []int{6}},
		{[]int{2, 2, 2}, []int{4, 2}},
		{[]int{2, 2, 2}, []int{10, 2}},
		{[]int{2, 2, 2}, []int{192}},
		{[]int{3, 2, 1}, []int{4, 2}},
		{[]int{3, 2, 1}, []int{3, 3}},
		{[]int{3, 2, 1}, []int{5, 1}},
	} {
		cfg := customConfig(t, [][]int{tc.rule}, tc.counts)
		before := string(raw(cfg))
		for seed := uint32(1); seed <= 4; seed++ {
			s, route, err := NewBoard(cfg, seed)
			if err != nil {
				t.Fatal(tc, seed, err)
			}
			if err = verifyWitness(s, route); err != nil {
				t.Fatal("initial merged-rule witness", tc, seed, err)
			}
			for _, id := range route[:3] {
				if err = s.Pick(id); err != nil {
					t.Fatal(err)
				}
			}
			if err = s.Tool("shovel", seed); err != nil {
				t.Fatal(err)
			}
			if err = s.Tool("shuffle", seed); err != nil {
				t.Fatal("merged-rule shuffle rejected tray/reserve", tc, seed, err)
			}
			counts := make([]int, 15)
			for _, tile := range s.Tiles {
				if !tile.Removed {
					counts[tile.Kind]++
				}
			}
			if !reflect.DeepEqual(counts, cfg.Counts) || string(raw(cfg)) != before || !reflect.DeepEqual(s.Rules, cfg.Rules) {
				t.Fatal("generator or shuffle changed quantities or stored rules", tc, counts, s.Rules)
			}
			r := &rng{seed}
			for i := len(s.Tiles) - 1; i > 0; i-- {
				r.next()
			}
			if err = verifyWitness(s, order(s.Tiles, r)); err != nil {
				t.Fatal("reshuffled merged-rule witness", tc, seed, err)
			}
		}
	}
}

func TestSharedKindRulesRejectInvalidCountsAndPreemptedMerges(t *testing.T) {
	for _, counts := range [][]int{{-4, 8}, {3, 1}, {2}, {6}, {2, 2, 2}} {
		if _, err := pairGroups(counts); err == nil {
			t.Fatal("invalid pair counts accepted", counts)
		}
	}
	for _, tc := range []struct {
		rules  [][]int
		counts []int
	}{
		{[][]int{{3, 1}}, []int{2, 2}},
		{[][]int{{3, 2}}, []int{4, 1}},
		{[][]int{{2, 2, 2}}, []int{3, 3}},
		{[][]int{{2, 2, 2}}, []int{5, 1}},
		{[][]int{{3}, {2, 2}}, []int{4}},
		{[][]int{{2, 2}, {3}}, []int{4}},
		{[][]int{{2, 2, 2}, {2, 2}}, []int{6}},
		{[][]int{{3, 2}, {2, 2}}, []int{5}},
	} {
		if err := Validate(customConfig(t, tc.rules, tc.counts)); err == nil {
			t.Fatal("incompatible counts or an early clear were ignored", tc)
		}
	}
}
