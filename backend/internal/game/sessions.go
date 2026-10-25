package game

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/users"
)

type StartInput struct {
	Entry             string `json:"entry"`
	Mode              string `json:"mode"`
	PreviousSessionID string `json:"previousSessionId"`
	RequestID         string `json:"requestId"`
}
type SessionView struct {
	Entry       string `json:"entry"`
	ID          string `json:"id"`
	LevelID     string `json:"levelId"`
	RevisionID  string `json:"revisionId"`
	Ordinal     int32  `json:"ordinal"`
	Title       string `json:"title"`
	Seed        int64  `json:"seed"`
	State       State  `json:"state"`
	LastSeq     int32  `json:"lastSeq"`
	Settled     bool   `json:"settled"`
	RewardCoins int32  `json:"rewardCoins"`
}

func sessionView(row dbgen.GameSession) SessionView {
	var state State
	_ = json.Unmarshal(row.State, &state)
	return SessionView{row.Entry, row.ID, row.LevelID, row.RevisionID, row.Ordinal, row.Title, row.Seed, state.Public(), row.LastSeq, row.Settled, row.RewardCoins}
}
func (s *Service) Recovery(ctx context.Context, user, id string) (SessionView, error) {
	row, e := s.Q.GetSession(ctx, id)
	if e != nil || row.UserID != user {
		return SessionView{}, missing(sql.ErrNoRows)
	}
	view := sessionView(row)
	// Only the owning player receives undo history when recovering a rejected action.
	if e = json.Unmarshal(row.State, &view.State); e != nil {
		return SessionView{}, e
	}
	return view, nil
}
func (s *Service) Start(ctx context.Context, user string, in StartInput) (SessionView, error) {
	if in.Entry == "" {
		in.Entry = "campaign"
	}
	if in.Entry != "standard" && in.Entry != "campaign" {
		return SessionView{}, users.Invalid("无效的玩法入口")
	}
	if !ValidMode(in.Mode) || !keyPattern.MatchString(in.RequestID) {
		return SessionView{}, users.Invalid("无效模式或请求标识")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return SessionView{}, e
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	// Serializes retries for this player without touching another player's records.
	if _, e = lockAssets(ctx, q, user); e != nil {
		return SessionView{}, e
	}
	old, e := q.GetSessionByRequest(ctx, dbgen.GetSessionByRequestParams{UserID: user, RequestKey: in.RequestID})
	if e == nil {
		if old.Mode != in.Mode || old.Entry != in.Entry {
			return SessionView{}, conflict("请求标识已用于其他模式")
		}
		return sessionView(old), nil
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return SessionView{}, e
	}
	after := int32(0)
	id := users.NewID()
	campaign := id
	if in.PreviousSessionID != "" {
		prev, err := q.GetSession(ctx, in.PreviousSessionID)
		if err != nil || prev.UserID != user {
			return SessionView{}, users.Invalid("前序对局不存在")
		}
		if prev.Mode != in.Mode || prev.Entry != in.Entry || prev.Status != "won" || !prev.Settled {
			return SessionView{}, conflict("上一关尚未成功结算")
		}
		after = prev.Ordinal
		campaign = prev.CampaignID
	}
	levels, e := q.ListLevels(ctx)
	if e != nil {
		return SessionView{}, e
	}
	var target *dbgen.Level
	for _, l := range levels {
		if l.Entry == in.Entry && l.Mode == in.Mode && l.Enabled && l.PublishedRevision.Valid && l.Ordinal > after {
			copy := l
			target = &copy
			break
		}
	}
	if target == nil {
		return SessionView{}, &users.Error{Status: 404, Code: "CAMPAIGN_COMPLETE", Message: "当前模式的关卡已全部完成"}
	}
	revision, e := q.GetRevision(ctx, target.PublishedRevision.String)
	if e != nil {
		return SessionView{}, e
	}
	var config Config
	if e = json.Unmarshal(revision.Config, &config); e != nil {
		return SessionView{}, e
	}
	var seedBytes [4]byte
	if _, e = rand.Read(seedBytes[:]); e != nil {
		return SessionView{}, e
	}
	seed := binary.LittleEndian.Uint32(seedBytes[:])
	state, _, e := NewBoard(config, seed)
	if e != nil {
		return SessionView{}, e
	}
	row, e := q.CreateSession(ctx, dbgen.CreateSessionParams{ID: id, UserID: user, RequestKey: in.RequestID, CampaignID: campaign, LevelID: target.ID, RevisionID: revision.ID, Mode: in.Mode, Ordinal: target.Ordinal, Seed: int64(seed), Initial: raw(state.Public()), State: raw(state), Title: revision.Title, Entry: in.Entry})
	if e != nil {
		return SessionView{}, e
	}
	return sessionView(row), tx.Commit()
}

type EventResult struct {
	State   State  `json:"state"`
	LastSeq int32  `json:"lastSeq"`
	Assets  Assets `json:"assets"`
}

func (s *Service) Events(ctx context.Context, user, id string, actions []Action) (EventResult, error) {
	if len(actions) < 1 || len(actions) > 64 {
		return EventResult{}, users.Invalid("每次上传 1–64 步操作")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return EventResult{}, e
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	a, e := lockAssets(ctx, q, user)
	if e != nil {
		return EventResult{}, e
	}
	session, e := q.LockSession(ctx, id)
	if e != nil || session.UserID != user {
		return EventResult{}, missing(sql.ErrNoRows)
	}
	var state State
	if e = json.Unmarshal(session.State, &state); e != nil {
		return EventResult{}, e
	}
	if state.RulesVersion != RulesVersion {
		return EventResult{}, conflict("该对局需要对应的规则版本")
	}
	lastAt := int64(0)
	if session.LastSeq > 0 {
		event, err := q.GetEvent(ctx, dbgen.GetEventParams{SessionID: id, Seq: session.LastSeq})
		if err != nil {
			return EventResult{}, err
		}
		var act Action
		_ = json.Unmarshal(event.Action, &act)
		lastAt = act.At
	}
	for _, act := range actions {
		if act.Seq < 1 || act.Seq > 10000 || act.At < 0 || act.At > 7*24*3600000 {
			return EventResult{}, users.Invalid("操作序号或时间不正确")
		}
		if act.Seq <= int(session.LastSeq) {
			old, err := q.GetEvent(ctx, dbgen.GetEventParams{SessionID: id, Seq: int32(act.Seq)})
			if err != nil {
				return EventResult{}, err
			}
			var previous Action
			_ = json.Unmarshal(old.Action, &previous)
			if previous != act {
				return EventResult{}, conflict("同一操作序号不能提交不同内容")
			}
			continue
		}
		if session.Settled || act.Seq != int(session.LastSeq)+1 || act.At < lastAt {
			return EventResult{}, conflict("对局已结算或操作顺序不连续")
		}
		if act.Type == "pick" {
			e = state.Pick(act.TileID)
		} else {
			_, ok := state.Tools[act.Type]
			if !ok {
				return EventResult{}, users.Invalid("未知道具")
			}
			e = state.Tool(act.Type, uint32(session.Seed)^uint32(act.Seq)*2654435761)
			if e == nil {
				if state.Tools[act.Type] > 0 {
					state.Tools[act.Type]--
				} else {
					e = change(ctx, q, &a, act.Type, -1, fmt.Sprintf("session:%s:%d", id, act.Seq), "对局使用道具", user)
				}
			}
		}
		if e != nil {
			return EventResult{}, invalid(e)
		}
		if e = q.AddEvent(ctx, dbgen.AddEventParams{SessionID: id, Seq: int32(act.Seq), Action: raw(act), State: raw(state.Public())}); e != nil {
			return EventResult{}, e
		}
		session.LastSeq = int32(act.Seq)
		lastAt = act.At
	}
	if e = q.UpdateSession(ctx, dbgen.UpdateSessionParams{ID: id, State: raw(state), LastSeq: session.LastSeq, Status: state.Status}); e != nil {
		return EventResult{}, e
	}
	if e = saveAssets(ctx, q, a); e != nil {
		return EventResult{}, e
	}
	if e = tx.Commit(); e != nil {
		return EventResult{}, e
	}
	result := EventResult{state.Public(), session.LastSeq, assets(a)}
	// A terminal action also settles the round: closing WeChat during the last
	// animation must not leave a verified win without its reward.
	if state.Status == "won" || state.Status == "lost" {
		settled, err := s.Finish(ctx, user, id, state.Status)
		if err != nil {
			return EventResult{}, err
		}
		result.Assets = settled.Assets
	}
	return result, nil
}

type FinishResult struct {
	Status      string `json:"status"`
	RewardCoins int32  `json:"rewardCoins"`
	HasNext     bool   `json:"hasNext"`
	Assets      Assets `json:"assets"`
}

func (s *Service) Finish(ctx context.Context, user, id, outcome string) (FinishResult, error) {
	if outcome != "won" && outcome != "lost" && outcome != "abandoned" {
		return FinishResult{}, users.Invalid("无效结果")
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return FinishResult{}, e
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	a, e := lockAssets(ctx, q, user)
	if e != nil {
		return FinishResult{}, e
	}
	row, e := q.LockSession(ctx, id)
	if e != nil || row.UserID != user {
		return FinishResult{}, missing(sql.ErrNoRows)
	}
	if outcome != row.Status && !(outcome == "abandoned" && row.Status == "playing") {
		return FinishResult{}, conflict("上传结果与服务端操作回放不一致")
	}
	if !row.Settled {
		if outcome == "won" {
			n, err := q.RecordClear(ctx, dbgen.RecordClearParams{UserID: user, LevelID: row.LevelID, SessionID: id})
			if err != nil {
				return FinishResult{}, err
			}
			if n > 0 {
				rev, err := q.GetRevision(ctx, row.RevisionID)
				if err != nil {
					return FinishResult{}, err
				}
				var c Config
				_ = json.Unmarshal(rev.Config, &c)
				row.RewardCoins = int32(c.RewardCoins)
				if c.RewardCoins > 0 {
					if e = change(ctx, q, &a, "coins", int64(c.RewardCoins), "clear:"+row.LevelID, "首次通关奖励", "system"); e != nil {
						return FinishResult{}, e
					}
				}
			}
		}
		if e = q.SettleSession(ctx, dbgen.SettleSessionParams{ID: id, RewardCoins: row.RewardCoins, Status: outcome}); e != nil {
			return FinishResult{}, e
		}
		if e = saveAssets(ctx, q, a); e != nil {
			return FinishResult{}, e
		}
	}
	next := false
	if outcome == "won" {
		levels, err := q.ListLevels(ctx)
		if err != nil {
			return FinishResult{}, err
		}
		for _, l := range levels {
			if l.Entry == row.Entry && l.Mode == row.Mode && l.Ordinal > row.Ordinal && l.Enabled && l.PublishedRevision.Valid {
				next = true
			}
		}
	}
	return FinishResult{outcome, row.RewardCoins, next, assets(a)}, tx.Commit()
}
func (s *Service) Replay(ctx context.Context, id string) (map[string]any, error) {
	row, e := s.Q.GetSession(ctx, id)
	if e != nil {
		return nil, missing(e)
	}
	rev, e := s.Q.GetRevision(ctx, row.RevisionID)
	if e != nil {
		return nil, e
	}
	events, e := s.Q.ListEvents(ctx, id)
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	for _, ev := range events {
		out = append(out, map[string]any{"seq": ev.Seq, "action": ev.Action, "state": ev.State, "receivedAt": ev.ReceivedAt})
	}
	return map[string]any{"session": sessionView(row), "userId": row.UserID, "campaignId": row.CampaignID, "initial": row.Initial, "config": rev.Config, "events": out, "status": row.Status, "startedAt": row.StartedAt}, nil
}
func (s *Service) Records(ctx context.Context, user, mode, status, entry string, page, size int) (map[string]any, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	if page > 100000 {
		return nil, users.Invalid("页码过大")
	}
	if entry != "" && entry != "standard" && entry != "campaign" {
		return nil, users.Invalid("无效的玩法入口")
	}
	count, e := s.Q.CountSessions(ctx, dbgen.CountSessionsParams{UserID: user, Mode: mode, Status: status, Entry: entry})
	if e != nil {
		return nil, e
	}
	rows, e := s.Q.ListSessions(ctx, dbgen.ListSessionsParams{UserID: user, Mode: mode, Status: status, Entry: entry, PageLimit: int32(size), PageOffset: int32((page - 1) * size)})
	out := []map[string]any{}
	for _, r := range rows {
		out = append(out, map[string]any{"id": r.ID, "userId": r.UserID, "nickname": r.Nickname, "entry": r.Entry, "mode": r.Mode, "ordinal": r.Ordinal, "title": r.Title, "revisionId": r.RevisionID, "status": r.Status, "settled": r.Settled, "moves": r.Moves, "cleared": r.Cleared, "total": r.Total, "steps": r.LastSeq, "rewardCoins": r.RewardCoins, "startedAt": r.StartedAt})
	}
	return map[string]any{"items": out, "total": count, "page": page, "pageSize": size}, e
}
