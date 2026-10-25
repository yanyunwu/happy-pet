package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"strings"
	"sync"
	"testing"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/game"
)

const funRulesMarker = "level_rules:fun_pairs:v1"

func legacyFunConfig(stage int) game.Config {
	c := game.DefaultConfig("fun", stage)
	c.RulesVersion, c.Rules = game.LegacyRulesVersion, nil
	if stage == 1 {
		c.Counts[0] = 3
		c.Layers[0].Cells = c.Layers[0].Cells[:7]
	} else {
		for kind := range c.Counts {
			c.Counts[kind] = 6
			if kind < 6 {
				c.Counts[kind] = 9
			}
		}
	}
	return c
}

func migrationJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// Reconstruct snapshots that predate the migration in the isolated test schema.
func installOldFunLevel(t *testing.T, db *sql.DB, id string, draft, published game.Config, enabled bool) dbgen.LevelRevision {
	t.Helper()
	ctx := context.Background()
	q := dbgen.New(db)
	l, err := q.GetLevel(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE levels SET draft=$2,title='未发布编辑',enabled=$3 WHERE id=$1", id, migrationJSON(t, draft), enabled); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "UPDATE level_revisions SET config=$2,title='已发布旧名称' WHERE id=$1", l.PublishedRevision.String, migrationJSON(t, published)); err != nil {
		t.Fatal(err)
	}
	r, err := q.GetRevision(ctx, l.PublishedRevision.String)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func resetFunMigration(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), "DELETE FROM system_initializations WHERE init_key=$1", funRulesMarker); err != nil {
		t.Fatal(err)
	}
}

func assertPurePairConfig(t *testing.T, data []byte, expectedTiles int) game.Config {
	t.Helper()
	var c game.Config
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatal(err)
	}
	if c.RulesVersion != game.RulesVersion || !reflect.DeepEqual(c.Rules, [][]int{{2, 2}}) {
		t.Fatal("fun configuration was not converted to pure pairs", c.RulesVersion, c.Rules)
	}
	for seed := uint32(1); seed <= 3; seed++ {
		board, route, err := game.NewBoard(c, seed)
		if err != nil || len(board.Tiles) != expectedTiles {
			t.Fatal("converted layout/counts do not match", err, len(board.Tiles), expectedTiles)
		}
		for _, id := range route {
			if err = board.Pick(id); err != nil {
				t.Fatal(err)
			}
		}
		if board.Status != "won" {
			t.Fatal("converted configuration has no valid witness")
		}
	}
	return c
}

func TestFunRuleMigrationSeparatesDraftPublishedAndHistoricalSessions(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	q := dbgen.New(h.db)
	published := legacyFunConfig(1)
	draft := legacyFunConfig(2)
	draft.RewardCoins, draft.FreeTools["hint"] = 91, 6
	old := installOldFunLevel(t, h.db, "fun-1", draft, published, true)
	disabledOld := installOldFunLevel(t, h.db, "standard-fun-1", published, published, false)
	installOldFunLevel(t, h.db, "standard-fun-2", legacyFunConfig(2), legacyFunConfig(2), true)
	if _, err := q.CreateLevel(ctx, dbgen.CreateLevelParams{ID: "draft-fun", Entry: "campaign", Mode: "fun", Ordinal: 3, Title: "未发布关卡", Draft: migrationJSON(t, published)}); err != nil {
		t.Fatal(err)
	}
	unfinished := published
	unfinished.Layers = nil
	if _, err := q.CreateLevel(ctx, dbgen.CreateLevelParams{ID: "unfinished-fun", Entry: "campaign", Mode: "fun", Ordinal: 4, Title: "未画完的草稿", Draft: migrationJSON(t, unfinished)}); err != nil {
		t.Fatal(err)
	}
	// Both a settled record and an in-progress legacy session must survive.
	winner := login(t, h, "qa-migration-winner")
	win := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Mode: "fun", RequestID: "migration-winner-session"}, winner.AccessToken), 200)
	finishCatalogWin(t, h, winner.AccessToken, win)
	player := login(t, h, "qa-migration-pending")
	session := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Mode: "fun", RequestID: "migration-pending-session"}, player.AccessToken), 200)
	if _, err := h.db.ExecContext(ctx, "UPDATE game_sessions SET state=state-'rules',initial=initial-'rules' WHERE id=$1", session.ID); err != nil {
		t.Fatal(err)
	}
	beforeSession, _ := q.GetSession(ctx, session.ID)
	beforeWinner, _ := q.GetSession(ctx, win.ID)
	beforeAssets, _ := q.GetAssets(ctx, winner.User.ID)
	beforeClears, _ := q.ListClears(ctx, winner.User.ID)
	classicBefore, _ := q.GetLevel(ctx, "classic-1")
	resetFunMigration(t, h.db)
	if err := game.Seed(ctx, h.db); err != nil {
		t.Fatal(err)
	}
	l, err := q.GetLevel(ctx, "fun-1")
	if err != nil || l.PublishedRevision.String == old.ID || l.Title != "未发布编辑" || !l.Enabled || l.DraftVersion != 2 {
		t.Fatal("migration did not repoint and preserve the level", l, err)
	}
	draftAfter := assertPurePairConfig(t, l.Draft, 108)
	if draftAfter.RewardCoins != 91 || draftAfter.FreeTools["hint"] != 6 {
		t.Fatal("migration discarded unsaved draft settings")
	}
	newRevision, _ := q.GetRevision(ctx, l.PublishedRevision.String)
	publishedAfter := assertPurePairConfig(t, newRevision.Config, 8)
	if newRevision.Version != 2 || newRevision.Title != old.Title || publishedAfter.RewardCoins != 10 || publishedAfter.FreeTools["hint"] != 3 {
		t.Fatal("migration accidentally published draft metadata/settings", newRevision)
	}
	if !reflect.DeepEqual(publishedAfter.Counts[:3], []int{4, 2, 2}) {
		t.Fatal("tutorial migration changed more counts than necessary", publishedAfter.Counts)
	}
	if !reflect.DeepEqual(publishedAfter.Layers[0].Cells[:7], published.Layers[0].Cells) || publishedAfter.Columns != published.Columns || publishedAfter.Rows != published.Rows {
		t.Fatal("tutorial migration moved existing geometry")
	}
	disabled, _ := q.GetLevel(ctx, "standard-fun-1")
	if disabled.Enabled || disabled.PublishedRevision.String == disabledOld.ID {
		t.Fatal("disabled level was enabled or left unmigrated")
	}
	draftOnly, _ := q.GetLevel(ctx, "draft-fun")
	assertPurePairConfig(t, draftOnly.Draft, 8)
	if draftOnly.PublishedRevision.Valid || draftOnly.Enabled {
		t.Fatal("unpublished draft was published")
	}
	incomplete, _ := q.GetLevel(ctx, "unfinished-fun")
	var incompleteConfig game.Config
	if err := json.Unmarshal(incomplete.Draft, &incompleteConfig); err != nil || !reflect.DeepEqual(incompleteConfig.Rules, [][]int{{2, 2}}) || len(incompleteConfig.Layers) != 0 {
		t.Fatal("incomplete draft rule was not migrated without inventing a layout", err)
	}
	oldAfter, _ := q.GetRevision(ctx, old.ID)
	afterSession, _ := q.GetSession(ctx, session.ID)
	afterWinner, _ := q.GetSession(ctx, win.ID)
	afterAssets, _ := q.GetAssets(ctx, winner.User.ID)
	afterClears, _ := q.ListClears(ctx, winner.User.ID)
	classicAfter, _ := q.GetLevel(ctx, "classic-1")
	if !reflect.DeepEqual(oldAfter, old) || !reflect.DeepEqual(beforeSession, afterSession) || !reflect.DeepEqual(beforeWinner, afterWinner) || !reflect.DeepEqual(beforeAssets, afterAssets) || !reflect.DeepEqual(beforeClears, afterClears) || !reflect.DeepEqual(classicBefore, classicAfter) {
		t.Fatal("migration changed historical records, assets, progress, or another mode")
	}
	finishCatalogWin(t, h, player.AccessToken, session)
	replay := decode[map[string]any](t, h.call("GET", "/api/v1/admin/sessions/"+session.ID+"/replay", nil, "admin"), 200)
	replayConfig := replay["config"].(map[string]any)
	if replayConfig["rulesVersion"] != game.LegacyRulesVersion || replayConfig["rules"] != nil {
		t.Fatal("historical replay acquired migrated rules")
	}
	newPlayer := login(t, h, "qa-migration-new-player")
	newSession := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Mode: "fun", RequestID: "migration-new-session-01"}, newPlayer.AccessToken), 200)
	if newSession.RevisionID != newRevision.ID || !reflect.DeepEqual(newSession.State.Rules, [][]int{{2, 2}}) {
		t.Fatal("new session did not use migrated revision")
	}
	finishCatalogWin(t, h, newPlayer.AccessToken, newSession)
}

func TestFunRuleMigrationIsConcurrentSafeAndRunsOnce(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	q := dbgen.New(h.db)
	old := legacyFunConfig(1)
	installOldFunLevel(t, h.db, "fun-1", old, old, true)
	resetFunMigration(t, h.db)
	errors := make(chan error, 4)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errors <- game.Seed(ctx, h.db) }()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	revisions, _ := q.ListRevisions(ctx, "fun-1")
	if len(revisions) != 2 {
		t.Fatal("concurrent migration did not create exactly one new revision", len(revisions))
	}
	l, _ := q.GetLevel(ctx, "fun-1")
	custom := game.DefaultConfig("classic", 1)
	custom.Mode = "fun"
	saved, err := h.games.SaveLevel(ctx, l.ID, game.DraftInput{Entry: l.Entry, Mode: l.Mode, Ordinal: l.Ordinal, Title: "后续选择三消", Config: custom, DraftVersion: l.DraftVersion})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.games.Publish(ctx, saved.ID, "test", saved.DraftVersion); err != nil {
		t.Fatal(err)
	}
	before, _ := q.GetLevel(ctx, saved.ID)
	if err = game.Seed(ctx, h.db); err != nil {
		t.Fatal(err)
	}
	after, _ := q.GetLevel(ctx, saved.ID)
	revisions, _ = q.ListRevisions(ctx, saved.ID)
	if !reflect.DeepEqual(before, after) || len(revisions) != 3 {
		t.Fatal("repeated startup overwrote an intentionally authored single rule")
	}
}

func TestFunRuleMigrationRollsBackAllLevelsOnPublishedFailure(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	q := dbgen.New(h.db)
	old := legacyFunConfig(1)
	installOldFunLevel(t, h.db, "fun-1", old, old, true)
	bad := legacyFunConfig(2)
	bad.Layers[0].Cells[1] = bad.Layers[0].Cells[0]
	installOldFunLevel(t, h.db, "standard-fun-2", old, bad, true)
	resetFunMigration(t, h.db)
	beforeLevels, _ := q.ListLevels(ctx)
	var beforeCount int
	if err := h.db.QueryRowContext(ctx, "SELECT count(*) FROM level_revisions").Scan(&beforeCount); err != nil {
		t.Fatal(err)
	}
	err := game.Seed(ctx, h.db)
	if err == nil || !strings.Contains(err.Error(), "standard-fun-2") {
		t.Fatal("invalid published geometry did not abort with level context", err)
	}
	afterLevels, _ := q.ListLevels(ctx)
	var afterCount int
	if err := h.db.QueryRowContext(ctx, "SELECT count(*) FROM level_revisions").Scan(&afterCount); err != nil {
		t.Fatal(err)
	}
	marked, _ := q.HasSystemInitialization(ctx, funRulesMarker)
	if !reflect.DeepEqual(beforeLevels, afterLevels) || beforeCount != afterCount || marked {
		t.Fatal("failed migration committed a partial draft/revision/marker")
	}
}

func TestFreshSeedDoesNotDuplicatePurePairRevisions(t *testing.T) {
	h := setup(t)
	ctx := context.Background()
	q := dbgen.New(h.db)
	marked, err := q.HasSystemInitialization(ctx, funRulesMarker)
	if err != nil || !marked {
		t.Fatal("fresh seed did not record the migration", err)
	}
	for _, id := range []string{"fun-1", "fun-2", "standard-fun-1", "standard-fun-2"} {
		revisions, err := q.ListRevisions(ctx, id)
		if err != nil || len(revisions) != 1 {
			t.Fatal("fresh pure-pair seed created redundant revisions", id, len(revisions), err)
		}
		count := 8
		if strings.HasSuffix(id, "-2") {
			count = 108
		}
		assertPurePairConfig(t, revisions[0].Config, count)
	}
}
