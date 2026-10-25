package game

import (
	"reflect"
	"testing"
)

func TestFunDefaultsUseOnlyTwoPairs(t *testing.T) {
	for stage := 1; stage <= 2; stage++ {
		c := DefaultConfig("fun", stage)
		if !reflect.DeepEqual(c.Rules, [][]int{{2, 2}}) {
			t.Fatalf("stage %d still permits multiple rules: %v", stage, c.Rules)
		}
		want := make([]int, 15)
		if stage == 1 {
			copy(want, []int{4, 2, 2})
		} else {
			for kind := range want {
				want[kind] = 6
				if kind < 9 {
					want[kind] = 8
				}
			}
		}
		if !reflect.DeepEqual(c.Counts, want) {
			t.Fatal("unexpected pure-pair counts", stage, c.Counts)
		}
	}
	s := customState(t, DefaultConfig("fun", 1).Rules, []int{0, 0, 0, 1, 1, 0, 2, 2})
	for id := 0; id < 3; id++ {
		if err := s.Pick(id); err != nil {
			t.Fatal(err)
		}
	}
	if s.Cleared != 0 || len(s.Tray) != 3 {
		t.Fatal("three equal kinds still clear in the default fun mode")
	}
}

func TestPurePairCountsAndReshuffleWitness(t *testing.T) {
	for _, counts := range [][]int{{3, 3, 2}, {6, 2}, {2, 2, 2}, {8}} {
		if err := Validate(customConfig(t, [][]int{{2, 2}}, counts)); err == nil {
			t.Fatal("unmatchable pure-pair counts accepted", counts)
		}
	}
	for _, counts := range [][]int{{4, 2, 2}, {48, 48, 48, 48}, {96, 96}} {
		c := customConfig(t, [][]int{{2, 2}}, counts)
		for seed := uint32(1); seed <= 20; seed++ {
			s, route, err := NewBoard(c, seed)
			if err != nil {
				t.Fatal(err)
			}
			if err = verifyWitness(s, route); err != nil {
				t.Fatal("initial pair witness", counts, seed, err)
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
				t.Fatal("pure-pair shuffle rejected tray/reserve", counts, seed, err)
			}
			r := &rng{seed}
			for i := len(s.Tiles) - 1; i > 0; i-- {
				r.next()
			}
			if err = verifyWitness(s, order(s.Tiles, r)); err != nil {
				t.Fatal("reshuffled pair witness", counts, seed, err)
			}
		}
	}
}
