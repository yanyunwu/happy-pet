package game

import "fmt"

func (s *State) toolSource(entry, kind string, bag int32) (string, error) {
	if _, ok := s.Tools[kind]; !ok {
		return "", fmt.Errorf("未知道具")
	}
	if s.Tools[kind] > 0 {
		return "free", nil
	}
	if s.SharedTools[kind] {
		if s.ShareUses[kind] > 0 {
			return "share", nil
		}
		return "", fmt.Errorf("分享次数已用完")
	}
	if entry == "campaign" && !s.BagUsed[kind] && bag > 0 {
		return "bag", nil
	}
	return "", fmt.Errorf("免费次数已用完，请分享后使用")
}

func (s *State) consumeTool(kind, source string) {
	switch source {
	case "free":
		s.Tools[kind]--
	case "bag":
		if s.BagUsed == nil {
			s.BagUsed = map[string]bool{}
		}
		s.BagUsed[kind] = true
	case "share":
		s.ShareUses[kind]--
	}
}

func (s *State) shareTool(entry, kind string, bag int32) error {
	if s.Status != "playing" {
		return fmt.Errorf("对局已结束")
	}
	if _, ok := s.Tools[kind]; !ok {
		return fmt.Errorf("未知道具")
	}
	if s.SharedTools[kind] {
		return fmt.Errorf("已分享过该道具")
	}
	if s.Tools[kind] > 0 || (entry == "campaign" && !s.BagUsed[kind] && bag > 0) {
		return fmt.Errorf("请先使用当前次数")
	}
	if s.SharedTools == nil {
		s.SharedTools = map[string]bool{}
	}
	if s.ShareUses == nil {
		s.ShareUses = map[string]int{}
	}
	s.SharedTools[kind] = true
	s.ShareUses[kind] = 1
	return nil
}
