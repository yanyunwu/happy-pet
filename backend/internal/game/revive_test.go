package game

import (
	"reflect"
	"testing"
)

func TestReviveMovesThreeTrayTilesWithoutChargingAndOnlyOnce(t *testing.T) {
	s := extraSlotBoard([]int{0, 1, 2, 0, 1, 2, 0, 1, 2})
	for i := 0; i < 7; i++ {
		s.Tiles[i].Removed = true
	}
	s.Tray = []int{0, 1, 2, 3, 4, 5, 6}
	s.Status = "lost"
	s.Tools = map[string]int{"undo": 1, "shovel": 1, "hint": 3, "shuffle": 1}
	s.History = []Frame{{Status: "playing"}}
	beforeTools := raw(s.Tools)
	if err := s.Revive(); err != nil {
		t.Fatal(err)
	}
	if s.Status != "playing" || !s.ReviveUsed || !reflect.DeepEqual(s.Reserve, []int{0, 1, 2}) || !reflect.DeepEqual(s.Tray, []int{3, 4, 5, 6}) {
		t.Fatalf("unexpected revive: %+v", s)
	}
	if !reflect.DeepEqual(raw(s.Tools), beforeTools) || len(s.History) != 0 {
		t.Fatal("revive charged a tool or left undo history")
	}
	s.Status = "lost"
	before := raw(s)
	if err := s.Revive(); err == nil || !reflect.DeepEqual(raw(s), before) {
		t.Fatal("second revive changed state")
	}
}

func TestReviveHandlesFullReserveAndShortTray(t *testing.T) {
	t.Run("full reserve returns necessary tiles to board", func(t *testing.T) {
		s := extraSlotBoard([]int{0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4})
		for i := 0; i < 13; i++ {
			s.Tiles[i].Removed = true
		}
		s.Tray = []int{0, 1, 2, 3, 4, 5, 6}
		s.Reserve = []int{7, 8, 9, 10, 11, 12}
		s.Status = "lost"
		if err := s.Revive(); err != nil {
			t.Fatal(err)
		}
		if s.Status != "playing" || !reflect.DeepEqual(s.Tray, []int{3, 4, 5, 6}) || !reflect.DeepEqual(s.Reserve, []int{9, 10, 11, 12, 0, 1, 2}) || s.Tiles[7].Removed || s.Tiles[8].Removed || s.remaining()+len(s.Tray) != 15 {
			t.Fatalf("did not preserve tiles: %+v", s)
		}
	})
	t.Run("short tray is preserved", func(t *testing.T) {
		s := extraSlotBoard([]int{0, 0})
		for i := range s.Tiles {
			s.Tiles[i].Removed = true
		}
		s.Tray = []int{0, 1}
		s.Status = "lost"
		s.Capacity = 8
		s.Tools = map[string]int{"shuffle": 0}
		if err := s.Revive(); err != nil {
			t.Fatal(err)
		}
		if len(s.Tray) != 0 || !reflect.DeepEqual(s.Reserve, []int{0, 1}) || !s.ReviveUsed || s.Capacity != 8 || s.Tools["shuffle"] != 0 {
			t.Fatalf("did not preserve short tray: %+v", s)
		}
	})
}
