package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"happy-pet/api/internal/game"
)

func TestLegacyHintHistoryRemovedAndActiveSessionContinues(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-delete-legacy-hint")
	session := startToolPolicySession(t, h, player, "campaign", "classic", "delete-legacy-hint")
	action := game.Action{Seq: 1, Type: "hint", At: 100}
	_, err := h.db.Exec(`UPDATE game_sessions SET last_seq=1, state=jsonb_set(state, '{tools,hint}', '2'::jsonb) WHERE id=$1`, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.db.Exec(`INSERT INTO game_events(session_id,seq,action,state) SELECT id,1,'{"seq":1,"type":"hint","at":100}',state FROM game_sessions WHERE id=$1`, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	sql, err := os.ReadFile("../../sql/migrations/006_remove_legacy_hint_events.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.db.ExecContext(context.Background(), string(sql)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := h.db.QueryRow(`SELECT count(*) FROM game_events WHERE session_id=$1`, session.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("old action remains: %d %v", count, err)
	}
	w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []game.Action{action}}, player.AccessToken)
	if w.Code != 409 {
		t.Fatalf("deleted retry must conflict: %d %s", w.Code, w.Body.String())
	}
	w = h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{"events": []game.Action{{Seq: 2, Type: "hint", At: 200}}}, player.AccessToken)
	if w.Code != 400 {
		t.Fatalf("new legacy action accepted: %d %s", w.Code, w.Body.String())
	}
	draw := sendToolPolicyActions(t, h, player, session.ID, []game.Action{{Seq: 2, Type: "draw", At: 200}})
	if draw.LastSeq != 2 || draw.State.Tools["hint"] != 1 {
		t.Fatalf("draw failed after deletion: %+v", draw)
	}
	replay := h.call("GET", "/api/v1/admin/sessions/"+session.ID+"/replay", nil, "admin")
	if replay.Code != 200 || strings.Contains(replay.Body.String(), `"type":"hint"`) {
		t.Fatalf("replay contains old action: %d %s", replay.Code, replay.Body.String())
	}
}

func TestLegacyHintCleanupPreservesOldInventoryPolicyAndLedger(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-delete-legacy-stock")
	session := startToolPolicySession(t, h, player, "campaign", "classic", "delete-stock-policy")
	grantToolPolicyStock(t, h, player, 3)
	_, err := h.db.Exec(`UPDATE game_sessions SET last_seq=4,state=state-'bagUsed' WHERE id=$1`, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	var oldHintLedgerIDs []int64
	for _, act := range []game.Action{{Seq: 1, Type: "hint", At: 1}, {Seq: 2, Type: "draw", At: 2}, {Seq: 3, Type: "undo", At: 3}, {Seq: 4, Type: "hint", At: 4}} {
		b, err := json.Marshal(act)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = h.db.Exec(`INSERT INTO game_events(session_id,seq,action,state) SELECT id,$2,$3,state FROM game_sessions WHERE id=$1`, session.ID, act.Seq, b); err != nil {
			t.Fatal(err)
		}
		asset := "hint"
		if act.Type == "undo" {
			asset = "undo"
		}
		var ledgerID int64
		if err = h.db.QueryRow(`INSERT INTO asset_ledger(user_id,request_key,asset,delta,balance,reason,actor_id) VALUES($1,$2,$3,-1,0,'对局使用道具',$1) RETURNING id`, player.User.ID, fmt.Sprintf("session:%s:%d", session.ID, act.Seq), asset).Scan(&ledgerID); err != nil {
			t.Fatal(err)
		}
		if act.Type == "hint" {
			oldHintLedgerIDs = append(oldHintLedgerIDs, ledgerID)
		}
	}
	var before string
	if err = h.db.QueryRow(`SELECT row_to_json(a)::text FROM player_assets a WHERE user_id=$1`, player.User.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../sql/migrations/006_remove_legacy_hint_events.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.db.Exec(string(migration)); err != nil {
		t.Fatal(err)
	}
	restored, err := h.games.Recovery(context.Background(), player.User.ID, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !restored.State.BagUsed["hint"] || !restored.State.BagUsed["undo"] || restored.LastSeq != 4 {
		t.Fatalf("lost tool policy: %+v", restored)
	}
	var after string
	if err = h.db.QueryRow(`SELECT row_to_json(a)::text FROM player_assets a WHERE user_id=$1`, player.User.ID).Scan(&after); err != nil || before != after {
		t.Fatalf("assets changed: %v", err)
	}
	var old, remaining, linked, ledgerCount int
	if err = h.db.QueryRow(`SELECT count(*) FILTER (WHERE action->>'type'='hint'),count(*) FROM game_events WHERE session_id=$1`, session.ID).Scan(&old, &remaining); err != nil || old != 0 || remaining != 2 {
		t.Fatalf("events: %d %d %v", old, remaining, err)
	}
	if err = h.db.QueryRow(`SELECT count(*) FROM asset_ledger WHERE user_id=$1 AND request_key IN ($2,$3)`, player.User.ID, fmt.Sprintf("session:%s:1", session.ID), fmt.Sprintf("session:%s:4", session.ID)).Scan(&linked); err != nil || linked != 0 {
		t.Fatalf("old ledger link remains: %d %v", linked, err)
	}
	if err = h.db.QueryRow(`SELECT count(*) FROM asset_ledger WHERE id IN ($1,$2)`, oldHintLedgerIDs[0], oldHintLedgerIDs[1]).Scan(&ledgerCount); err != nil || ledgerCount != 0 {
		t.Fatalf("legacy hint ledger rows remain: %d %v", ledgerCount, err)
	}
	if err = h.db.QueryRow(`SELECT count(*) FROM asset_ledger WHERE user_id=$1 AND request_key IN ($2,$3)`, player.User.ID, fmt.Sprintf("session:%s:2", session.ID), fmt.Sprintf("session:%s:3", session.ID)).Scan(&linked); err != nil || linked != 2 {
		t.Fatalf("other tool ledger links missing: %d %v", linked, err)
	}
	result := sendToolPolicyActions(t, h, player, session.ID, []game.Action{{Seq: 5, Type: "draw", At: 5}})
	if result.LastSeq != 5 {
		t.Fatal("session failed to resume", result.LastSeq)
	}
}
