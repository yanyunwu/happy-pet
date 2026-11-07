package httpapi

import (
	"context"
	"testing"
)

type campaignProgressResponse map[string]struct {
	Current   int `json:"current"`
	Position  int `json:"position"`
	Total     int `json:"total"`
	Completed int `json:"completed"`
}

func TestCampaignProgressUsesOnlyPlayableLevelsAndIsPlayerSpecific(t *testing.T) {
	h := setup(t)
	a := login(t, h, "qa-progress-a")
	b := login(t, h, "qa-progress-b")
	path := "/api/v1/user/campaign-progress"
	if response := h.call("GET", path, nil, ""); response.Code != 401 {
		t.Fatalf("anonymous progress request: %d", response.Code)
	}
	initial := decode[campaignProgressResponse](t, h.call("GET", path, nil, a.AccessToken), 200)
	for _, mode := range []string{"classic", "quartet", "fun"} {
		if got := initial[mode]; got.Total != 2 || got.Current != 1 || got.Position != 1 || got.Completed != 0 {
			t.Fatalf("initial %s progress: %+v", mode, got)
		}
	}
	session := startToolPolicySession(t, h, a, "campaign", "classic", "progress-classic")
	if _, err := h.db.ExecContext(context.Background(), `INSERT INTO level_clears(user_id,level_id,session_id) VALUES($1,$2,$3)`, a.User.ID, session.LevelID, session.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.db.ExecContext(context.Background(), `UPDATE levels SET ordinal=8 WHERE entry='campaign' AND mode='classic' AND ordinal=2`); err != nil {
		t.Fatal(err)
	}
	advanced := decode[campaignProgressResponse](t, h.call("GET", path, nil, a.AccessToken), 200)
	if got := advanced["classic"]; got.Total != 2 || got.Current != 8 || got.Position != 2 || got.Completed != 1 {
		t.Fatalf("advanced progress: %+v", got)
	}
	other := decode[campaignProgressResponse](t, h.call("GET", path, nil, b.AccessToken), 200)
	if got := other["classic"]; got.Current != 1 || got.Completed != 0 {
		t.Fatalf("different player inherited progress: %+v", got)
	}
	if _, err := h.db.ExecContext(context.Background(), `UPDATE levels SET enabled=false WHERE entry='campaign' AND mode='classic' AND ordinal=8`); err != nil {
		t.Fatal(err)
	}
	complete := decode[campaignProgressResponse](t, h.call("GET", path, nil, a.AccessToken), 200)
	if got := complete["classic"]; got.Total != 1 || got.Current != 1 || got.Completed != 1 {
		t.Fatalf("disabled level affected progress: %+v", got)
	}
	if _, err := h.db.ExecContext(context.Background(), `UPDATE levels SET enabled=false WHERE entry='campaign' AND mode='quartet'`); err != nil {
		t.Fatal(err)
	}
	empty := decode[campaignProgressResponse](t, h.call("GET", path, nil, a.AccessToken), 200)
	if got := empty["quartet"]; got.Total != 0 || got.Current != 0 || got.Completed != 0 {
		t.Fatalf("empty catalog progress: %+v", got)
	}
}
