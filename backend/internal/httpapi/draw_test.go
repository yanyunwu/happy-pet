package httpapi

import (
	"reflect"
	"testing"

	"happy-pet/api/internal/game"
)

func TestDrawUsesHintAllowanceAndIsIdempotent(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-draw-policy")
	assets := grantToolPolicyStock(t, h, player, 3)
	session := startToolPolicySession(t, h, player, "campaign", "classic", "draw-policy")
	state := session.State
	for seq := 1; seq <= 4; seq++ {
		events := []game.Action{{Seq: seq, Type: "draw", At: int64(seq * 100)}}
		result := sendToolPolicyActions(t, h, player, session.ID, events)
		selected := -1
		for i, tile := range state.Tiles {
			if !tile.Removed && result.State.Tiles[i].Removed {
				if selected >= 0 {
					t.Fatal("draw removed more than one tile")
				}
				selected = tile.ID
			}
		}
		if selected < 0 || state.Open(selected) {
			t.Fatalf("draw did not take a covered tile: %d", selected)
		}
		if result.State.Tools["hint"] != max(3-seq, 0) {
			t.Fatal("draw did not consume the hint free allowance", result.State.Tools)
		}
		if seq == 4 {
			assets.Bag["hint"]--
		}
		if !reflect.DeepEqual(result.Assets, assets) {
			t.Fatal("draw charged the wrong inventory", result.Assets, assets)
		}
		retry := sendToolPolicyActions(t, h, player, session.ID, events)
		if !reflect.DeepEqual(retry.State, result.State) || !reflect.DeepEqual(retry.Assets, result.Assets) {
			t.Fatal("retry changed draw result or charged twice")
		}
		state = result.State
	}
}

func TestDrawWithNoCoveredTilesDoesNotConsumeAllowance(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-draw-unavailable")
	grantToolPolicyStock(t, h, player, 1)
	session := startToolPolicySession(t, h, player, "campaign", "fun", "draw-unavailable")
	before := snapshotToolPolicy(t, h, player.User.ID, session.ID)
	w := h.call("POST", "/api/v1/user/sessions/"+session.ID+"/events", map[string]any{
		"events": []game.Action{{Seq: 1, Type: "draw", At: 100}},
	}, player.AccessToken)
	if w.Code != 400 {
		t.Fatalf("unavailable draw returned status %d: %s", w.Code, w.Body.String())
	}
	assertToolPolicyUnchanged(t, h, before)
}
