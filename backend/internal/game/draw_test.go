package game

import (
	"reflect"
	"testing"
)

func drawFixture() State {
	return State{
		Frame: Frame{Status: "playing", Tiles: []Tile{
			{ID: 0, Kind: 0, X: 0, Y: 0, Layer: 0},
			{ID: 1, Kind: 1, X: 0, Y: 0, Layer: 1},
			{ID: 2, Kind: 2, X: 300, Y: 0, Layer: 0},
		}},
		Mode: "classic", Capacity: 7, RulesVersion: RulesVersion, Rules: [][]int{{3}},
	}
}

func TestDrawTakesOnlyCoveredBoardTileAndCanUndo(t *testing.T) {
	s := drawFixture()
	before := cloneFrame(s.Frame)
	if err := s.Tool("draw", 42); err != nil {
		t.Fatal(err)
	}
	if !s.Tiles[0].Removed || s.Tiles[1].Removed || s.Tiles[2].Removed || !reflect.DeepEqual(s.Tray, []int{0}) {
		t.Fatalf("draw did not take the covered tile: %+v", s.Frame)
	}
	if s.Moves != 1 {
		t.Fatalf("draw should count as a move: %d", s.Moves)
	}
	if err := s.Tool("undo", 0); err != nil || !reflect.DeepEqual(s.Frame, before) {
		t.Fatalf("undo did not restore the board before drawing: %+v, %v", s.Frame, err)
	}
}

func TestDrawWithoutCoveredTileDoesNotChangeBoard(t *testing.T) {
	s := drawFixture()
	s.Tiles[1].Removed = true
	before := cloneFrame(s.Frame)
	if err := s.Tool("draw", 1); err == nil {
		t.Fatal("draw accepted when there are no covered tiles")
	}
	if !reflect.DeepEqual(before, cloneFrame(s.Frame)) || len(s.History) != 0 {
		t.Fatal("failed draw changed the board")
	}
}

func TestDrawUsesNormalMatchResolution(t *testing.T) {
	s := drawFixture()
	s.Tiles = append(s.Tiles, Tile{ID: 3, Kind: 0, Removed: true}, Tile{ID: 4, Kind: 0, Removed: true})
	s.Tray = []int{3, 4}
	if err := s.Tool("draw", 7); err != nil {
		t.Fatal(err)
	}
	if len(s.Tray) != 0 || s.Cleared != 3 || s.Matches != 1 || s.Status != "playing" {
		t.Fatalf("draw failed to resolve a three-tile match: %+v", s.Frame)
	}
}

func TestDrawUsesSeedToChooseAmongCoveredTiles(t *testing.T) {
	chosen := map[int]bool{}
	for seed := uint32(1); seed <= 32; seed++ {
		first := drawFixture()
		first.Tiles = append(first.Tiles, Tile{ID: 3, Kind: 3, X: 300, Y: 0, Layer: 1})
		second := drawFixture()
		second.Tiles = append(second.Tiles, Tile{ID: 3, Kind: 3, X: 300, Y: 0, Layer: 1})
		if err := first.Tool("draw", seed); err != nil {
			t.Fatal(err)
		}
		if err := second.Tool("draw", seed); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(first.Frame, second.Frame) {
			t.Fatal("the same seed produced a different draw")
		}
		if len(first.Tray) != 1 || (first.Tray[0] != 0 && first.Tray[0] != 2) {
			t.Fatalf("draw selected an open tile: %v", first.Tray)
		}
		chosen[first.Tray[0]] = true
	}
	if len(chosen) != 2 {
		t.Fatal("all tested seeds picked the same covered tile", chosen)
	}
}
