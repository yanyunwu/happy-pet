package game

import (
	"errors"
	"fmt"
	"slices"
	"sort"
)

const LegacyRulesVersion = "pet-rules-1"
const combinationBudget = 50000

var errComplexRules = errors.New("组合较复杂，请调整配置")
var errUnmatchableCounts = errors.New("这些萌宠数量无法按当前规则全部消除")

func defaultRules(mode string) [][]int {
	switch mode {
	case "quartet":
		return [][]int{{4}}
	case "fun":
		return [][]int{{2, 2}}
	default:
		return [][]int{{3}}
	}
}

// Historical snapshots without a rules field retain the original semantics.
// This also identifies the original generator fast paths for deterministic replay.
func legacyDefaultRules(mode string) [][]int {
	if mode == "fun" {
		return [][]int{{3}, {2, 2}}
	}
	return defaultRules(mode)
}

func equalRules(a, b [][]int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !slices.Equal(a[i], b[i]) {
			return false
		}
	}
	return true
}

// CanonicalRules normalizes within each pattern while retaining rule priority.
// Legacy revisions may omit rules, but must never acquire custom behavior.
func CanonicalRules(mode, version string, rules [][]int) ([][]int, error) {
	if !ValidMode(mode) || (version != LegacyRulesVersion && version != RulesVersion) {
		return nil, fmt.Errorf("规则或版本不支持")
	}
	if version == LegacyRulesVersion && len(rules) == 0 {
		return legacyDefaultRules(mode), nil
	}
	if len(rules) < 1 || len(rules) > 6 {
		return nil, fmt.Errorf("请配置 1–6 条消除规则")
	}
	out := make([][]int, 0, len(rules))
	seen := map[string]bool{}
	for _, rule := range rules {
		if len(rule) < 1 || len(rule) > 7 {
			return nil, fmt.Errorf("每条规则总数为 2–7，组内数量为正整数")
		}
		total := 0
		for _, n := range rule {
			if n < 1 || n > 7 {
				return nil, fmt.Errorf("每条规则总数为 2–7，组内数量为正整数")
			}
			total += n
		}
		if total < 2 || total > 7 {
			return nil, fmt.Errorf("每条规则总数为 2–7，不能超过收纳槽容量")
		}
		pattern := append([]int{}, rule...)
		sort.Sort(sort.Reverse(sort.IntSlice(pattern)))
		key := fmt.Sprint(pattern)
		if seen[key] {
			return nil, fmt.Errorf("消除规则不可重复")
		}
		seen[key] = true
		out = append(out, pattern)
	}
	if version == LegacyRulesVersion && !equalRules(out, legacyDefaultRules(mode)) {
		return nil, fmt.Errorf("旧规则版本不支持自定义组合，请使用新规则版本")
	}
	return out, nil
}

// AuthoringRules constrains new writes without changing historical runtime rules.
func AuthoringRules(c Config) ([][]int, error) {
	rules, err := CanonicalRules(c.Mode, c.RulesVersion, c.Rules)
	if err != nil {
		return nil, err
	}
	if len(rules) != 1 {
		return nil, fmt.Errorf("每关只能选择一种消除规则，请重新选择")
	}
	return rules, nil
}

func presetMode(rules [][]int) string {
	for _, mode := range []string{"classic", "quartet", "fun"} {
		if equalRules(rules, legacyDefaultRules(mode)) {
			return mode
		}
	}
	return ""
}

// expandedPatterns includes every way that groups may share a kind. Separate
// groups are tried first so the original pattern and rule priority stay intact.
// Every result uses distinct kinds with summed counts, preventing tile reuse.
func expandedPatterns(rules [][]int) [][]int {
	patterns := [][]int{}
	seen := map[string]bool{}
	for _, rule := range rules {
		groups := []int{}
		var expand func(int)
		expand = func(slot int) {
			if slot == len(rule) {
				pattern := append([]int{}, groups...)
				sort.Sort(sort.Reverse(sort.IntSlice(pattern)))
				key := fmt.Sprint(pattern)
				if !seen[key] {
					seen[key] = true
					patterns = append(patterns, pattern)
				}
				return
			}
			amount := rule[slot]
			groups = append(groups, amount)
			expand(slot + 1)
			groups = groups[:len(groups)-1]
			seenSums := map[int]bool{}
			for i, sum := range groups {
				if seenSums[sum] {
					continue
				}
				seenSums[sum] = true
				groups[i] += amount
				expand(slot + 1)
				groups[i] -= amount
			}
		}
		expand(0)
	}
	return patterns
}

func matchRules(kinds []int, rules [][]int) []int {
	return matchPatterns(kinds, expandedPatterns(rules))
}

// matchPatterns assigns distinct kinds in their first tray appearance order.
// Each effective pattern slot takes the first N indices of its selected kind.
func matchPatterns(kinds []int, patterns [][]int) []int {
	order := []int{}
	indices := map[int][]int{}
	for i, kind := range kinds {
		if len(indices[kind]) == 0 {
			order = append(order, kind)
		}
		indices[kind] = append(indices[kind], i)
	}
	for _, rule := range patterns {
		used := map[int]bool{}
		matched := []int{}
		var assignKind func(int) bool
		assignKind = func(slot int) bool {
			if slot == len(rule) {
				return true
			}
			for _, kind := range order {
				if used[kind] || len(indices[kind]) < rule[slot] {
					continue
				}
				used[kind] = true
				previous := len(matched)
				matched = append(matched, indices[kind][:rule[slot]]...)
				if assignKind(slot + 1) {
					return true
				}
				matched = matched[:previous]
				delete(used, kind)
			}
			return false
		}
		if assignKind(0) {
			sort.Ints(matched)
			return matched
		}
	}
	return nil
}

type triggerPattern struct {
	Counts []int
	Order  []int
}

// A group is usable only if some arrival order avoids every early match and
// clears the whole group on its last tile. Priority matters when several rules
// first become eligible together. At most product(count+1) <= 128 prefix-count
// states exist per pattern, because its total size is bounded by seven.
func triggerablePatterns(rules [][]int) []triggerPattern {
	patterns := []triggerPattern{}
	effective := expandedPatterns(rules)
	for _, pattern := range effective {
		total := 0
		for _, n := range pattern {
			total += n
		}
		used := make([]int, len(pattern))
		prefix := []int{}
		bad := map[string]bool{}
		var search func() bool
		search = func() bool {
			key := fmt.Sprint(used)
			if bad[key] {
				return false
			}
			matched := matchPatterns(prefix, effective)
			if len(matched) > 0 || len(prefix) == total {
				if len(prefix) == total && len(matched) == total {
					return true
				}
				bad[key] = true
				return false
			}
			for kind, n := range pattern {
				if used[kind] >= n {
					continue
				}
				used[kind]++
				prefix = append(prefix, kind)
				if search() {
					return true
				}
				prefix = prefix[:len(prefix)-1]
				used[kind]--
			}
			bad[key] = true
			return false
		}
		if search() {
			patterns = append(patterns, triggerPattern{Counts: pattern, Order: append([]int{}, prefix...)})
		}
	}
	return patterns
}

func ruleGroups(counts []int, rules [][]int) ([][]int, error) {
	if equalRules(rules, [][]int{{2, 2}}) {
		return pairGroups(counts)
	}
	if mode := presetMode(rules); mode != "" {
		result := groups(counts, mode)
		if result == nil {
			return nil, errUnmatchableCounts
		}
		return result, nil
	}
	return decomposePatterns(counts, rules, combinationBudget)
}

// Each count must be even and the total divisible by four. Prefer two distinct
// species while possible; the last species can supply both pairs itself.
func pairGroups(counts []int) ([][]int, error) {
	pairs := make([]int, len(counts))
	total := 0
	for kind, count := range counts {
		if count < 0 || count%2 != 0 {
			return nil, errUnmatchableCounts
		}
		pairs[kind] = count / 2
		total += count
	}
	if total%4 != 0 {
		return nil, errUnmatchableCounts
	}
	result := [][]int{}
	for remaining := total; remaining > 0; remaining -= 4 {
		kinds := []int{}
		for kind, count := range pairs {
			if count > 0 {
				kinds = append(kinds, kind)
			}
		}
		sort.SliceStable(kinds, func(i, j int) bool { return pairs[kinds[i]] > pairs[kinds[j]] })
		a, b := kinds[0], kinds[0]
		if len(kinds) > 1 {
			b = kinds[1]
		}
		result = append(result, []int{a, a, b, b})
		pairs[a]--
		pairs[b]--
	}
	return result, nil
}

// Species labels do not affect feasibility. Sorting remaining counts provides
// a shared failed-state cache; equal-count candidates are symmetric as well.
// The budget counts both searches and assignment attempts, bounding branching.
func decomposePatterns(counts []int, rules [][]int, budget int) ([][]int, error) {
	patterns := triggerablePatterns(rules)
	remaining := append([]int{}, counts...)
	bad := map[string]bool{}
	result := [][]int{}
	exhausted := false
	spend := func() bool {
		budget--
		if budget < 0 {
			exhausted = true
			return false
		}
		return true
	}
	var search func() bool
	search = func() bool {
		if !spend() {
			return false
		}
		anchor := -1
		keyCounts := make([]int, len(remaining))
		copy(keyCounts, remaining)
		for kind, n := range remaining {
			if n > 0 && anchor < 0 {
				anchor = kind
			}
		}
		if anchor < 0 {
			return true
		}
		sort.Ints(keyCounts)
		key := fmt.Sprint(keyCounts)
		if bad[key] {
			return false
		}
		for _, pattern := range patterns {
			amounts := pattern.Counts
			seenAnchor := map[int]bool{}
			for anchorSlot, amount := range amounts {
				if seenAnchor[amount] || remaining[anchor] < amount {
					continue
				}
				seenAnchor[amount] = true
				chosen := make([]int, len(amounts))
				for i := range chosen {
					chosen[i] = -1
				}
				chosen[anchorSlot] = anchor
				used := make([]bool, len(remaining))
				used[anchor] = true
				var assignKind func(int) bool
				assignKind = func(slot int) bool {
					if !spend() {
						return false
					}
					if slot == len(amounts) {
						group := []int{}
						for i, kind := range chosen {
							remaining[kind] -= amounts[i]
						}
						for _, kind := range pattern.Order {
							group = append(group, chosen[kind])
						}
						result = append(result, group)
						if search() {
							return true
						}
						result = result[:len(result)-1]
						for i, kind := range chosen {
							remaining[kind] += amounts[i]
						}
						return false
					}
					if slot == anchorSlot {
						return assignKind(slot + 1)
					}
					seenCounts := map[int]bool{}
					for kind, n := range remaining {
						if used[kind] || n < amounts[slot] || seenCounts[n] {
							continue
						}
						seenCounts[n] = true
						chosen[slot], used[kind] = kind, true
						if assignKind(slot + 1) {
							return true
						}
						used[kind] = false
						if exhausted {
							return false
						}
					}
					return false
				}
				if assignKind(0) {
					return true
				}
				if exhausted {
					return false
				}
			}
		}
		bad[key] = true
		return false
	}
	if search() {
		return result, nil
	}
	if exhausted {
		return nil, errComplexRules
	}
	return nil, errUnmatchableCounts
}

func assignRules(tiles []Tile, counts []int, rules [][]int, r *rng) ([]int, error) {
	if mode := presetMode(rules); mode != "" {
		return assign(tiles, counts, mode, r), nil
	}
	gs, err := ruleGroups(counts, rules)
	if err != nil {
		return nil, err
	}
	seq := order(tiles, r)
	shuffle(gs, r)
	kinds := []int{}
	for _, group := range gs {
		kinds = append(kinds, group...)
	}
	if len(kinds) != len(seq) {
		return nil, fmt.Errorf("方块数量与可移除路径不一致")
	}
	for i, id := range seq {
		tiles[id].Kind = kinds[i]
	}
	return seq, nil
}

func verifyWitness(s State, route []int) error {
	s.Frame = cloneFrame(s.Frame)
	s.History = nil
	for _, id := range route {
		if err := s.Pick(id); err != nil {
			return err
		}
	}
	if s.Status != "won" {
		return fmt.Errorf("组合未通过实际消除路径校验")
	}
	return nil
}
