// Package game owns the versioned, server-validated game rules.
package game

import (
	"fmt"
	"math"
	"sort"
)

const RulesVersion = "pet-rules-1"

var Tools = []string{"undo", "shovel", "hint", "shuffle"}

type Cell struct {
	X int `json:"x"`
	Y int `json:"y"`
}
type Layer struct {
	Z     int    `json:"z"`
	Cells []Cell `json:"cells"`
}
type Config struct {
	RulesVersion string         `json:"rulesVersion"`
	Mode         string         `json:"mode"`
	Columns      int            `json:"columns"`
	Rows         int            `json:"rows"`
	Layers       []Layer        `json:"layers"`
	Counts       []int          `json:"counts"`
	Capacity     int            `json:"capacity"`
	FreeTools    map[string]int `json:"freeTools"`
	RewardCoins  int            `json:"rewardCoins"`
}
type Tile struct {
	ID      int     `json:"id"`
	Kind    int     `json:"kind"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Layer   int     `json:"layer"`
	Removed bool    `json:"removed"`
}
type Frame struct {
	Tiles   []Tile `json:"tiles"`
	Tray    []int  `json:"tray"`
	Reserve []int  `json:"reserve"`
	Matches int    `json:"matches"`
	Cleared int    `json:"cleared"`
	Moves   int    `json:"moves"`
	Status  string `json:"status"`
}
type State struct {
	Frame
	Mode         string         `json:"mode"`
	Capacity     int            `json:"capacity"`
	Tools        map[string]int `json:"tools"`
	History      []Frame        `json:"history,omitempty"`
	RulesVersion string         `json:"rulesVersion"`
}
type Action struct {
	Seq    int    `json:"seq"`
	Type   string `json:"type"`
	TileID int    `json:"tileId,omitempty"`
	At     int64  `json:"at"`
}
type rng struct{ state uint32 }

func (r *rng) next() float64 {
	r.state += 0x6D2B79F5
	t := r.state
	t = (t ^ (t >> 15)) * (t | 1)
	t ^= t + (t^(t>>7))*(t|61)
	return float64(t^(t>>14)) / 4294967296
}
func shuffle[T any](a []T, r *rng) {
	for i := len(a) - 1; i > 0; i-- {
		j := int(r.next() * float64(i+1))
		a[i], a[j] = a[j], a[i]
	}
}
func ValidMode(s string) bool { return s == "classic" || s == "quartet" || s == "fun" }
func Validate(c Config) error {
	if !ValidMode(c.Mode) || c.RulesVersion != RulesVersion {
		return fmt.Errorf("规则或版本不支持")
	}
	if c.Columns < 1 || c.Columns > 6 || c.Rows < 1 || c.Rows > 8 || c.Capacity != 7 || len(c.Layers) < 1 || len(c.Layers) > 8 {
		return fmt.Errorf("棋盘为 1–6 列、1–8 行、1–8 层，收纳槽为 7 格")
	}
	if len(c.Counts) != 15 || c.RewardCoins < 0 || c.RewardCoins > 10000 {
		return fmt.Errorf("需要 15 种萌宠数量，奖励为 0–10000 金币")
	}
	sum := 0
	for _, n := range c.Counts {
		if n < 0 || n > 192 {
			return fmt.Errorf("萌宠数量超出范围")
		}
		sum += n
	}
	if sum < 3 || sum > 192 {
		return fmt.Errorf("每关总方块数为 3–192")
	}
	if len(c.FreeTools) != 4 {
		return fmt.Errorf("请配置四种道具的免费次数")
	}
	for _, k := range Tools {
		n, ok := c.FreeTools[k]
		if !ok || n < 0 || n > 9 {
			return fmt.Errorf("道具免费次数为 0–9")
		}
	}
	count := 0
	zs := map[int]bool{}
	for _, l := range c.Layers {
		if l.Z < 0 || l.Z > 7 || zs[l.Z] || len(l.Cells) == 0 {
			return fmt.Errorf("层号必须唯一且为 0–7，每层至少一个格子")
		}
		zs[l.Z] = true
		for i, p := range l.Cells {
			if p.X < 0 || p.Y < 0 || p.X > 2*(c.Columns-1) || p.Y > 2*(c.Rows-1) {
				return fmt.Errorf("格子超出棋盘范围")
			}
			for _, q := range l.Cells[:i] {
				if abs(p.X-q.X) < 2 && abs(p.Y-q.Y) < 2 {
					return fmt.Errorf("同层方块不可重叠")
				}
			}
			count++
		}
	}
	if sum != count {
		return fmt.Errorf("格子共 %d 个，萌宠数量合计 %d 个，必须相等", count, sum)
	}
	if groups(c.Counts, c.Mode) == nil {
		return fmt.Errorf("这些萌宠数量无法按当前规则全部消除")
	}
	return nil
}
func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
func match(kinds []int, mode string) []int {
	n := 3
	if mode == "quartet" {
		n = 4
	}
	order := []int{}
	m := map[int][]int{}
	for i, k := range kinds {
		if len(m[k]) == 0 {
			order = append(order, k)
		}
		m[k] = append(m[k], i)
	}
	for _, k := range order {
		if len(m[k]) >= n {
			return m[k][:n]
		}
	}
	if mode == "fun" {
		out := []int{}
		for _, k := range order {
			if len(m[k]) >= 2 {
				out = append(out, m[k][:2]...)
				if len(out) == 4 {
					return out
				}
			}
		}
	}
	return nil
}
func groups(counts []int, mode string) [][]int {
	out := [][]int{}
	n := 3
	if mode == "quartet" {
		n = 4
	}
	if mode != "fun" {
		for k, c := range counts {
			if c%n != 0 {
				return nil
			}
			for i := 0; i < c; i += n {
				g := []int{}
				for j := 0; j < n; j++ {
					g = append(g, k)
				}
				out = append(out, g)
			}
		}
		return out
	}
	pairs := make([]int, len(counts))
	bad := map[[3]int]bool{}
	var find func(int, int, int) bool
	find = func(k, total, largest int) bool {
		if k == len(counts) {
			return total%2 == 0 && largest*2 <= total
		}
		key := [3]int{k, total, largest}
		if bad[key] {
			return false
		}
		for p := 0; p*2 <= counts[k]; p++ {
			if (counts[k]-p*2)%3 != 0 {
				continue
			}
			pairs[k] = p
			if find(k+1, total+p, max(largest, p)) {
				return true
			}
		}
		bad[key] = true
		return false
	}
	if !find(0, 0, 0) {
		return nil
	}
	for k, c := range counts {
		for i := 0; i < c-pairs[k]*2; i += 3 {
			out = append(out, []int{k, k, k})
		}
	}
	for {
		idx := []int{}
		for k, p := range pairs {
			if p > 0 {
				idx = append(idx, k)
			}
		}
		if len(idx) == 0 {
			break
		}
		sort.SliceStable(idx, func(i, j int) bool { return pairs[idx[i]] > pairs[idx[j]] })
		a, b := idx[0], idx[1]
		out = append(out, []int{a, a, b, b})
		pairs[a]--
		pairs[b]--
	}
	return out
}
func covered(a, b Tile) bool {
	return !b.Removed && b.Layer > a.Layer && math.Abs(a.X-b.X) < 90 && math.Abs(a.Y-b.Y) < 94
}
func (s State) Open(id int) bool {
	if id < 0 || id >= len(s.Tiles) {
		return false
	}
	for _, n := range s.Reserve {
		if n == id {
			return true
		}
	}
	a := s.Tiles[id]
	if a.Removed {
		return false
	}
	for _, b := range s.Tiles {
		if covered(a, b) {
			return false
		}
	}
	return true
}
func (s State) remaining() int {
	n := len(s.Reserve)
	for _, t := range s.Tiles {
		if !t.Removed {
			n++
		}
	}
	return n
}
func cloneFrame(f Frame) Frame {
	f.Tiles = append([]Tile{}, f.Tiles...)
	f.Tray = append([]int{}, f.Tray...)
	f.Reserve = append([]int{}, f.Reserve...)
	return f
}
func (s State) Public() State { s.History = nil; return s }
func remove(a []int, id int) []int {
	out := []int{}
	for _, v := range a {
		if v != id {
			out = append(out, v)
		}
	}
	return out
}
func (s *State) Pick(id int) error {
	if s.Status != "playing" || !s.Open(id) {
		return fmt.Errorf("这个方块当前不可选择")
	}
	s.History = append(s.History, cloneFrame(s.Frame))
	if len(s.History) > 64 {
		s.History = s.History[len(s.History)-64:]
	}
	s.Reserve = remove(s.Reserve, id)
	s.Tiles[id].Removed = true
	s.Moves++
	insert := len(s.Tray)
	for i, v := range s.Tray {
		if s.Tiles[v].Kind == s.Tiles[id].Kind {
			insert = i + 1
		}
	}
	s.Tray = append(s.Tray, 0)
	copy(s.Tray[insert+1:], s.Tray[insert:])
	s.Tray[insert] = id
	kinds := []int{}
	for _, v := range s.Tray {
		kinds = append(kinds, s.Tiles[v].Kind)
	}
	matched := match(kinds, s.Mode)
	if len(matched) > 0 {
		skip := map[int]bool{}
		for _, i := range matched {
			skip[i] = true
		}
		next := []int{}
		for i, v := range s.Tray {
			if !skip[i] {
				next = append(next, v)
			}
		}
		s.Tray = next
		s.Matches++
		s.Cleared += len(matched)
	}
	if s.remaining() == 0 && len(s.Tray) == 0 {
		s.Status = "won"
	} else if len(s.Tray) >= s.Capacity || s.remaining() == 0 {
		s.Status = "lost"
	}
	return nil
}
func (s *State) Tool(kind string, seed uint32) error {
	if s.Status != "playing" {
		return fmt.Errorf("对局已结束")
	}
	switch kind {
	case "undo":
		if len(s.History) == 0 {
			return fmt.Errorf("没有可撤回的操作")
		}
		s.Frame = cloneFrame(s.History[len(s.History)-1])
		s.History = s.History[:len(s.History)-1]
	case "shovel":
		if len(s.Tray) == 0 || len(s.Tray)+len(s.Reserve) > 7 {
			return fmt.Errorf("暂存区空间不足")
		}
		s.Reserve = append(s.Reserve, s.Tray...)
		s.Tray = []int{}
		s.History = nil
	case "hint":
		if s.remaining() == 0 {
			return fmt.Errorf("没有可提示的方块")
		}
	case "shuffle":
		return s.reshuffle(seed)
	default:
		return fmt.Errorf("未知操作")
	}
	return nil
}
func order(tiles []Tile, r *rng) []int {
	c := append([]Tile{}, tiles...)
	out := []int{}
	for {
		open := []int{}
		for _, t := range c {
			if t.Removed {
				continue
			}
			ok := true
			for _, b := range c {
				if covered(t, b) {
					ok = false
					break
				}
			}
			if ok {
				open = append(open, t.ID)
			}
		}
		if len(open) == 0 {
			break
		}
		id := open[int(r.next()*float64(len(open)))]
		c[id].Removed = true
		out = append(out, id)
	}
	return out
}
func assign(tiles []Tile, counts []int, mode string, r *rng) []int {
	seq := order(tiles, r)
	gs := groups(counts, mode)
	shuffle(gs, r)
	kinds := []int{}
	for _, g := range gs {
		kinds = append(kinds, g...)
	}
	// Interleave pairs of complete groups only when it leaves an empty tray.
	for start := 0; start < len(kinds); {
		end := min(start+6, len(kinds))
		if mode == "quartet" {
			end = min(start+8, len(kinds))
		}
		if mode != "fun" {
			chunk := append([]int{}, kinds[start:end]...)
			shuffle(chunk, r)
			copy(kinds[start:end], chunk)
		}
		start = end
	}
	for i, id := range seq {
		tiles[id].Kind = kinds[i]
	}
	return seq
}
func NewBoard(c Config, seed uint32) (State, []int, error) {
	if e := Validate(c); e != nil {
		return State{}, nil, e
	}
	s := State{Frame: Frame{Tiles: []Tile{}, Tray: []int{}, Reserve: []int{}, Status: "playing"}, Mode: c.Mode, Capacity: c.Capacity, Tools: map[string]int{}, RulesVersion: RulesVersion}
	for _, k := range Tools {
		s.Tools[k] = c.FreeTools[k]
	}
	layers := append([]Layer{}, c.Layers...)
	sort.Slice(layers, func(i, j int) bool { return layers[i].Z < layers[j].Z })
	for _, l := range layers {
		for _, p := range l.Cells {
			s.Tiles = append(s.Tiles, Tile{ID: len(s.Tiles), X: float64(p.X-(c.Columns-1)) * 48, Y: float64(p.Y-(c.Rows-1)) * 47, Layer: l.Z})
		}
	}
	r := &rng{seed}
	seq := assign(s.Tiles, c.Counts, c.Mode, r)
	return s, seq, nil
}
func (s *State) reshuffle(seed uint32) error {
	ids := map[int]bool{}
	for _, i := range s.Tray {
		ids[i] = true
	}
	for _, i := range s.Reserve {
		ids[i] = true
	}
	counts := make([]int, 15)
	for _, t := range s.Tiles {
		if !t.Removed || ids[t.ID] {
			counts[t.Kind]++
		}
	}
	if groups(counts, s.Mode) == nil {
		return fmt.Errorf("剩余数量无法成组，无法重排")
	}
	type pos struct {
		x, y float64
		l    int
	}
	positions := []pos{}
	indices := []int{}
	for i, t := range s.Tiles {
		if !t.Removed || ids[t.ID] {
			positions = append(positions, pos{t.X, t.Y, t.Layer})
			indices = append(indices, i)
		}
	}
	r := &rng{seed}
	shuffle(positions, r)
	for n, id := range indices {
		p := positions[n]
		s.Tiles[id].X = p.x
		s.Tiles[id].Y = p.y
		s.Tiles[id].Layer = p.l
		s.Tiles[id].Removed = false
	}
	s.Tray = []int{}
	s.Reserve = []int{}
	s.History = nil
	assign(s.Tiles, counts, s.Mode, r)
	return nil
}
