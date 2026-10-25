package httpapi

import (
	"context"
	"testing"
	"time"

	"happy-pet/api/internal/game"
)

func TestLevelAnalyticsBrowserIntegration(t *testing.T) {
	runBrowserIntegration(t, "scripts/test-level-analytics-browser.cjs", func(h *harness) {
		ctx := context.Background()
		a, b := login(t, h, "qa-analytics-browser-a"), login(t, h, "qa-analytics-browser-b")
		levelID := "standard-classic-1"
		oldRevision := analyticsRevision(t, h, levelID)
		draft, err := h.games.SaveLevel(ctx, levelID, game.DraftInput{
			Entry: "standard", Mode: "classic", Ordinal: 1, Title: "数据分析验收关卡",
			Config: game.DefaultConfig("classic", 1), DraftVersion: 1,
		})
		if err != nil {
			t.Fatal(err)
		}
		current, err := h.games.Publish(ctx, levelID, "qa-admin", draft.DraftVersion)
		if err != nil {
			t.Fatal(err)
		}
		started := analyticsToday().AddDate(0, 0, -1).Add(9 * time.Hour)
		oneMinute, twoMinutes := started.Add(time.Minute), started.Add(2*time.Minute)
		first := analyticsSession(t, h, a.User.ID, levelID, oldRevision, "won", started, &oneMinute, 9)
		analyticsSession(t, h, a.User.ID, levelID, oldRevision, "lost", started, &oneMinute, 7)
		second := analyticsSession(t, h, b.User.ID, levelID, current.RevisionID, "won", started, &twoMinutes, 15)
		analyticsSession(t, h, a.User.ID, levelID, current.RevisionID, "abandoned", started, &oneMinute, 1)
		analyticsSession(t, h, b.User.ID, levelID, current.RevisionID, "playing", started, nil, 2)
		older := started.AddDate(0, 0, -100)
		oldEnd := older.Add(3 * time.Minute)
		analyticsSession(t, h, a.User.ID, levelID, oldRevision, "won", older, &oldEnd, 18)
		// Controlled historical fixtures exercise the real SQL/API and built UI together.
		// Live action validation and deduplication are covered by TestLevelAnalyticsValidatedToolUsesAreCountedOnce.
		_, err = h.db.Exec(`INSERT INTO game_events(session_id,seq,action,state) VALUES
			($1,1,'{"type":"hint"}','{}'),($1,2,'{"type":"hint"}','{}'),($2,1,'{"type":"hint"}','{}')`, first, second)
		if err != nil {
			t.Fatal(err)
		}
		_, err = h.games.SaveLevel(ctx, "", game.DraftInput{
			Entry: "standard", Mode: "classic", Ordinal: 3, Title: "暂无样本的草稿",
			Config: game.DefaultConfig("classic", 1),
		})
		if err != nil {
			t.Fatal(err)
		}
	})
}
