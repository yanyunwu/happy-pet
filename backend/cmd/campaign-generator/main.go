package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"math/rand"
	"os"
	"sort"

	"happy-pet/api/internal/game"
)

type level struct {
	Entry   string      `json:"entry"`
	Mode    string      `json:"mode"`
	Ordinal int         `json:"ordinal"`
	Title   string      `json:"title"`
	Config  game.Config `json:"config"`
}
type score struct {
	Mode            string  `json:"mode"`
	Ordinal         int     `json:"ordinal"`
	Tiles           int     `json:"tiles"`
	Seeds           int     `json:"seeds"`
	GreedyWins      int     `json:"greedyWins"`
	ClearedFraction float64 `json:"greedyClearedFraction"`
}
type result struct {
	Levels []level `json:"levels"`
	Audit  []score `json:"audit"`
}

type ranked struct {
	cell game.Cell
	rank float64
}

func layer(r *rand.Rand, z, cols, rows, ox, oy, n, style int) game.Layer {
	cells := make([]ranked, 0, cols*rows)
	for y := 0; y < rows; y++ {
		for x := 0; x < cols; x++ {
			dx := float64(x) - float64(cols-1)/2
			dy := float64(y) - float64(rows-1)/2
			var shape float64
			switch style % 8 {
			case 0:
				shape = math.Abs(dx) + math.Abs(dy)*0.6
			case 1:
				shape = math.Abs(dx)*0.5 + math.Abs(dy)
			case 2:
				shape = math.Abs(math.Abs(dx) - math.Abs(dy)*0.6)
			case 3:
				shape = math.Min(math.Abs(dx), math.Abs(dy)*0.8)
			case 4:
				shape = math.Abs(dx + dy*0.45)
			case 5:
				shape = math.Abs(dx - dy*0.45)
			case 6:
				shape = math.Abs(math.Hypot(dx, dy*0.7) - 2)
			default:
				shape = math.Abs(dx)*0.6 + math.Abs(dy)*0.6 + float64((x+y)%2)*0.5
			}
			cells = append(cells, ranked{game.Cell{X: ox + x*2, Y: oy + y*2}, shape + r.Float64()*1.7})
		}
	}
	sort.Slice(cells, func(i, j int) bool { return cells[i].rank < cells[j].rank })
	result := game.Layer{Z: z, Cells: make([]game.Cell, 0, n)}
	for _, c := range cells[:n] {
		result.Cells = append(result.Cells, c.cell)
	}
	sort.Slice(result.Cells, func(i, j int) bool {
		a, b := result.Cells[i], result.Cells[j]
		if a.Y != b.Y {
			return a.Y < b.Y
		}
		return a.X < b.X
	})
	return result
}
func generate() []level {
	levels := make([]level, 0, 192)
	for mi, mode := range []string{"classic", "quartet", "fun"} {
		for stage := 1; stage <= 64; stage++ {
			var selected level
			bestDistance := 1.0
			for candidate := 0; candidate < 8; candidate++ {
				r := rand.New(rand.NewSource(int64(807713 + mi*100003 + stage*3253 + candidate*7919)))
				// Four-quarter cycle changes geometry while keeping a narrow difficulty range.
				unit := 3
				wave := (stage - 1) % 8
				if wave > 4 {
					wave = 8 - wave
				}
				total := 54 + 3*wave
				if mode != "classic" {
					unit = 4
					total = 52 + 4*wave
				}
				base := 31 + r.Intn(4)
				mid := 16 + r.Intn(4)
				if mid > total-base-4 {
					mid = total - base - 4
				}
				top := total - base - mid
				if top > 24 {
					mid += top - 24
					top = 24
				}
				counts := make([]int, 15)
				groups := total / unit
				kinds := 8 + (stage-1)%3
				if mode == "quartet" {
					kinds = 4 + candidate%2
				}
				if mode == "fun" {
					kinds = 13 + candidate%3
				}
				order := r.Perm(15)
				for k := 0; k < kinds; k++ {
					counts[order[k]] += unit
					groups--
				}
				for groups > 0 {
					counts[order[r.Intn(kinds)]] += unit
					groups--
				}
				if mode == "fun" {
					// Two pairs per group; spread pairs across pets to keep their counts even.
					counts = make([]int, 15)
					pairs := total / 2
					for k := 0; k < kinds; k++ {
						counts[order[k]] += 2
						pairs--
					}
					for pairs > 0 {
						counts[order[r.Intn(kinds)]] += 2
						pairs--
					}
				}
				c := game.Config{RulesVersion: game.RulesVersion, Mode: mode, Columns: 6, Rows: 8, Capacity: 7, Counts: counts, FreeTools: map[string]int{"undo": 1, "shovel": 1, "hint": 3, "shuffle": 1}, RewardCoins: 30}
				if stage == 1 {
					c.RewardCoins = 10
				}
				switch mode {
				case "classic":
					c.Rules = [][]int{{3}}
				case "quartet":
					c.Rules = [][]int{{4}}
				case "fun":
					c.Rules = [][]int{{2, 2}}
				}
				c.Layers = []game.Layer{layer(r, 0, 6, 8, 0, 0, base, stage), layer(r, 1, 5, 7, 1, 1, mid, stage+2), layer(r, 2, 4, 6, 2, 2, top, stage+5)}
				choice := level{Entry: "campaign", Mode: mode, Ordinal: stage, Title: fmt.Sprintf("第 %02d 关", stage), Config: c}
				wins := 0
				for seed := 0; seed < 60; seed++ {
					board, _, err := game.NewBoard(c, uint32(seed))
					if err != nil {
						panic(err)
					}
					won, _, err := greedy(board, int64(seed)+901)
					if err != nil {
						panic(err)
					}
					if won {
						wins++
					}
				}
				distance := math.Abs(float64(wins)/60 - 0.45)
				if distance < bestDistance {
					selected = choice
					bestDistance = distance
				}
			}
			levels = append(levels, selected)
		}
	}
	return levels
}
func greedy(s game.State, seed int64) (bool, float64, error) {
	r := rand.New(rand.NewSource(seed))
	for s.Status == "playing" {
		held := make([]int, 15)
		for _, id := range s.Tray {
			held[s.Tiles[id].Kind]++
		}
		best := -1
		choices := []int{}
		for _, t := range s.Tiles {
			if !s.Open(t.ID) {
				continue
			}
			value := held[t.Kind] * 10
			// The mode presets each have a single exact match pattern.
			switch s.Mode {
			case "classic":
				if held[t.Kind] >= 2 {
					value += 100
				}
			case "quartet":
				if held[t.Kind] >= 3 {
					value += 100
				}
			case "fun":
				a := append([]int(nil), held...)
				a[t.Kind]++
				pairs := 0
				for _, n := range a {
					pairs += n / 2
				}
				if pairs >= 2 {
					value += 100
				}
			}
			if value > best {
				best = value
				choices = []int{t.ID}
			} else if value == best {
				choices = append(choices, t.ID)
			}
		}
		if len(choices) == 0 {
			return false, 0, fmt.Errorf("no open tile")
		}
		if err := s.Pick(choices[r.Intn(len(choices))]); err != nil {
			return false, 0, err
		}
	}
	return s.Status == "won", float64(s.Cleared) / float64(len(s.Tiles)), nil
}
func audit(levels []level, seeds int) ([]score, error) {
	out := make([]score, 0, len(levels))
	for _, l := range levels {
		v := score{Mode: l.Mode, Ordinal: l.Ordinal, Seeds: seeds}
		for _, n := range l.Config.Counts {
			v.Tiles += n
		}
		for seed := 0; seed < seeds; seed++ {
			state, route, err := game.NewBoard(l.Config, uint32(seed+10000))
			if err != nil {
				return nil, fmt.Errorf("%s/%d seed %d: %w", l.Mode, l.Ordinal, seed, err)
			}
			bot := state
			bot.Tiles = append([]game.Tile(nil), state.Tiles...)
			won, cleared, err := greedy(bot, int64(seed)+10901)
			if err != nil {
				return nil, err
			}
			if won {
				v.GreedyWins++
			}
			v.ClearedFraction += cleared / float64(seeds)
			for _, id := range route {
				if err = state.Pick(id); err != nil {
					return nil, fmt.Errorf("%s/%d seed %d: %w", l.Mode, l.Ordinal, seed, err)
				}
			}
			if state.Status != "won" || state.Cleared != len(state.Tiles) {
				return nil, fmt.Errorf("%s/%d seed %d: witness failed", l.Mode, l.Ordinal, seed)
			}
		}
		out = append(out, v)
	}
	return out, nil
}
func main() {
	seeds := flag.Int("seeds", 20, "seeds for witness and bot for each level")
	output := flag.String("output", "campaign-catalog.json", "output JSON path")
	flag.Parse()
	if *seeds < 1 {
		fmt.Fprintln(os.Stderr, "seeds must be positive")
		os.Exit(1)
	}
	levels := generate()
	stats, err := audit(levels, *seeds)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	data, err := json.MarshalIndent(result{levels, stats}, "", "  ")
	if err == nil {
		err = os.WriteFile(*output, append(data, '\n'), 0644)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Wrote %d levels; %d witness replays and greedy simulations.\n", len(levels), len(levels)**seeds)
}
