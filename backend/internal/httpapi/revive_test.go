package httpapi

import (
	"context"
	"encoding/json"
	"testing"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/game"
)

func TestReviveSettledLossOnceAndRetry(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-revive-player")
	other := login(t, h, "qa-revive-other")
	session := startToolPolicySession(t, h, player, "campaign", "classic", "qa-revive-session")
	state, _, err := game.NewBoard(game.DefaultConfig("classic", 2), 17)
	if err != nil {
		t.Fatal(err)
	}
	for state.Status == "playing" {
		chosen, best := -1, 1000
		for _, tile := range state.Tiles {
			if !state.Open(tile.ID) {
				continue
			}
			count := 0
			for _, id := range state.Tray {
				if state.Tiles[id].Kind == tile.Kind {
					count++
				}
			}
			if count < best {
				chosen, best = tile.ID, count
			}
		}
		if chosen < 0 {
			t.Fatal("no selectable tile")
		}
		if err = state.Pick(chosen); err != nil {
			t.Fatal(err)
		}
	}
	if state.Status != "lost" {
		t.Fatal("fixture did not lose")
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.db.Exec(`UPDATE game_sessions SET state=$2,status='lost',settled=true,ended_at=now() WHERE id=$1`, session.ID, encoded); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/user/sessions/" + session.ID
	action := game.Action{Seq: 1, Type: "revive", At: 100}
	body := map[string]any{"events": []game.Action{action}}
	if h.call("POST", path+"/events", body, "").Code != 401 {
		t.Fatal("anonymous revive accepted")
	}
	if h.call("POST", path+"/events", body, other.AccessToken).Code != 404 {
		t.Fatal("other player revived session")
	}
	result := decode[game.EventResult](t, h.call("POST", path+"/events", body, player.AccessToken), 200)
	if result.State.Status != "playing" || result.LastSeq != 1 {
		t.Fatalf("revive did not continue: %+v", result)
	}
	stateJSON, _ := json.Marshal(result.State)
	var fields map[string]any
	_ = json.Unmarshal(stateJSON, &fields)
	if fields["reviveUsed"] != true {
		t.Fatalf("revive flag absent: %s", stateJSON)
	}
	retry := decode[game.EventResult](t, h.call("POST", path+"/events", body, player.AccessToken), 200)
	if retry.LastSeq != 1 || retry.State.Status != "playing" {
		t.Fatal("retry did not return prior result")
	}
	row, err := dbgen.New(h.db).GetSession(context.Background(), session.ID)
	if err != nil || row.Settled || row.Status != "playing" || row.EndedAt.Valid {
		t.Fatalf("session was not reopened: %+v %v", row, err)
	}
	if _, err = h.db.Exec(`UPDATE game_sessions SET status='lost',settled=true,ended_at=now(),state=jsonb_set(state,'{status}','"lost"'::jsonb) WHERE id=$1`, session.ID); err != nil {
		t.Fatal(err)
	}
	if code := h.call("POST", path+"/events", map[string]any{"events": []game.Action{{Seq: 2, Type: "revive", At: 200}}}, player.AccessToken).Code; code != 400 {
		t.Fatalf("second revive accepted: %d", code)
	}
}

func TestReviveMayFollowLosingActionInSameBatch(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-revive-batch")
	session := startToolPolicySession(t, h, player, "campaign", "classic", "qa-revive-batch-session")
	state, _, err := game.NewBoard(game.DefaultConfig("classic", 2), 17)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.db.Exec(`UPDATE game_sessions SET state=$2 WHERE id=$1`, session.ID, encoded); err != nil {
		t.Fatal(err)
	}
	actions := []game.Action{}
	for state.Status == "playing" {
		chosen, best := -1, 1000
		for _, tile := range state.Tiles {
			if !state.Open(tile.ID) {
				continue
			}
			count := 0
			for _, id := range state.Tray {
				if state.Tiles[id].Kind == tile.Kind {
					count++
				}
			}
			if count < best {
				chosen, best = tile.ID, count
			}
		}
		if chosen < 0 {
			t.Fatal("no selectable tile")
		}
		if err = state.Pick(chosen); err != nil {
			t.Fatal(err)
		}
		actions = append(actions, game.Action{Seq: len(actions) + 1, Type: "pick", TileID: chosen})
	}
	if state.Status != "lost" || len(actions) >= 64 {
		t.Fatal("fixture did not lose within one batch")
	}
	actions = append(actions, game.Action{Seq: len(actions) + 1, Type: "revive"})
	path := "/api/v1/user/sessions/" + session.ID + "/events"
	body := map[string]any{"events": actions}
	result := decode[game.EventResult](t, h.call("POST", path, body, player.AccessToken), 200)
	if result.State.Status != "playing" || !result.State.ReviveUsed || result.LastSeq != int32(len(actions)) {
		t.Fatalf("batch did not revive: %+v", result)
	}
	retry := decode[game.EventResult](t, h.call("POST", path, body, player.AccessToken), 200)
	if retry.LastSeq != result.LastSeq || !retry.State.ReviveUsed {
		t.Fatal("batch retry changed result")
	}
	row, err := dbgen.New(h.db).GetSession(context.Background(), session.ID)
	if err != nil || row.Settled || row.Status != "playing" {
		t.Fatalf("batch unexpectedly settled: %+v %v", row, err)
	}
}
