package game

import (
	"encoding/json"
	"reflect"
	"testing"
)

func extraSlotBoard(kinds []int) State {
	s := State{Frame: Frame{Status: "playing", Tiles: []Tile{}, Tray: []int{}, Reserve: []int{}}, Mode: "classic", Capacity: 7, RulesVersion: RulesVersion, Rules: [][]int{{3}}}
	for id, kind := range kinds {
		s.Tiles = append(s.Tiles, Tile{ID: id, Kind: kind, X: float64(id * 100)})
	}
	return s
}

func TestExtraSlotOnlyUnlocksOnceWhilePlaying(t *testing.T) {
	s, _, err := NewBoard(DefaultConfig("classic", 1), 42)
	if err != nil {
		t.Fatal(err)
	}
	before := raw(s)
	if s.Capacity != 7 {
		t.Fatal("fresh level does not have seven slots")
	}
	if err := s.UnlockExtraSlot(); err != nil || s.Capacity != 8 {
		t.Fatal("unlock did not add one slot", err)
	}
	if err := s.UnlockExtraSlot(); err == nil || s.Capacity != 8 {
		t.Fatal("repeat unlock changed capacity", err)
	}
	s.Capacity = 7
	if !reflect.DeepEqual(raw(s), before) {
		t.Fatal("unlock changed something other than capacity")
	}
	for _, status := range []string{"won", "lost", "abandoned"} {
		s.Status = status
		if err := s.UnlockExtraSlot(); err == nil || s.Capacity != 7 {
			t.Fatalf("terminal status %s accepted a reward", status)
		}
	}
	s.Status = "playing"
	for _, capacity := range []int{0, 6, 8, 9} {
		s.Capacity = capacity
		if err := s.UnlockExtraSlot(); err == nil || s.Capacity != capacity {
			t.Fatalf("invalid starting capacity %d accepted a reward", capacity)
		}
	}
}

func TestExtraSlotDefersOverflowUntilEighthUnmatchedCard(t *testing.T) {
	s := extraSlotBoard([]int{0, 1, 2, 3, 4, 5, 6, 7, 8})
	if err := s.UnlockExtraSlot(); err != nil {
		t.Fatal(err)
	}
	for id := 0; id < 7; id++ {
		if err := s.Pick(id); err != nil || s.Status != "playing" {
			t.Fatal("lost before using the extra slot", id, err)
		}
	}
	if len(s.Tray) != 7 {
		t.Fatal("seven unmatched cards were not retained")
	}
	if err := s.Pick(7); err != nil || s.Status != "lost" || len(s.Tray) != 8 {
		t.Fatal("eighth unmatched card did not lose", err)
	}
}

func TestExtraSlotResolvesMatchesBeforeOverflow(t *testing.T) {
	s := extraSlotBoard([]int{0, 0, 1, 2, 3, 4, 5, 0, 6})
	if err := s.UnlockExtraSlot(); err != nil {
		t.Fatal(err)
	}
	for id := 0; id < 8; id++ {
		if err := s.Pick(id); err != nil {
			t.Fatal(err)
		}
	}
	if s.Status != "playing" || len(s.Tray) != 5 || s.Cleared != 3 {
		t.Fatal("eighth card did not match before overflow", s)
	}
}

func TestExtraSlotSurvivesToolsAndJSONRecovery(t *testing.T) {
	s, route, err := NewBoard(DefaultConfig("classic", 1), 42)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Pick(route[0]); err != nil {
		t.Fatal(err)
	}
	if err := s.UnlockExtraSlot(); err != nil {
		t.Fatal(err)
	}
	// The pick's older frame was created before the reward was earned.
	if err := s.Tool("undo", 42); err != nil || s.Capacity != 8 || s.Moves != 0 {
		t.Fatal("undo reverted the reward", err)
	}
	if err := s.Pick(route[0]); err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"shovel", "shuffle"} {
		if err := s.Tool(tool, 42); err != nil || s.Capacity != 8 {
			t.Fatal("tool reverted the reward", tool, err)
		}
	}
	var restored State
	if err := json.Unmarshal(raw(s), &restored); err != nil || restored.Capacity != 8 {
		t.Fatal("JSON recovery lost the reward", err)
	}
	if err := restored.UnlockExtraSlot(); err == nil || restored.Capacity != 8 {
		t.Fatal("recovered level allowed a second reward")
	}
	for _, stage := range []int{1, 2} {
		c := DefaultConfig("classic", stage)
		fresh, _, err := NewBoard(c, 42)
		if err != nil || fresh.Capacity != 7 {
			t.Fatal("new level inherited the reward", stage, err)
		}
		c.Capacity = 8
		if err := Validate(c); err == nil {
			t.Fatal("level configuration bypassed the reward")
		}
	}
}
