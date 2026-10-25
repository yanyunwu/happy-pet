package game

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/users"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type Service struct {
	DB *sql.DB
	Q  *dbgen.Queries
}

func New(db *sql.DB) *Service { return &Service{db, dbgen.New(db)} }
func invalid(e error) error   { return users.Invalid(e.Error()) }
func missing(e error) error {
	if errors.Is(e, sql.ErrNoRows) {
		return &users.Error{Status: 404, Code: "NOT_FOUND", Message: "记录不存在"}
	}
	return e
}
func conflict(message string) error {
	return &users.Error{Status: 409, Code: "CONFLICT", Message: message}
}
func raw(v any) json.RawMessage {
	b, e := json.Marshal(v)
	if e != nil {
		panic(e)
	}
	return b
}

var keyPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{16,80}$`)

type Assets struct {
	Coins       int64            `json:"coins"`
	Bag         map[string]int32 `json:"bag"`
	SignInCount int32            `json:"signInCount"`
	SignedOn    string           `json:"signedOn"`
}

func assets(a dbgen.PlayerAsset) Assets {
	return Assets{a.Coins, map[string]int32{"undo": a.Undo, "shovel": a.Shovel, "hint": a.Hint, "shuffle": a.Shuffle}, a.SignInCount, a.SignedOn}
}
func saveAssets(ctx context.Context, q *dbgen.Queries, a dbgen.PlayerAsset) error {
	return q.SetAssets(ctx, dbgen.SetAssetsParams{UserID: a.UserID, Coins: a.Coins, Undo: a.Undo, Shovel: a.Shovel, Hint: a.Hint, Shuffle: a.Shuffle, SignInCount: a.SignInCount, SignedOn: a.SignedOn})
}
func lockAssets(ctx context.Context, q *dbgen.Queries, id string) (dbgen.PlayerAsset, error) {
	if e := q.EnsureAssets(ctx, id); e != nil {
		return dbgen.PlayerAsset{}, e
	}
	return q.LockAssets(ctx, id)
}
func (s *Service) Assets(ctx context.Context, id string) (Assets, error) {
	if e := s.Q.EnsureAssets(ctx, id); e != nil {
		return Assets{}, e
	}
	a, e := s.Q.GetAssets(ctx, id)
	return assets(a), e
}
func change(ctx context.Context, q *dbgen.Queries, a *dbgen.PlayerAsset, kind string, delta int64, key, reason, actor string) error {
	var old int64
	switch kind {
	case "coins":
		old = a.Coins
	case "undo":
		old = int64(a.Undo)
	case "shovel":
		old = int64(a.Shovel)
	case "hint":
		old = int64(a.Hint)
	case "shuffle":
		old = int64(a.Shuffle)
	default:
		return users.Invalid("未知资产")
	}
	next := old + delta
	if next < 0 || next > 1000000000 {
		return conflict("资产余额不足或超过上限")
	}
	switch kind {
	case "coins":
		a.Coins = next
	case "undo":
		a.Undo = int32(next)
	case "shovel":
		a.Shovel = int32(next)
	case "hint":
		a.Hint = int32(next)
	case "shuffle":
		a.Shuffle = int32(next)
	}
	return q.AddLedger(ctx, dbgen.AddLedgerParams{UserID: a.UserID, RequestKey: key, Asset: kind, Delta: delta, Balance: next, Reason: reason, ActorID: actor})
}

type Adjustment struct {
	RequestID string `json:"requestId"`
	Asset     string `json:"asset"`
	Delta     int64  `json:"delta"`
	Reason    string `json:"reason"`
}

func (s *Service) Adjust(ctx context.Context, id, actor string, in Adjustment) (Assets, error) {
	if !keyPattern.MatchString(in.RequestID) || in.Delta == 0 || in.Delta > 1000000 || in.Delta < -1000000 || utf8.RuneCountInString(strings.TrimSpace(in.Reason)) < 2 || utf8.RuneCountInString(in.Reason) > 200 {
		return Assets{}, users.Invalid("请填写调整数量、原因和有效请求标识")
	}
	u, e := s.Q.GetUser(ctx, id)
	if e != nil {
		return Assets{}, missing(e)
	}
	if u.Role != "user" {
		return Assets{}, users.Invalid("管理账号没有游戏资产")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Assets{}, e
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	a, e := lockAssets(ctx, q, id)
	if e != nil {
		return Assets{}, e
	}
	entries, e := q.LedgerByKey(ctx, dbgen.LedgerByKeyParams{UserID: id, RequestKey: "admin:" + in.RequestID})
	if e != nil {
		return Assets{}, e
	}
	if len(entries) > 0 {
		previous := entries[0]
		if previous.Asset != in.Asset || previous.Delta != in.Delta || previous.Reason != in.Reason || previous.ActorID != actor {
			return Assets{}, conflict("同一请求标识不能用于不同资产调整")
		}
		return assets(a), nil
	}
	if e = change(ctx, q, &a, in.Asset, in.Delta, "admin:"+in.RequestID, in.Reason, actor); e != nil {
		return Assets{}, e
	}
	if e = saveAssets(ctx, q, a); e != nil {
		return Assets{}, e
	}
	return assets(a), tx.Commit()
}
func (s *Service) SignIn(ctx context.Context, id string) (Assets, error) {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Assets{}, e
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	a, e := lockAssets(ctx, q, id)
	if e != nil {
		return Assets{}, e
	}
	today := time.Now().In(time.FixedZone("Asia/Shanghai", 8*3600)).Format("2006-01-02")
	if a.SignedOn >= today {
		return assets(a), nil
	}
	day := int(a.SignInCount % 7)
	coin := []int64{20, 30, 40, 50, 60, 80, 120}[day]
	tool := []string{"hint", "undo", "shuffle", "shovel", "undo", "shuffle", "hint"}[day]
	qty := []int64{1, 1, 1, 1, 2, 2, 3}[day]
	for k, d := range map[string]int64{"coins": coin, tool: qty} {
		if e = change(ctx, q, &a, k, d, "signin:"+today, "7 日签到奖励", "system"); e != nil {
			return Assets{}, e
		}
	}
	a.SignedOn = today
	a.SignInCount++
	if e = saveAssets(ctx, q, a); e != nil {
		return Assets{}, e
	}
	return assets(a), tx.Commit()
}
func (s *Service) Ledger(ctx context.Context, id string) ([]map[string]any, error) {
	rows, e := s.Q.ListLedger(ctx, id)
	out := []map[string]any{}
	for _, r := range rows {
		out = append(out, map[string]any{"id": r.ID, "asset": r.Asset, "delta": r.Delta, "balance": r.Balance, "reason": r.Reason, "actorId": r.ActorID, "createdAt": r.CreatedAt})
	}
	return out, e
}

type LevelView struct {
	ID           string    `json:"id"`
	Entry        string    `json:"entry"`
	Mode         string    `json:"mode"`
	Ordinal      int32     `json:"ordinal"`
	Title        string    `json:"title"`
	Config       Config    `json:"config"`
	DraftVersion int32     `json:"draftVersion"`
	RevisionID   string    `json:"revisionId"`
	Enabled      bool      `json:"enabled"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func levelView(l dbgen.Level) LevelView {
	v := LevelView{ID: l.ID, Entry: l.Entry, Mode: l.Mode, Ordinal: l.Ordinal, Title: l.Title, DraftVersion: l.DraftVersion, RevisionID: l.PublishedRevision.String, Enabled: l.Enabled, UpdatedAt: l.UpdatedAt}
	_ = json.Unmarshal(l.Draft, &v.Config)
	return v
}
func (s *Service) Levels(ctx context.Context, public bool) ([]LevelView, error) {
	ls, e := s.Q.ListLevels(ctx)
	out := []LevelView{}
	for _, l := range ls {
		if public {
			if !l.Enabled || !l.PublishedRevision.Valid {
				continue
			}
			r, err := s.Q.GetRevision(ctx, l.PublishedRevision.String)
			if err != nil {
				return nil, err
			}
			l.Draft = r.Config
			l.Title = r.Title
		}
		out = append(out, levelView(l))
	}
	return out, e
}

type DraftInput struct {
	Entry        string `json:"entry"`
	Mode         string `json:"mode"`
	Ordinal      int32  `json:"ordinal"`
	Title        string `json:"title"`
	Config       Config `json:"config"`
	DraftVersion int32  `json:"draftVersion"`
}

func (s *Service) SaveLevel(ctx context.Context, id string, in DraftInput) (LevelView, error) {
	if in.Entry == "" {
		in.Entry = "campaign"
	}
	if !ValidEntry(in.Entry) || !ValidMode(in.Mode) || in.Ordinal < 1 || len(in.Title) > 180 || strings.TrimSpace(in.Title) == "" || in.Config.Mode != in.Mode {
		return LevelView{}, users.Invalid("请检查关卡名称、模式和序号")
	}
	rules, err := AuthoringRules(in.Config)
	if err != nil {
		return LevelView{}, invalid(err)
	}
	in.Config.Rules = rules
	// Drafts may have unmatched counts while the designer paints. Structure size is bounded.
	if len(raw(in.Config)) > 60000 || len(in.Config.Layers) > 8 || len(in.Config.Counts) > 15 {
		return LevelView{}, users.Invalid("关卡配置过大")
	}
	var l dbgen.Level
	var e error
	if id == "" {
		l, e = s.Q.CreateLevel(ctx, dbgen.CreateLevelParams{ID: users.NewID(), Mode: in.Mode, Ordinal: in.Ordinal, Title: in.Title, Draft: raw(in.Config), Entry: in.Entry})
	} else {
		old, err := s.Q.GetLevel(ctx, id)
		if err != nil {
			return LevelView{}, missing(err)
		}
		if old.Entry != in.Entry || old.Mode != in.Mode || old.Ordinal != in.Ordinal {
			return LevelView{}, users.Invalid("已建关卡的入口、规则和序号不能修改，请新建关卡")
		}
		l, e = s.Q.SaveDraft(ctx, dbgen.SaveDraftParams{ID: id, Title: in.Title, Draft: raw(in.Config), DraftVersion: in.DraftVersion})
		if errors.Is(e, sql.ErrNoRows) {
			return LevelView{}, conflict("草稿已被其他人修改，请刷新后重试")
		}
	}
	if e != nil {
		return LevelView{}, conflict("保存失败，请检查同一入口和规则下是否已有该关卡序号")
	}
	return levelView(l), nil
}
func (s *Service) Publish(ctx context.Context, id, actor string, version int32) (LevelView, error) {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return LevelView{}, e
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	l, e := q.LockLevel(ctx, id)
	if e != nil {
		return LevelView{}, missing(e)
	}
	if l.DraftVersion != version {
		return LevelView{}, conflict("草稿版本已变化，请刷新")
	}
	c := levelView(l).Config
	rules, err := AuthoringRules(c)
	if err != nil {
		return LevelView{}, invalid(err)
	}
	c.Rules = rules
	if e = Validate(c); e != nil {
		return LevelView{}, invalid(e)
	}
	// A witness must clear the actual rules, not just divide the initial counts.
	for seed := uint32(1); seed <= 3; seed++ {
		board, seq, err := NewBoard(c, seed)
		if err != nil {
			return LevelView{}, invalid(err)
		}
		for _, i := range seq {
			if err = board.Pick(i); err != nil {
				return LevelView{}, invalid(err)
			}
		}
		if board.Status != "won" {
			return LevelView{}, users.Invalid("生成器未通过通关路径校验")
		}
	}
	revisions, e := q.ListRevisions(ctx, id)
	if e != nil {
		return LevelView{}, e
	}
	revision := users.NewID()
	_, e = q.AddRevision(ctx, dbgen.AddRevisionParams{ID: revision, LevelID: id, Version: int32(len(revisions) + 1), Config: raw(c), CreatedBy: actor, Title: l.Title})
	if e != nil {
		return LevelView{}, e
	}
	if e = q.PublishLevel(ctx, dbgen.PublishLevelParams{ID: id, PublishedRevision: sql.NullString{String: revision, Valid: true}}); e != nil {
		return LevelView{}, e
	}
	l.PublishedRevision = sql.NullString{String: revision, Valid: true}
	l.Enabled = true
	return levelView(l), tx.Commit()
}
func (s *Service) Enabled(ctx context.Context, id string, enabled bool) error {
	l, e := s.Q.GetLevel(ctx, id)
	if e != nil {
		return missing(e)
	}
	if enabled && !l.PublishedRevision.Valid {
		return users.Invalid("请先发布有效版本")
	}
	return s.Q.EnableLevel(ctx, dbgen.EnableLevelParams{ID: id, Enabled: enabled})
}
func Seed(ctx context.Context, db *sql.DB) error {
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(718296435)"); e != nil {
		return e
	}
	q := dbgen.New(tx)
	for _, entry := range []string{"standard", "campaign"} {
		key := "level_catalog:" + entry
		initialized, err := q.HasSystemInitialization(ctx, key)
		if err != nil {
			return err
		}
		if initialized {
			continue
		}
		for _, mode := range []string{"classic", "quartet", "fun"} {
			for stage := 1; stage <= 2; stage++ {
				c := DefaultConfig(mode, stage)
				id := fmt.Sprintf("%s-%d", mode, stage)
				if entry == "standard" {
					id = "standard-" + id
				}
				title := []string{"新手乐园", "高手挑战"}[stage-1]
				_, e = q.CreateLevel(ctx, dbgen.CreateLevelParams{ID: id, Mode: mode, Ordinal: int32(stage), Title: title, Draft: raw(c), Entry: entry})
				if e != nil {
					return e
				}
				rid := users.NewID()
				if _, e = q.AddRevision(ctx, dbgen.AddRevisionParams{ID: rid, LevelID: id, Version: 1, Config: raw(c), CreatedBy: "system", Title: title}); e != nil {
					return e
				}
				if e = q.PublishLevel(ctx, dbgen.PublishLevelParams{ID: id, PublishedRevision: sql.NullString{String: rid, Valid: true}}); e != nil {
					return e
				}
			}
		}
		if e = q.RecordSystemInitialization(ctx, key); e != nil {
			return e
		}
	}
	if e = migrateFunRules(ctx, tx); e != nil {
		return e
	}
	return tx.Commit()
}
func DefaultConfig(mode string, stage int) Config {
	c := Config{RulesVersion: RulesVersion, Rules: defaultRules(mode), Mode: mode, Columns: 6, Rows: 8, Counts: make([]int, 15), Capacity: 7, FreeTools: map[string]int{"undo": 1, "shovel": 1, "hint": 3, "shuffle": 1}, RewardCoins: 30, Layers: []Layer{}}
	add := func(z, cols, rows, x, y, dy int) {
		l := Layer{Z: z, Cells: []Cell{}}
		for row := 0; row < rows; row++ {
			for col := 0; col < cols; col++ {
				l.Cells = append(l.Cells, Cell{x + col*2, y + row*dy})
			}
		}
		c.Layers = append(c.Layers, l)
	}
	if stage == 1 {
		c.RewardCoins = 10
		if mode == "fun" {
			c.Columns = 4
			c.Rows = 2
			c.Counts[0] = 4
			c.Counts[1] = 2
			c.Counts[2] = 2
			add(0, 4, 2, 0, 0, 2)
		} else if mode == "quartet" {
			c.Columns = 4
			c.Rows = 2
			c.Counts[0] = 8
			c.Counts[1] = 8
			add(0, 4, 2, 0, 0, 2)
			add(1, 4, 2, 0, 0, 2)
		} else {
			c.Columns = 3
			c.Rows = 3
			c.Counts[0] = 6
			c.Counts[1] = 6
			c.Counts[2] = 6
			add(0, 3, 3, 0, 0, 2)
			add(1, 3, 3, 0, 0, 2)
		}
	} else {
		add(0, 6, 8, 0, 0, 2)
		add(1, 5, 7, 1, 1, 2)
		add(2, 4, 4, 2, 2, 3)
		add(3, 3, 2, 3, 4, 6)
		add(4, 3, 1, 3, 11, 2)
		for k := range c.Counts {
			if mode == "quartet" {
				c.Counts[k] = 4
				if k < 12 {
					c.Counts[k] = 8
				}
			} else if mode == "fun" {
				c.Counts[k] = 6
				if k < 9 {
					c.Counts[k] = 8
				}
			} else {
				c.Counts[k] = 6
				if k < 6 {
					c.Counts[k] = 9
				}
			}
		}
	}
	return c
}
