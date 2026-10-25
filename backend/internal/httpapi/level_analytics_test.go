package httpapi

import (
	"context"
	"encoding/json"
	"math"
	"testing"
	"time"

	"happy-pet/api/internal/game"
	"happy-pet/api/internal/users"
)

type analyticsTestResult struct {
	Level struct {
		ID, Title, Entry, Mode, PublishedRevisionID string
		Ordinal                                     int32
	}
	Range, RevisionID, TrendFrom, Timezone string
	From                                   *time.Time
	To, GeneratedAt                        time.Time
	Summary                                struct {
		Attempts, Players, Won, Lost, Abandoned, Unfinished int64
		WinRate, FinishedWinRate                            *float64
		AvgWinDurationSeconds, AvgWinMoves                  *float64
		WinDurationSamples                                  int64
	}
	Daily []struct {
		Date                                       string
		Attempts, Won, Lost, Abandoned, Unfinished int64
		WinRate                                    *float64
	}
	Revisions []struct {
		ID, Title   string
		Version     int32
		PublishedAt time.Time
		Current     bool
	}
	Tools []struct {
		Type           string
		Uses, Sessions int64
	}
}

func analyticsToday() time.Time {
	now := time.Now().In(time.FixedZone("Asia/Shanghai", 8*3600))
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
}

func analyticsSession(t *testing.T, h *harness, user, level, revision, status string, started time.Time, ended *time.Time, moves int) string {
	t.Helper()
	id := users.NewID()
	state, err := json.Marshal(map[string]any{"moves": moves})
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.db.Exec(`INSERT INTO game_sessions(id,user_id,request_key,campaign_id,level_id,revision_id,mode,ordinal,seed,initial,state,status,started_at,ended_at,entry,title)
SELECT $1,$2,$1,$1,l.id,$3,l.mode,l.ordinal,1,'{}',$4,$5,$6,$7,l.entry,l.title FROM levels l WHERE l.id=$8`,
		id, user, revision, state, status, started, ended, level)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func analyticsRevision(t *testing.T, h *harness, level string) string {
	t.Helper()
	row, err := h.games.Q.GetLevel(context.Background(), level)
	if err != nil {
		t.Fatal(err)
	}
	return row.PublishedRevision.String
}

func requireAnalyticsNumber(t *testing.T, value *float64, want float64) {
	t.Helper()
	if value == nil || math.Abs(*value-want) > 0.000001 {
		t.Fatalf("analytics number %v, want %.8f", value, want)
	}
}

func TestLevelAnalyticsEmptyDraft(t *testing.T) {
	h := setup(t)
	draft, err := h.games.SaveLevel(context.Background(), "", game.DraftInput{
		Entry: "campaign", Mode: "classic", Ordinal: 3, Title: "待发布的数据分析关卡", Config: game.DefaultConfig("classic", 1),
	})
	if err != nil {
		t.Fatal(err)
	}
	result := decode[analyticsTestResult](t, h.call("GET", "/api/v1/admin/levels/"+draft.ID+"/analytics", nil, "admin"), 200)
	if result.Range != "30d" || result.Timezone != "Asia/Shanghai" || len(result.Daily) != 30 || result.RevisionID != "" {
		t.Fatal("missing default analytics period", result)
	}
	if result.Level.ID != draft.ID || result.Level.Title != draft.Title || result.Level.PublishedRevisionID != "" {
		t.Fatal("draft identity missing", result.Level)
	}
	if result.Summary.Attempts != 0 || result.Summary.Players != 0 || result.Summary.Won != 0 || result.Summary.Unfinished != 0 || result.Summary.WinDurationSamples != 0 ||
		result.Summary.WinRate != nil || result.Summary.FinishedWinRate != nil || result.Summary.AvgWinDurationSeconds != nil || result.Summary.AvgWinMoves != nil || len(result.Revisions) != 0 {
		t.Fatal("empty level invents data", result)
	}
	for _, day := range result.Daily {
		if day.Attempts != 0 || day.Won != 0 || day.Lost != 0 || day.Abandoned != 0 || day.Unfinished != 0 || day.WinRate != nil {
			t.Fatal("empty day invents data", day)
		}
	}
	if len(result.Tools) != 5 {
		t.Fatal("missing zero-use tools", result.Tools)
	}
	for i, kind := range []string{"undo", "shovel", "hint", "shuffle", "unlock_slot"} {
		if result.Tools[i].Type != kind || result.Tools[i].Uses != 0 || result.Tools[i].Sessions != 0 {
			t.Fatal("wrong empty tool result", result.Tools[i])
		}
	}
}

func TestLevelAnalyticsSummaryAndRevisionFilter(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	a, b := login(t, h, "qa-analytics-a"), login(t, h, "qa-analytics-b")
	levelID := "classic-1"
	oldRevision := analyticsRevision(t, h, levelID)
	draft, err := h.games.SaveLevel(ctx, levelID, game.DraftInput{Entry: "campaign", Mode: "classic", Ordinal: 1, Title: "新版分析关卡", Config: game.DefaultConfig("classic", 1), DraftVersion: 1})
	if err != nil {
		t.Fatal(err)
	}
	current, err := h.games.Publish(ctx, levelID, "qa-admin", draft.DraftVersion)
	if err != nil {
		t.Fatal(err)
	}
	today := analyticsToday()
	started := today.AddDate(0, 0, -2).Add(9 * time.Hour)
	oneMinute, twoMinutes, invalidEnd := started.Add(time.Minute), started.Add(2*time.Minute), started.Add(-time.Second)
	analyticsSession(t, h, a.User.ID, levelID, oldRevision, "won", started, &oneMinute, 18)
	analyticsSession(t, h, a.User.ID, levelID, oldRevision, "won", started, &twoMinutes, 12)
	analyticsSession(t, h, b.User.ID, levelID, oldRevision, "lost", started, &oneMinute, 7)
	analyticsSession(t, h, b.User.ID, levelID, oldRevision, "playing", started, nil, 3)
	analyticsSession(t, h, b.User.ID, levelID, current.RevisionID, "won", started, nil, 22)
	analyticsSession(t, h, b.User.ID, levelID, current.RevisionID, "won", started, &invalidEnd, 8)
	analyticsSession(t, h, a.User.ID, levelID, current.RevisionID, "abandoned", started.AddDate(0, 0, 1), nil, 4)
	analyticsSession(t, h, a.User.ID, "standard-classic-1", analyticsRevision(t, h, "standard-classic-1"), "won", started, &oneMinute, 18)
	analyticsSession(t, h, a.User.ID, levelID, current.RevisionID, "lost", today.AddDate(0, 0, -40), nil, 7)
	analyticsSession(t, h, a.User.ID, levelID, current.RevisionID, "won", today.AddDate(0, 0, 1), nil, 18)
	before := time.Now()
	result := decode[analyticsTestResult](t, h.call("GET", "/api/v1/admin/levels/"+levelID+"/analytics", nil, "admin"), 200)
	if result.Summary.Attempts != 7 || result.Summary.Players != 2 || result.Summary.Won != 4 || result.Summary.Lost != 1 || result.Summary.Abandoned != 1 || result.Summary.Unfinished != 1 {
		t.Fatal("incorrect cohort or distinct player counts", result.Summary)
	}
	requireAnalyticsNumber(t, result.Summary.WinRate, 400.0/7)
	requireAnalyticsNumber(t, result.Summary.FinishedWinRate, 400.0/6)
	requireAnalyticsNumber(t, result.Summary.AvgWinDurationSeconds, 90)
	requireAnalyticsNumber(t, result.Summary.AvgWinMoves, 15)
	if result.Summary.WinDurationSamples != 2 {
		t.Fatal("invalid or missing end times counted as duration samples", result.Summary)
	}
	if result.Level.ID != levelID || result.Level.Title != current.Title || result.Level.Entry != "campaign" || result.Level.Mode != "classic" || result.Level.Ordinal != 1 || result.Level.PublishedRevisionID != current.RevisionID {
		t.Fatal("incorrect level identity", result.Level)
	}
	if result.From == nil || !result.From.Equal(today.AddDate(0, 0, -29)) || result.To.Before(before) || result.To.After(time.Now()) || !result.GeneratedAt.Equal(result.To) {
		t.Fatal("incorrect window metadata", result)
	}
	if len(result.Revisions) != 2 || result.Revisions[0].ID != current.RevisionID || !result.Revisions[0].Current || result.Revisions[0].Version != 2 || result.Revisions[0].PublishedAt.IsZero() || result.Revisions[0].Title != current.Title || result.Revisions[1].ID != oldRevision || result.Revisions[1].Current {
		t.Fatal("incorrect revision metadata", result.Revisions)
	}
	var total int64
	for _, day := range result.Daily {
		total += day.Attempts
		if day.Date == started.Format(time.DateOnly) {
			if day.Attempts != 6 || day.Won != 4 || day.Lost != 1 || day.Unfinished != 1 {
				t.Fatal("wrong daily grouping", day)
			}
			requireAnalyticsNumber(t, day.WinRate, 400.0/6)
		}
	}
	if total != result.Summary.Attempts {
		t.Fatal("daily and summary totals disagree", total, result.Summary.Attempts)
	}
	filtered := decode[analyticsTestResult](t, h.call("GET", "/api/v1/admin/levels/"+levelID+"/analytics?range=7d&revisionId="+oldRevision, nil, "admin"), 200)
	if filtered.RevisionID != oldRevision || filtered.Summary.Attempts != 4 || filtered.Summary.Players != 2 || filtered.Summary.Won != 2 || filtered.Summary.Abandoned != 0 || filtered.Summary.Unfinished != 1 || len(filtered.Revisions) != 2 {
		t.Fatal("revision filter lost cohort or history", filtered)
	}
	requireAnalyticsNumber(t, filtered.Summary.WinRate, 50)
	requireAnalyticsNumber(t, filtered.Summary.FinishedWinRate, 200.0/3)
}

func TestLevelAnalyticsCalendarRanges(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-analytics-calendar")
	levelID, today := "classic-1", analyticsToday()
	revision := analyticsRevision(t, h, levelID)
	boundary := today.AddDate(0, 0, -6)
	for _, started := range []time.Time{boundary.Add(-time.Microsecond), boundary, today.AddDate(0, 0, -29), today.AddDate(0, 0, -89), today.AddDate(0, 0, -120)} {
		analyticsSession(t, h, player.User.ID, levelID, revision, "playing", started.UTC(), nil, 1)
	}
	for _, tc := range []struct {
		window string
		days   int
		count  int64
	}{{"7d", 7, 1}, {"30d", 30, 3}, {"90d", 90, 4}, {"all", 90, 5}} {
		t.Run(tc.window, func(t *testing.T) {
			result := decode[analyticsTestResult](t, h.call("GET", "/api/v1/admin/levels/"+levelID+"/analytics?range="+tc.window, nil, "admin"), 200)
			first := today.AddDate(0, 0, -(tc.days - 1))
			if result.Range != tc.window || len(result.Daily) != tc.days || result.TrendFrom != first.Format(time.DateOnly) || result.Daily[0].Date != first.Format(time.DateOnly) || result.Daily[tc.days-1].Date != today.Format(time.DateOnly) || result.Summary.Attempts != tc.count || result.Summary.Unfinished != tc.count || result.Summary.FinishedWinRate != nil {
				t.Fatal("incorrect calendar range", result)
			}
			requireAnalyticsNumber(t, result.Summary.WinRate, 0)
			if tc.window == "all" {
				if result.From != nil {
					t.Fatal("all-history start must be null", result.From)
				}
			} else if result.From == nil || !result.From.Equal(first) {
				t.Fatal("window did not start at Shanghai midnight", result.From, first)
			}
			var total int64
			for i, day := range result.Daily {
				if day.Date != first.AddDate(0, 0, i).Format(time.DateOnly) {
					t.Fatal("daily series is not continuous", result.Daily)
				}
				total += day.Attempts
			}
			want := tc.count
			if tc.window == "all" {
				want = 4
			}
			if total != want {
				t.Fatal("trend did not apply its own calendar boundary", total, want)
			}
		})
	}
}

func TestLevelAnalyticsAuthorizationAndValidation(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-analytics-auth")
	path := "/api/v1/admin/levels/classic-1/analytics"
	requireStatus(t, h.call("GET", path, nil, ""), 401)
	requireStatus(t, h.call("GET", path, nil, player.AccessToken), 401)
	requireStatus(t, h.call("GET", path, nil, "admin"), 200)
	token := tokenFor(t, h, h.cookie, "")
	requireStatus(t, h.call("GET", path, nil, token), 200)
	for _, query := range []string{"?range=week", "?range=0d", "?range=7D", "?range=%207d", "?revisionId=missing", "?revisionId=" + analyticsRevision(t, h, "quartet-1")} {
		t.Run(query, func(t *testing.T) {
			requireStatus(t, h.call("GET", path+query, nil, "admin"), 400)
		})
	}
	requireStatus(t, h.call("GET", "/api/v1/admin/levels/missing/analytics", nil, "admin"), 404)
}

func TestLevelAnalyticsValidatedToolUsesAreCountedOnce(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-analytics-tools")
	ctx := context.Background()
	session, err := h.games.Start(ctx, player.User.ID, game.StartInput{Mode: "classic", RequestID: "qa-analytics-tools-0001"})
	if err != nil {
		t.Fatal(err)
	}
	_, route, err := game.NewBoard(game.DefaultConfig("classic", 1), uint32(session.Seed))
	if err != nil {
		t.Fatal(err)
	}
	events := []game.Action{{Seq: 1, Type: "pick", TileID: route[0]}, {Seq: 2, Type: "undo"}, {Seq: 3, Type: "pick", TileID: route[0]}, {Seq: 4, Type: "shovel"}, {Seq: 5, Type: "hint"}, {Seq: 6, Type: "hint"}, {Seq: 7, Type: "shuffle"}, {Seq: 8, Type: "unlock_slot"}}
	for range 2 {
		if _, err = h.games.Events(ctx, player.User.ID, session.ID, events); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = h.games.Events(ctx, player.User.ID, session.ID, []game.Action{{Seq: 9, Type: "shuffle"}}); err == nil {
		t.Fatal("invalid tool use unexpectedly accepted")
	}
	other, err := h.games.Start(ctx, player.User.ID, game.StartInput{Mode: "classic", RequestID: "qa-analytics-tools-0002"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.games.Events(ctx, player.User.ID, other.ID, []game.Action{{Seq: 1, Type: "hint"}}); err != nil {
		t.Fatal(err)
	}
	unrelated, err := h.games.Start(ctx, player.User.ID, game.StartInput{Entry: "standard", Mode: "classic", RequestID: "qa-analytics-tools-0003"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.games.Events(ctx, player.User.ID, unrelated.ID, []game.Action{{Seq: 1, Type: "hint"}}); err != nil {
		t.Fatal(err)
	}
	result := decode[analyticsTestResult](t, h.call("GET", "/api/v1/admin/levels/"+session.LevelID+"/analytics", nil, "admin"), 200)
	if len(result.Tools) != 5 {
		t.Fatal("missing tool categories", result.Tools)
	}
	for _, tool := range result.Tools {
		uses, sessions := int64(1), int64(1)
		if tool.Type == "hint" {
			uses, sessions = 3, 2
		}
		if tool.Uses != uses || tool.Sessions != sessions {
			t.Fatal("tool retries, invalid events, or other level leaked into counts", tool)
		}
	}
}
