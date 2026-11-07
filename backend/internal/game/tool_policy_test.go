package game

import "testing"

func TestToolAllowanceStages(t *testing.T) {
	for _, entry := range []string{"standard", "campaign"} {
		t.Run(entry, func(t *testing.T) {
			s := State{Frame: Frame{Status: "playing"}, Tools: map[string]int{"hint": 1}}
			if source, err := s.toolSource(entry, "hint", 4); err != nil || source != "free" {
				t.Fatalf("free: %s %v", source, err)
			}
			s.consumeTool("hint", "free")
			if entry == "campaign" {
				if source, err := s.toolSource(entry, "hint", 4); err != nil || source != "bag" {
					t.Fatalf("bag: %s %v", source, err)
				}
				s.consumeTool("hint", "bag")
			}
			if _, err := s.toolSource(entry, "hint", 4); err == nil {
				t.Fatal("unshared use accepted")
			}
			if err := s.shareTool(entry, "hint", 4); err != nil {
				t.Fatal(err)
			}
			if source, err := s.toolSource(entry, "hint", 4); err != nil || source != "share" {
				t.Fatalf("share: %s %v", source, err)
			}
			s.consumeTool("hint", "share")
			if _, err := s.toolSource(entry, "hint", 4); err == nil {
				t.Fatal("use after share accepted")
			}
			if err := s.shareTool(entry, "hint", 4); err == nil {
				t.Fatal("second share accepted")
			}
		})
	}
}
func TestShareStageSkipsEmptyInventoryAndDoesNotReopen(t *testing.T) {
	s := State{Frame: Frame{Status: "playing"}, Tools: map[string]int{"hint": 0, "undo": 1}}
	if err := s.shareTool("campaign", "undo", 0); err == nil {
		t.Fatal("shared before free allowance was used")
	}
	if err := s.shareTool("campaign", "hint", 1); err == nil {
		t.Fatal("shared before available inventory was used")
	}
	if err := s.shareTool("campaign", "hint", 0); err != nil {
		t.Fatal(err)
	}
	source, err := s.toolSource("campaign", "hint", 10)
	if err != nil || source != "share" {
		t.Fatalf("stock increase reopened inventory stage: %q %v", source, err)
	}
	s.consumeTool("hint", source)
	if _, err := s.toolSource("campaign", "hint", 10); err == nil {
		t.Fatal("stock increase reopened exhausted share stage")
	}
	if s.SharedTools["undo"] {
		t.Fatal("share affected a different tool")
	}
}
