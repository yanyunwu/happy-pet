package httpapi

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/game"
)

func TestExtraSlotAuthenticatedEventLifecycle(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-extra-slot-player")
	other := login(t, h, "qa-extra-slot-other")
	start := game.StartInput{Mode: "classic", RequestID: "qa-extra-slot-start-0001"}
	session := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", start, player.AccessToken), 200)
	path := "/api/v1/user/sessions/" + session.ID
	before := decode[game.Assets](t, h.call("GET", "/api/v1/user/assets", nil, player.AccessToken), 200)
	unlock := game.Action{Seq: 1, Type: "unlock_slot", At: 100}
	batch := map[string]any{"events": []game.Action{unlock}}
	if h.call("POST", path+"/events", batch, "").Code != 401 {
		t.Fatal("anonymous unlock accepted")
	}
	if h.call("POST", path+"/events", batch, other.AccessToken).Code != 404 {
		t.Fatal("cross-player unlock accepted")
	}
	result := decode[game.EventResult](t, h.call("POST", path+"/events", batch, player.AccessToken), 200)
	if result.State.Capacity != 8 || result.LastSeq != 1 || result.State.Moves != 0 {
		t.Fatal("unlock did not add exactly one slot without a pick", result)
	}
	if !reflect.DeepEqual(result.Assets, before) || !reflect.DeepEqual(result.State.Tools, session.State.Tools) {
		t.Fatal("unlock charged inventory or granted unrelated assets", result)
	}
	retry := decode[game.EventResult](t, h.call("POST", path+"/events", batch, player.AccessToken), 200)
	if retry.State.Capacity != 8 || retry.LastSeq != 1 || !reflect.DeepEqual(retry.Assets, before) {
		t.Fatal("retry duplicated the reward", retry)
	}
	if h.call("POST", path+"/events", map[string]any{"events": []game.Action{{Seq: 1, Type: "hint", At: 100}}}, player.AccessToken).Code != 409 {
		t.Fatal("same sequence accepted a different action")
	}
	if h.call("POST", path+"/events", map[string]any{"events": []game.Action{{Seq: 2, Type: "unlock_slot", At: 200}}}, player.AccessToken).Code != 400 {
		t.Fatal("second unlock accepted")
	}
	restored := decode[game.SessionView](t, h.call("GET", path, nil, player.AccessToken), 200)
	if restored.State.Capacity != 8 || restored.LastSeq != 1 {
		t.Fatal("recovery lost the reward or committed the rejected event", restored)
	}
	row, err := dbgen.New(h.db).GetSession(context.Background(), session.ID)
	if err != nil {
		t.Fatal(err)
	}
	var persisted game.State
	if err = json.Unmarshal(row.State, &persisted); err != nil || persisted.Capacity != 8 {
		t.Fatal("persisted state lost the extra slot", persisted.Capacity, err)
	}
	_, route, err := game.NewBoard(game.DefaultConfig("classic", 1), uint32(session.Seed))
	if err != nil {
		t.Fatal(err)
	}
	// Undoing a pick restores its frame while leaving the session reward intact.
	actions := []game.Action{{Seq: 2, Type: "pick", TileID: route[0], At: 200}, {Seq: 3, Type: "undo", At: 300}}
	result = decode[game.EventResult](t, h.call("POST", path+"/events", map[string]any{"events": actions}, player.AccessToken), 200)
	if result.State.Capacity != 8 || result.State.Moves != 0 {
		t.Fatal("undo lost the extra slot", result)
	}
	actions = nil
	for i, id := range route {
		actions = append(actions, game.Action{Seq: i + 4, Type: "pick", TileID: id, At: int64(400 + i*100)})
	}
	result = decode[game.EventResult](t, h.call("POST", path+"/events", map[string]any{"events": actions}, player.AccessToken), 200)
	if result.State.Status != "won" || result.State.Capacity != 8 || result.Assets.Coins != before.Coins+10 {
		t.Fatal("unlocked round did not settle normally", result)
	}
	terminalRetry := decode[game.EventResult](t, h.call("POST", path+"/events", batch, player.AccessToken), 200)
	if terminalRetry.State.Capacity != 8 || !reflect.DeepEqual(terminalRetry.Assets, result.Assets) {
		t.Fatal("retry after settlement duplicated a reward", terminalRetry)
	}
	if h.call("POST", path+"/events", map[string]any{"events": []game.Action{{Seq: int(result.LastSeq) + 1, Type: "unlock_slot", At: 5000}}}, player.AccessToken).Code != 409 {
		t.Fatal("settled round accepted a new unlock")
	}
	next := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Mode: "classic", PreviousSessionID: session.ID, RequestID: "qa-extra-slot-next-00001"}, player.AccessToken), 200)
	if next.Ordinal != 2 || next.State.Capacity != 7 {
		t.Fatal("next level inherited the extra slot", next)
	}
	result = decode[game.EventResult](t, h.call("POST", "/api/v1/user/sessions/"+next.ID+"/events", batch, player.AccessToken), 200)
	if result.State.Capacity != 8 {
		t.Fatal("new level did not allow its own reward")
	}
	restarted := decode[game.SessionView](t, h.call("POST", "/api/v1/user/sessions", game.StartInput{Mode: "classic", RequestID: "qa-extra-slot-restart-001"}, other.AccessToken), 200)
	if restarted.State.Capacity != 7 {
		t.Fatal("fresh session did not start at seven slots")
	}
	decode[game.FinishResult](t, h.call("POST", "/api/v1/user/sessions/"+restarted.ID+"/finish", map[string]string{"outcome": "abandoned"}, other.AccessToken), 200)
	if h.call("POST", "/api/v1/user/sessions/"+restarted.ID+"/events", batch, other.AccessToken).Code != 409 {
		t.Fatal("abandoned round accepted an unused unlock")
	}
}
