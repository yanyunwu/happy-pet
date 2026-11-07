package httpapi

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/game"
	"happy-pet/api/internal/users"
)

type toolPolicySnapshot struct {
	session dbgen.GameSession
	assets  dbgen.PlayerAsset
	events  []dbgen.GameEvent
	ledger  []dbgen.AssetLedger
}

func snapshotToolPolicy(t *testing.T, h *harness, userID, sessionID string) toolPolicySnapshot {
	t.Helper()
	ctx, q := context.Background(), dbgen.New(h.db)
	session, err := q.GetSession(ctx, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	assets, err := q.GetAssets(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	events, err := q.ListEvents(ctx, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	ledger, err := q.ListLedger(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	return toolPolicySnapshot{session, assets, events, ledger}
}

func assertToolPolicyUnchanged(t *testing.T, h *harness, before toolPolicySnapshot) {
	t.Helper()
	after := snapshotToolPolicy(t, h, before.session.UserID, before.session.ID)
	if !reflect.DeepEqual(after, before) {
		t.Fatal("rejected request changed persisted session, sequence, assets, events, or ledger")
	}
}

func grantToolPolicyStock(t *testing.T, h *harness, player users.Session, count int64) game.Assets {
	t.Helper()
	var assets game.Assets
	for _, kind := range game.Tools {
		assets = decode[game.Assets](t, h.call("POST", "/api/v1/admin/users/"+player.User.ID+"/assets", game.Adjustment{
			RequestID: "qa-policy-grant-" + kind, Asset: kind, Delta: count, Reason: "验证入口道具策略",
		}, "admin"), 200)
	}
	return assets
}

func startToolPolicySession(t *testing.T, h *harness, player users.Session, entry, mode, key string) game.SessionView {
	t.Helper()
	return decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{
		Entry: entry, Mode: mode, RequestID: "qa-policy-start-" + key,
	}, player.AccessToken), 200)
}

// Repeated undo/shovel uses each get a valid pick first. Picking a reserve tile
// again keeps shovel tests playable without consuming or clearing the board.
func toolPolicyActions(t *testing.T, result game.EventResult, kind string) []game.Action {
	t.Helper()
	actions := []game.Action{}
	seq := int(result.LastSeq) + 1
	if kind == "undo" || kind == "shovel" {
		chosen := -1
		for _, tile := range result.State.Tiles {
			if result.State.Open(tile.ID) {
				chosen = tile.ID
				break
			}
		}
		if chosen < 0 {
			t.Fatal("fixture has no playable tile")
		}
		actions = append(actions, game.Action{Seq: seq, Type: "pick", TileID: chosen, At: int64(seq * 100)})
		seq++
	}
	return append(actions, game.Action{Seq: seq, Type: kind, At: int64(seq * 100)})
}

func sendToolPolicyActions(t *testing.T, h *harness, player users.Session, sessionID string, actions []game.Action) game.EventResult {
	t.Helper()
	return decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+sessionID+"/events", map[string]any{"events": actions}, player.AccessToken), 200)
}

func TestToolPolicyStandardUsesOnlyFreeAllowance(t *testing.T) {
	h := setup(t)
	for _, mode := range []string{"classic", "quartet", "fun"} {
		t.Run(mode, func(t *testing.T) {
			player := login(t, h, "qa-policy-standard-"+mode)
			grantToolPolicyStock(t, h, player, 4)
			for _, kind := range game.Tools {
				if kind == "hint" {
					continue
				}
				t.Run(kind, func(t *testing.T) {
					session := startToolPolicySession(t, h, player, "standard", mode, mode+"-"+kind)
					assets := decode[game.Assets](t, h.call("GET", "/api/v1/user/assets", nil, player.AccessToken), 200)
					initial := snapshotToolPolicy(t, h, player.User.ID, session.ID)
					result := game.EventResult{State: session.State, Assets: assets}
					free := session.State.Tools[kind]
					if free < 1 {
						t.Fatal("fixture needs a positive free allowance")
					}
					for remaining := free - 1; remaining >= 0; remaining-- {
						result = sendToolPolicyActions(t, h, player, session.ID, toolPolicyActions(t, result, kind))
						if result.State.Tools[kind] != remaining || !reflect.DeepEqual(result.Assets, assets) {
							t.Fatal("standard free use did not consume exactly one allowance while preserving inventory")
						}
					}
					before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
					if !reflect.DeepEqual(before.ledger, initial.ledger) {
						t.Fatal("standard free use wrote an inventory ledger entry")
					}
					actions := toolPolicyActions(t, result, kind)
					w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": actions}, player.AccessToken)
					if w.Code != 400 {
						t.Fatalf("standard %s exceeded its free allowance with positive inventory: status %d", kind, w.Code)
					}
					if !strings.Contains(w.Body.String(), "免费") {
						t.Fatal("standard rejection did not explain the free allowance", w.Body.String())
					}
					assertToolPolicyUnchanged(t, h, before)
					restarted := startToolPolicySession(t, h, player, "standard", mode, mode+"-"+kind+"-restart")
					if !reflect.DeepEqual(restarted.State.Tools, session.State.Tools) {
						t.Fatal("new standard session did not reset its free allowances")
					}
					if after := decode[game.Assets](t, h.call("GET", "/api/v1/user/assets", nil, player.AccessToken), 200); !reflect.DeepEqual(after, assets) {
						t.Fatal("restarting standard changed inventory")
					}
				})
			}
		})
	}
}

func TestToolPolicyCampaignAllowsOneInventoryItem(t *testing.T) {
	h := setup(t)
	for _, mode := range []string{"classic", "quartet", "fun"} {
		t.Run(mode, func(t *testing.T) {
			player := login(t, h, "qa-policy-campaign-"+mode)
			grantToolPolicyStock(t, h, player, 4)
			for _, kind := range game.Tools {
				if kind == "hint" {
					continue
				}
				t.Run(kind, func(t *testing.T) {
					session := startToolPolicySession(t, h, player, "campaign", mode, mode+"-"+kind)
					assets := decode[game.Assets](t, h.call("GET", "/api/v1/user/assets", nil, player.AccessToken), 200)
					initial := snapshotToolPolicy(t, h, player.User.ID, session.ID)
					result := game.EventResult{State: session.State, Assets: assets}
					for remaining := session.State.Tools[kind] - 1; remaining >= 0; remaining-- {
						result = sendToolPolicyActions(t, h, player, session.ID, toolPolicyActions(t, result, kind))
						if result.State.Tools[kind] != remaining || !reflect.DeepEqual(result.Assets, assets) {
							t.Fatal("campaign did not use free allowance before inventory")
						}
					}
					if afterFree := snapshotToolPolicy(t, h, player.User.ID, session.ID); !reflect.DeepEqual(afterFree.ledger, initial.ledger) {
						t.Fatal("campaign free use wrote an inventory ledger entry")
					}
					for remaining := int32(3); remaining >= 3; remaining-- {
						actions := toolPolicyActions(t, result, kind)
						result = sendToolPolicyActions(t, h, player, session.ID, actions)
						assets.Bag[kind] = remaining
						if result.State.Tools[kind] != 0 || !reflect.DeepEqual(result.Assets, assets) {
							t.Fatal("valid campaign use did not charge exactly one matching inventory item")
						}
						beforeRetry := snapshotToolPolicy(t, h, player.User.ID, session.ID)
						key := fmt.Sprintf("session:%s:%d", session.ID, result.LastSeq)
						charges, err := dbgen.New(h.db).LedgerByKey(context.Background(), dbgen.LedgerByKeyParams{UserID: player.User.ID, RequestKey: key})
						if err != nil || len(charges) != 1 || charges[0].Asset != kind || charges[0].Delta != -1 || charges[0].Balance != int64(remaining) {
							t.Fatal("campaign inventory charge was not recorded exactly once", charges, err)
						}
						retry := sendToolPolicyActions(t, h, player, session.ID, actions)
						afterRetry := snapshotToolPolicy(t, h, player.User.ID, session.ID)
						if !reflect.DeepEqual(retry, result) || !reflect.DeepEqual(afterRetry.ledger, beforeRetry.ledger) || !reflect.DeepEqual(afterRetry.events, beforeRetry.events) {
							t.Fatal("repeating the same sequence changed state or charged inventory again")
						}
						if remaining == 3 {
							restarted := startToolPolicySession(t, h, player, "campaign", mode, mode+"-"+kind+"-restart")
							persisted := decode[game.Assets](t, h.call("GET", "/api/v1/user/assets", nil, player.AccessToken), 200)
							if !reflect.DeepEqual(restarted.State.Tools, session.State.Tools) || !reflect.DeepEqual(persisted, assets) {
								t.Fatal("new campaign session did not reset free allowances while retaining spent inventory")
							}
						}
					}
					before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
					w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": toolPolicyActions(t, result, kind)}, player.AccessToken)
					if w.Code != 400 {
						t.Fatalf("campaign %s after its inventory allowance was accepted: status %d", kind, w.Code)
					}
					assertToolPolicyUnchanged(t, h, before)
				})
			}
		})
	}
}

func TestToolPolicyInvalidOperationDoesNotSpendInventory(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-policy-invalid")
	grantToolPolicyStock(t, h, player, 4)
	for _, kind := range []string{"undo", "shovel"} {
		t.Run(kind, func(t *testing.T) {
			session := startToolPolicySession(t, h, player, "campaign", "classic", "invalid-"+kind)
			result := game.EventResult{State: session.State}
			for remaining := session.State.Tools[kind]; remaining > 0; remaining-- {
				result = sendToolPolicyActions(t, h, player, session.ID, toolPolicyActions(t, result, kind))
			}
			before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
			// Undo has no history and shovel has no tray after their valid uses.
			w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []game.Action{{Seq: int(result.LastSeq) + 1, Type: kind, At: 1000}}}, player.AccessToken)
			if w.Code != 400 {
				t.Fatal("invalid tool operation was accepted", w.Body.String())
			}
			assertToolPolicyUnchanged(t, h, before)
		})
	}
	t.Run("batch rollback", func(t *testing.T) {
		session := startToolPolicySession(t, h, player, "campaign", "classic", "invalid-batch")
		result := game.EventResult{State: session.State}
		result = sendToolPolicyActions(t, h, player, session.ID, toolPolicyActions(t, result, "shuffle"))
		before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
		actions := []game.Action{{Seq: 2, Type: "shuffle", At: 200}, {Seq: 3, Type: "pick", TileID: -1, At: 300}}
		w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": actions}, player.AccessToken)
		if w.Code != 400 {
			t.Fatal("batch containing an invalid pick was accepted", w.Body.String())
		}
		assertToolPolicyUnchanged(t, h, before)
	})
}

func TestToolPolicyStandardBatchExhaustionRollsBackFreeUse(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-policy-standard-batch")
	grantToolPolicyStock(t, h, player, 4)
	session := startToolPolicySession(t, h, player, "standard", "classic", "free-batch")
	before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
	actions := []game.Action{{Seq: 1, Type: "shuffle", At: 100}, {Seq: 2, Type: "shuffle", At: 200}}
	w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": actions}, player.AccessToken)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "免费") {
		t.Fatal("batch exceeded the session's free allowance", w.Body.String())
	}
	assertToolPolicyUnchanged(t, h, before)
}

func TestToolPolicyNextLevelResetsFreeAllowanceWithoutRefillingInventory(t *testing.T) {
	h := setup(t)
	for _, entry := range []string{"standard", "campaign"} {
		t.Run(entry, func(t *testing.T) {
			player := login(t, h, "qa-policy-next-"+entry)
			grantToolPolicyStock(t, h, player, 4)
			session := startToolPolicySession(t, h, player, entry, "classic", "next-"+entry)
			result := game.EventResult{State: session.State}
			uses := session.State.Tools["undo"]
			if entry == "campaign" {
				uses += 1
			}
			for i := 0; i < uses; i++ {
				result = sendToolPolicyActions(t, h, player, session.ID, toolPolicyActions(t, result, "undo"))
			}
			bag := result.Assets.Bag
			_, route, err := game.NewBoard(game.DefaultConfig("classic", 1), uint32(session.Seed))
			if err != nil {
				t.Fatal(err)
			}
			actions := []game.Action{}
			for i, tileID := range route {
				seq := int(result.LastSeq) + i + 1
				actions = append(actions, game.Action{Seq: seq, Type: "pick", TileID: tileID, At: int64(seq * 100)})
			}
			result = sendToolPolicyActions(t, h, player, session.ID, actions)
			if result.State.Status != "won" {
				t.Fatal("fixture did not complete the first level")
			}
			next := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{
				Entry: entry, Mode: "classic", PreviousSessionID: session.ID, RequestID: "qa-policy-next-level-" + entry,
			}, player.AccessToken), 200)
			assets := decode[game.Assets](t, h.call("GET", "/api/v1/user/assets", nil, player.AccessToken), 200)
			if next.Ordinal != 2 || !reflect.DeepEqual(next.State.Tools, game.DefaultConfig("classic", 2).FreeTools) || !reflect.DeepEqual(assets.Bag, bag) {
				t.Fatal("next level did not reset free allowances while preserving inventory")
			}
		})
	}
}

func TestToolPolicyStandardZeroFreeAllowanceRejectsImmediately(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-policy-zero-free")
	assets := grantToolPolicyStock(t, h, player, 4)
	levels := decode[[]catalogLevel](t, h.call("GET", "/api/v1/admin/levels", nil, "admin"), 200)
	for _, level := range levels {
		if level.ID != "standard-classic-1" {
			continue
		}
		for _, kind := range game.Tools {
			level.Config.FreeTools[kind] = 0
		}
		body := catalogDraft("standard", "classic", 1, level.Config)
		body["draftVersion"] = level.DraftVersion
		draft := decode[catalogLevel](t, h.call("PUT", "/api/v1/admin/levels/"+level.ID, body, "admin"), 200)
		publishCatalogLevel(t, h, draft)
	}
	for _, kind := range game.Tools {
		if kind == "hint" {
			continue
		}
		t.Run(kind, func(t *testing.T) {
			session := startToolPolicySession(t, h, player, "standard", "classic", "zero-"+kind)
			if session.State.Tools[kind] != 0 {
				t.Fatal("fixture did not publish a zero free allowance")
			}
			before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
			result := game.EventResult{State: session.State, Assets: assets}
			w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": toolPolicyActions(t, result, kind)}, player.AccessToken)
			if w.Code != 400 || !strings.Contains(w.Body.String(), "免费") {
				t.Fatalf("standard %s with no free allowance was not rejected by policy: status %d", kind, w.Code)
			}
			assertToolPolicyUnchanged(t, h, before)
			// Policy takes precedence even when undo/shovel have no valid target.
			w = h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []game.Action{{Seq: 1, Type: kind}}}, player.AccessToken)
			if w.Code != 400 || !strings.Contains(w.Body.String(), "免费") {
				t.Fatal("free allowance was checked after the tool operation", w.Body.String())
			}
			assertToolPolicyUnchanged(t, h, before)
			w = h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []game.Action{{Seq: 1, Type: "unknown"}}}, player.AccessToken)
			if w.Code != 400 || !strings.Contains(w.Body.String(), "未知道具") {
				t.Fatal("unknown tool lost its validation error", w.Body.String())
			}
			assertToolPolicyUnchanged(t, h, before)
		})
	}
	t.Run("unlock_slot", func(t *testing.T) {
		session := startToolPolicySession(t, h, player, "standard", "classic", "zero-unlock-slot")
		before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
		actions := []game.Action{{Seq: 1, Type: "unlock_slot", At: 100}}
		result := sendToolPolicyActions(t, h, player, session.ID, actions)
		after := snapshotToolPolicy(t, h, player.User.ID, session.ID)
		if result.State.Capacity != 8 || !reflect.DeepEqual(result.State.Tools, session.State.Tools) || !reflect.DeepEqual(result.Assets, assets) || !reflect.DeepEqual(after.ledger, before.ledger) {
			t.Fatal("zero free tools prevented or charged for the independent extra-slot action")
		}
	})
}

func TestToolPolicyShareGrantsOneUse(t *testing.T) {
	h := setup(t)
	for _, entry := range []string{"standard", "campaign"} {
		t.Run(entry, func(t *testing.T) {
			player := login(t, h, "qa-share-"+entry)
			grantToolPolicyStock(t, h, player, 4)
			session := startToolPolicySession(t, h, player, entry, "classic", "share-"+entry)
			result := game.EventResult{State: session.State}
			uses := session.State.Tools["undo"]
			if entry == "campaign" {
				uses++
			}
			for i := 0; i < uses; i++ {
				result = sendToolPolicyActions(t, h, player, session.ID, toolPolicyActions(t, result, "undo"))
			}
			seq := int(result.LastSeq) + 1
			share := map[string]any{"seq": seq, "type": "share_tool", "tool": "undo", "at": seq * 100}
			result = decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []any{share}}, player.AccessToken), 200)
			bag := result.Assets.Bag["undo"]
			result = sendToolPolicyActions(t, h, player, session.ID, toolPolicyActions(t, result, "undo"))
			if result.Assets.Bag["undo"] != bag {
				t.Fatal("share use charged inventory")
			}
			before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
			w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": toolPolicyActions(t, result, "undo")}, player.AccessToken)
			if w.Code != 400 {
				t.Fatal("use after share allowance accepted", w.Body.String())
			}
			assertToolPolicyUnchanged(t, h, before)
			w = h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []any{map[string]any{"seq": int(result.LastSeq) + 1, "type": "share_tool", "tool": "undo", "at": int(result.LastSeq+1) * 100}}}, player.AccessToken)
			if w.Code != 400 {
				t.Fatal("second share accepted", w.Body.String())
			}
			assertToolPolicyUnchanged(t, h, before)
		})
	}
}
func TestToolPolicyLegacyRecoveryRestoresInventoryUse(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-policy-legacy")
	grantToolPolicyStock(t, h, player, 4)
	session := startToolPolicySession(t, h, player, "campaign", "classic", "legacy")
	result := game.EventResult{State: session.State}
	for i := 0; i < session.State.Tools["undo"]+1; i++ {
		result = sendToolPolicyActions(t, h, player, session.ID, toolPolicyActions(t, result, "undo"))
	}
	_, err := h.db.ExecContext(context.Background(), `UPDATE game_sessions SET state = state - 'bagUsed' - 'sharedTools' - 'shareUses' WHERE id = $1`, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := h.games.Recovery(context.Background(), player.User.ID, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !recovered.State.BagUsed["undo"] {
		t.Fatal("legacy recovery forgot prior inventory use")
	}
	before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
	w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": toolPolicyActions(t, result, "undo")}, player.AccessToken)
	if w.Code != 400 {
		t.Fatal("legacy session used inventory twice", w.Body.String())
	}
	assertToolPolicyUnchanged(t, h, before)
}
func TestToolPolicyShareRetryAndBatchRollback(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-share-retry")
	session := startToolPolicySession(t, h, player, "standard", "classic", "share-retry")
	result := game.EventResult{State: session.State}
	for i := 0; i < session.State.Tools["undo"]; i++ {
		result = sendToolPolicyActions(t, h, player, session.ID, toolPolicyActions(t, result, "undo"))
	}
	seq := int(result.LastSeq) + 1
	share := game.Action{Seq: seq, Type: "share_tool", Tool: "undo", At: int64(seq * 100)}
	before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
	batch := []game.Action{share, {Seq: seq + 1, Type: "pick", TileID: -1, At: int64((seq + 1) * 100)}}
	w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": batch}, player.AccessToken)
	if w.Code != 400 {
		t.Fatal("invalid batch accepted", w.Body.String())
	}
	assertToolPolicyUnchanged(t, h, before)
	result = sendToolPolicyActions(t, h, player, session.ID, []game.Action{share})
	if !result.State.SharedTools["undo"] || result.State.ShareUses["undo"] != 1 {
		t.Fatal("share allowance not granted")
	}
	after := snapshotToolPolicy(t, h, player.User.ID, session.ID)
	repeated := sendToolPolicyActions(t, h, player, session.ID, []game.Action{share})
	if !reflect.DeepEqual(repeated, result) {
		t.Fatal("retry changed share result")
	}
	postRetry := snapshotToolPolicy(t, h, player.User.ID, session.ID)
	if !reflect.DeepEqual(postRetry.events, after.events) || !reflect.DeepEqual(postRetry.ledger, after.ledger) || postRetry.session.LastSeq != after.session.LastSeq {
		t.Fatal("share retry changed events, assets, ledger, or sequence")
	}
	recovery, err := h.games.Recovery(context.Background(), player.User.ID, session.ID)
	if err != nil || !recovery.State.SharedTools["undo"] || recovery.State.ShareUses["undo"] != 1 {
		t.Fatal("share allowance did not survive recovery", err)
	}
	conflict := share
	conflict.Tool = "shuffle"
	w = h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []game.Action{conflict}}, player.AccessToken)
	if w.Code != 409 {
		t.Fatal("conflicting share retry accepted", w.Body.String())
	}
	assertToolPolicyUnchanged(t, h, postRetry)
}
