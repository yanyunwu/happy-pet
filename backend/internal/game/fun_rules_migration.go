package game

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/users"
)

const funRulesInitialization = "level_rules:fun_pairs:v1"

// Called only within Seed's transaction and advisory lock. A revision is never
// edited in place: sessions and replays continue using their original snapshot.
func migrateFunRules(ctx context.Context, tx *sql.Tx) error {
	q := dbgen.New(tx)
	done, err := q.HasSystemInitialization(ctx, funRulesInitialization)
	if err != nil || done {
		return err
	}
	levels, err := q.ListLevels(ctx)
	if err != nil {
		return err
	}
	for _, listed := range levels {
		if listed.Mode != "fun" {
			continue
		}
		level, err := q.LockLevel(ctx, listed.ID)
		if err != nil {
			return err
		}
		draft, changed, err := convertFunConfig(level.Draft, false)
		if err != nil {
			return fmt.Errorf("转换趣味关卡 %s 草稿: %w", level.ID, err)
		}
		if changed {
			if _, err = q.SaveDraft(ctx, dbgen.SaveDraftParams{ID: level.ID, Title: level.Title, Draft: draft, DraftVersion: level.DraftVersion}); err != nil {
				return err
			}
		}
		if !level.PublishedRevision.Valid {
			continue
		}
		previous, err := q.GetRevision(ctx, level.PublishedRevision.String)
		if err != nil {
			return err
		}
		published, changed, err := convertFunConfig(previous.Config, true)
		if err != nil {
			return fmt.Errorf("转换趣味关卡 %s 已发布版本: %w", level.ID, err)
		}
		if !changed {
			continue
		}
		revisions, err := q.ListRevisions(ctx, level.ID)
		if err != nil {
			return err
		}
		version := int32(1)
		for _, revision := range revisions {
			version = max(version, revision.Version+1)
		}
		id := users.NewID()
		if _, err = q.AddRevision(ctx, dbgen.AddRevisionParams{ID: id, LevelID: level.ID, Version: version, Config: published, CreatedBy: "system", Title: previous.Title}); err != nil {
			return err
		}
		// PublishLevel also enables the level, which a data conversion must not do.
		if _, err = tx.ExecContext(ctx, "UPDATE levels SET published_revision=$2,updated_at=now() WHERE id=$1", level.ID, id); err != nil {
			return err
		}
	}
	return q.RecordSystemInitialization(ctx, funRulesInitialization)
}

// Keep unrecognized fields and incomplete draft content. Only valid drafts get
// geometry/count normalization; every published conversion must be playable.
func convertFunConfig(data json.RawMessage, published bool) (json.RawMessage, bool, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return nil, false, fmt.Errorf("关卡配置必须是对象")
	}
	before := raw(fields)
	var c Config
	decodeErr := json.Unmarshal(data, &c)
	if published || (decodeErr == nil && Validate(c) == nil) {
		if decodeErr != nil {
			return nil, false, decodeErr
		}
		converted, err := normalizeFunPairs(c)
		if err != nil && published {
			return nil, false, err
		}
		if err == nil {
			if published {
				for seed := uint32(1); seed <= 3; seed++ {
					board, route, err := NewBoard(converted, seed)
					if err != nil {
						return nil, false, err
					}
					if err := verifyWitness(board, route); err != nil {
						return nil, false, err
					}
				}
			}
			fields["layers"], fields["counts"] = raw(converted.Layers), raw(converted.Counts)
		}
	}
	fields["rulesVersion"], fields["rules"] = raw(RulesVersion), raw([][]int{{2, 2}})
	after := raw(fields)
	return after, !bytes.Equal(before, after), nil
}

func normalizeFunPairs(c Config) (Config, error) {
	if c.Mode != "fun" {
		return Config{}, fmt.Errorf("趣味关卡的配置模式不一致")
	}
	if err := ValidateLayout(Layout{Columns: c.Columns, Rows: c.Rows, Layers: c.Layers}); err != nil {
		return Config{}, err
	}
	if len(c.Counts) != 15 {
		return Config{}, fmt.Errorf("需要 15 种萌宠数量")
	}
	total, cells := 0, 0
	for _, count := range c.Counts {
		if count < 0 || count > 192 {
			return Config{}, fmt.Errorf("萌宠数量超出范围")
		}
		total += count
	}
	originalLayers := c.Layers
	layers := make([]Layer, len(originalLayers))
	for i, layer := range originalLayers {
		cells += len(layer.Cells)
		layers[i] = Layer{Z: layer.Z, Cells: append([]Cell{}, layer.Cells...)}
	}
	if total != cells {
		return Config{}, fmt.Errorf("格子数量与萌宠总数不一致")
	}
	target := (total + 3) / 4 * 4
	c.Layers = layers
	if target > total && !fillPairCells(&c, target-total) {
		// Discard any partial additions before trimming the original geometry.
		c.Layers = make([]Layer, len(originalLayers))
		for i, layer := range originalLayers {
			c.Layers[i] = Layer{Z: layer.Z, Cells: append([]Cell{}, layer.Cells...)}
		}
		target = total / 4 * 4
		if target < 4 {
			return Config{}, fmt.Errorf("布局无法容纳两对萌宠")
		}
		for remove := total - target; remove > 0; remove-- {
			last := len(c.Layers) - 1
			c.Layers[last].Cells = c.Layers[last].Cells[:len(c.Layers[last].Cells)-1]
			if len(c.Layers[last].Cells) == 0 {
				c.Layers = c.Layers[:last]
			}
		}
	}
	c.Counts = nearestPairCounts(c.Counts, target)
	c.RulesVersion, c.Rules = RulesVersion, [][]int{{2, 2}}
	return c, Validate(c)
}

// Try existing layers first, then an unused legal layer. Existing cells never
// move. Integer coordinates include staggered layouts as well as regular grids.
func fillPairCells(c *Config, needed int) bool {
	fill := func(layer *Layer) {
		for y := 0; y <= 2*(c.Rows-1) && needed > 0; y++ {
			for x := 0; x <= 2*(c.Columns-1) && needed > 0; x++ {
				legal := true
				for _, cell := range layer.Cells {
					if abs(x-cell.X) < 2 && abs(y-cell.Y) < 2 {
						legal = false
						break
					}
				}
				if legal {
					layer.Cells = append(layer.Cells, Cell{X: x, Y: y})
					needed--
				}
			}
		}
	}
	used := map[int]bool{}
	for i := range c.Layers {
		used[c.Layers[i].Z] = true
		fill(&c.Layers[i])
	}
	for z := 0; z < 8 && needed > 0; z++ {
		if !used[z] {
			layer := Layer{Z: z, Cells: []Cell{}}
			fill(&layer)
			c.Layers = append(c.Layers, layer)
		}
	}
	return needed == 0
}

// Each +/-2 step has nondecreasing absolute-distance cost, so the cheapest
// available step minimizes total count changes subject to the half-total cap.
// Equal-cost choices retain existing species before introducing/removing one.
func nearestPairCounts(previous []int, total int) []int {
	counts := make([]int, len(previous))
	sum := 0
	for kind, count := range previous {
		counts[kind] = min(count/2*2, total/2)
		sum += counts[kind]
	}
	for sum != total {
		step := 2
		if sum > total {
			step = -2
		}
		chosen, bestCost, bestSpecies := -1, 1000, 1000
		for kind, count := range counts {
			next := count + step
			if next < 0 || next > total/2 {
				continue
			}
			cost := abs(next-previous[kind]) - abs(count-previous[kind])
			species := 0
			if (next == 0) != (previous[kind] == 0) {
				species++
			}
			if (count == 0) != (previous[kind] == 0) {
				species--
			}
			if cost < bestCost || (cost == bestCost && species < bestSpecies) {
				chosen, bestCost, bestSpecies = kind, cost, species
			}
		}
		counts[chosen] += step
		sum += step
	}
	return counts
}
