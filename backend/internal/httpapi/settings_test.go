package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"happy-pet/api/internal/config"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const initialAnnouncement = "三种玩法，一起开玩\n经典三消、极限四消、趣味规则消现已开放\n\n一口气，连闯两关\n从第一关直接开始，过关后自动进入第二关\n\n森林木作，新装登场\n十二生肖和猫、熊猫、狮子，变身木雕小伙伴\n\n四种道具，帮你过关\n撤回、铲出、提示和顺时针转动重排"

type announcementSettings struct {
	Announcement string    `json:"announcement"`
	Version      int32     `json:"version"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type publicAnnouncement struct {
	Content   string    `json:"content"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func TestAnnouncementReadSaveAndPersistence(t *testing.T) {
	h := setup(t)
	before := decode[announcementSettings](t, h.call(http.MethodGet, "/api/v1/admin/settings", nil, "admin"), http.StatusOK)
	if before.Announcement != initialAnnouncement || before.Version != 1 || before.UpdatedAt.IsZero() {
		t.Fatalf("unexpected initial announcement: %+v", before)
	}
	public := decode[publicAnnouncement](t, h.call(http.MethodGet, "/api/v1/settings/announcement", nil, ""), http.StatusOK)
	if public.Content != before.Announcement || !public.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("public announcement differs from saved settings: %+v", public)
	}
	content := "  新公告🐾\n\n保留空行\t与缩进 <b>这也是纯文字</b>  "
	saved := decode[announcementSettings](t, h.call(http.MethodPut, "/api/v1/admin/settings", map[string]any{
		"announcement": content, "version": before.Version,
	}, "admin"), http.StatusOK)
	if saved.Announcement != content || saved.Version != 2 || !saved.UpdatedAt.After(before.UpdatedAt) {
		t.Fatalf("unexpected saved announcement: %+v", saved)
	}
	var stored string
	var version int32
	var updatedAt time.Time
	if err := h.db.QueryRowContext(context.Background(), "SELECT value->>'content',version,updated_at FROM app_settings WHERE key='announcement'").Scan(&stored, &version, &updatedAt); err != nil || stored != content || version != saved.Version || !updatedAt.Equal(saved.UpdatedAt) {
		t.Fatal("announcement was not persisted", stored, version, updatedAt, err)
	}
	// Construct a new server over the same database to rule out process-local state.
	h.router = New(h.users, config.Config{AdminOrigin: "http://127.0.0.1:5173"}, nil)
	again := decode[announcementSettings](t, h.call(http.MethodGet, "/api/v1/admin/settings", nil, "admin"), http.StatusOK)
	public = decode[publicAnnouncement](t, h.call(http.MethodGet, "/api/v1/settings/announcement", nil, ""), http.StatusOK)
	if again != saved || public.Content != content || !public.UpdatedAt.Equal(saved.UpdatedAt) {
		t.Fatal("new server lost saved announcement", again, public)
	}
}

func TestAnnouncementPublicResponseIsWhitelist(t *testing.T) {
	h := setup(t)
	decode[publicAnnouncement](t, h.call(http.MethodGet, "/api/v1/settings/announcement", nil, ""), http.StatusOK)
	ctx := context.Background()
	if _, err := h.db.ExecContext(ctx, `INSERT INTO app_settings(key,value) VALUES('private_config','{"secret":"must-stay-private"}')`); err != nil {
		t.Fatal(err)
	}
	if _, err := h.db.ExecContext(ctx, `UPDATE app_settings SET value=value || '{"internalNote":"also-private"}'::jsonb WHERE key='announcement'`); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/settings/announcement", "/api/v1/settings/announcement?key=private_config"} {
		w := h.call(http.MethodGet, path, nil, "")
		body := decode[map[string]any](t, w, http.StatusOK)
		if len(body) != 2 || body["content"] != initialAnnouncement || body["updatedAt"] == nil || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("public settings must only expose the announcement DTO", body, w.Header())
		}
	}
	admin := decode[map[string]any](t, h.call(http.MethodGet, "/api/v1/admin/settings", nil, "admin"), http.StatusOK)
	if len(admin) != 3 || admin["announcement"] != initialAnnouncement || admin["version"] != float64(1) || admin["updatedAt"] == nil {
		t.Fatal("admin response exposed unrelated settings or storage fields", admin)
	}
	for _, path := range []string{"/api/v1/settings", "/api/v1/settings/private_config", "/api/v1/settings/announcement/private_config"} {
		if w := h.call(http.MethodGet, path, nil, ""); w.Code != http.StatusNotFound {
			t.Fatal("generic public settings endpoint exists", path, w.Code)
		}
	}
	if w := h.call(http.MethodPut, "/api/v1/settings/announcement", map[string]any{"content": "forged"}, ""); w.Code != http.StatusNotFound {
		t.Fatal("public endpoint accepts writes", w.Code)
	}
}

func TestAnnouncementAdminAuthorization(t *testing.T) {
	h := setup(t)
	player := login(t, h, "qa-settings-player")
	body := map[string]any{"announcement": "forged", "version": 1}
	for _, method := range []string{http.MethodGet, http.MethodPut} {
		for _, token := range []string{"", player.AccessToken} {
			if w := h.call(method, "/api/v1/admin/settings", body, token); w.Code != http.StatusUnauthorized {
				t.Fatal("unauthenticated or player request entered admin settings", method, w.Code, w.Body.String())
			}
		}
	}
	// Every request checks the independent administrator's current account state.
	if _, err := h.db.ExecContext(context.Background(), "UPDATE admin_accounts SET status='disabled' WHERE username='qa-admin'"); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodGet, http.MethodPut} {
		if w := h.call(method, "/api/v1/admin/settings", body, "admin"); w.Code != http.StatusUnauthorized {
			t.Fatal("disabled administrator retained settings access", method, w.Code, w.Body.String())
		}
	}
	public := decode[publicAnnouncement](t, h.call(http.MethodGet, "/api/v1/settings/announcement", nil, ""), http.StatusOK)
	if public.Content != initialAnnouncement {
		t.Fatal("rejected writes changed the announcement", public)
	}
}

func TestAnnouncementSaveChecksOrigin(t *testing.T) {
	h := setup(t)
	for _, headers := range []map[string]string{
		{"Origin": "https://untrusted.example"},
		{"Sec-Fetch-Site": "cross-site"},
		{"Origin": "http://127.0.0.1:5173", "Sec-Fetch-Site": "cross-site"},
	} {
		r := httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(`{"announcement":"forged","version":1}`))
		r.AddCookie(h.cookie)
		r.Header.Set("Content-Type", "application/json")
		for name, value := range headers {
			r.Header.Set(name, value)
		}
		w := httptest.NewRecorder()
		h.router.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "ORIGIN_REJECTED") {
			t.Fatal("cross-site save was accepted", headers, w.Code, w.Body.String())
		}
	}
	r := httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(`{"announcement":"trusted save","version":1}`))
	r.AddCookie(h.cookie)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://127.0.0.1:5173")
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	w := httptest.NewRecorder()
	h.router.ServeHTTP(w, r)
	saved := decode[announcementSettings](t, w, http.StatusOK)
	if saved.Announcement != "trusted save" || saved.Version != 2 {
		t.Fatal("origin-checked save failed", saved)
	}
}

func TestAnnouncementAcceptsEmptyAndUnicodeAndNormalizesLineEndings(t *testing.T) {
	h := setup(t)
	current := decode[announcementSettings](t, h.call(http.MethodGet, "/api/v1/admin/settings", nil, "admin"), http.StatusOK)
	for _, tc := range []struct {
		name, content, want string
	}{
		{"empty clears announcement", "", ""},
		{"CRLF and CR become LF", "  第一行\r\n\r\n第二行\r第三行\t  ", "  第一行\n\n第二行\n第三行\t  "},
		{"2000 supplementary code points", strings.Repeat("🐾", 2000), strings.Repeat("🐾", 2000)},
		{"2000 CJK code points", strings.Repeat("萌", 2000), strings.Repeat("萌", 2000)},
		{"normalized length at limit", strings.Repeat("\r\n", 2000), strings.Repeat("\n", 2000)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			saved := decode[announcementSettings](t, h.call(http.MethodPut, "/api/v1/admin/settings", map[string]any{
				"announcement": tc.content, "version": current.Version,
			}, "admin"), http.StatusOK)
			if saved.Announcement != tc.want || saved.Version != current.Version+1 || !saved.UpdatedAt.After(current.UpdatedAt) {
				t.Fatal("announcement was changed or not versioned", saved)
			}
			public := decode[publicAnnouncement](t, h.call(http.MethodGet, "/api/v1/settings/announcement", nil, ""), http.StatusOK)
			if public.Content != tc.want || !public.UpdatedAt.Equal(saved.UpdatedAt) {
				t.Fatal("public response did not reflect saved content", public)
			}
			current = saved
		})
	}
}

func TestAnnouncementRejectsInvalidInputWithoutChanges(t *testing.T) {
	h := setup(t)
	before := decode[announcementSettings](t, h.call(http.MethodGet, "/api/v1/admin/settings", nil, "admin"), http.StatusOK)
	tests := []struct {
		name string
		body any
	}{
		{"missing announcement", map[string]any{"version": 1}},
		{"null announcement", map[string]any{"announcement": nil, "version": 1}},
		{"numeric announcement", map[string]any{"announcement": 123, "version": 1}},
		{"boolean announcement", map[string]any{"announcement": false, "version": 1}},
		{"object announcement", map[string]any{"announcement": map[string]any{"content": "nested"}, "version": 1}},
		{"array announcement", map[string]any{"announcement": []string{"nested"}, "version": 1}},
		{"missing version", map[string]any{"announcement": "text"}},
		{"null version", map[string]any{"announcement": "text", "version": nil}},
		{"zero version", map[string]any{"announcement": "text", "version": 0}},
		{"negative version", map[string]any{"announcement": "text", "version": -1}},
		{"fractional version", map[string]any{"announcement": "text", "version": 1.5}},
		{"string version", map[string]any{"announcement": "text", "version": "1"}},
		{"boolean version", map[string]any{"announcement": "text", "version": true}},
		{"overflowed version", map[string]any{"announcement": "text", "version": int64(2147483648)}},
		{"unknown field", map[string]any{"announcement": "text", "version": 1, "private_config": "forged"}},
		{"null body", nil},
		{"array body", []any{}},
		{"string body", "text"},
		{"2001 ASCII code points", map[string]any{"announcement": strings.Repeat("x", 2001), "version": 1}},
		{"2001 CJK code points", map[string]any{"announcement": strings.Repeat("萌", 2001), "version": 1}},
		{"2001 supplementary code points", map[string]any{"announcement": strings.Repeat("🐾", 2001), "version": 1}},
	}
	for _, control := range []rune{'\x00', '\x01', '\b', '\v', '\f', '\x0e', '\x1f', '\x7f', '\u0085', '\u009f'} {
		tests = append(tests, struct {
			name string
			body any
		}{fmt.Sprintf("control U+%04X", control), map[string]any{"announcement": "before" + string(control) + "after", "version": 1}})
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := h.call(http.MethodPut, "/api/v1/admin/settings", tc.body, "admin")
			if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "INVALID_INPUT") {
				t.Fatal("invalid announcement input accepted", w.Code, w.Body.String())
			}
		})
	}
	for _, body := range []string{"", `{"announcement":"text","version":1`, `{"announcement":"text","version":1} {}`} {
		r := httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", strings.NewReader(body))
		r.AddCookie(h.cookie)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.router.ServeHTTP(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatal("malformed JSON accepted", body, w.Code, w.Body.String())
		}
	}
	after := decode[announcementSettings](t, h.call(http.MethodGet, "/api/v1/admin/settings", nil, "admin"), http.StatusOK)
	if after != before {
		t.Fatal("invalid saves changed settings", before, after)
	}
}

func TestAnnouncementVersionConflictsAndConcurrentSaves(t *testing.T) {
	h := setup(t)
	before := decode[announcementSettings](t, h.call(http.MethodGet, "/api/v1/admin/settings", nil, "admin"), http.StatusOK)
	const attempts = 8
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, attempts)
	var wg sync.WaitGroup
	for i := range attempts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results <- h.call(http.MethodPut, "/api/v1/admin/settings", map[string]any{
				"announcement": fmt.Sprintf("concurrent save %d", i), "version": before.Version,
			}, "admin")
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	var winner announcementSettings
	successes, conflicts := 0, 0
	for w := range results {
		switch w.Code {
		case http.StatusOK:
			successes++
			winner = decode[announcementSettings](t, w, http.StatusOK)
		case http.StatusConflict:
			conflicts++
			var failure struct {
				Error struct{ Code string } `json:"error"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &failure); err != nil || failure.Error.Code != "CONFLICT" {
				t.Fatal("conflict response is not actionable", w.Body.String(), err)
			}
		default:
			t.Fatal("unexpected concurrent save response", w.Code, w.Body.String())
		}
	}
	if successes != 1 || conflicts != attempts-1 || winner.Version != before.Version+1 {
		t.Fatal("concurrent writers overwrote each other", successes, conflicts, winner)
	}
	for _, version := range []int32{before.Version, winner.Version + 1} {
		if w := h.call(http.MethodPut, "/api/v1/admin/settings", map[string]any{"announcement": "stale save", "version": version}, "admin"); w.Code != http.StatusConflict {
			t.Fatal("mismatched version accepted", version, w.Code, w.Body.String())
		}
	}
	after := decode[announcementSettings](t, h.call(http.MethodGet, "/api/v1/admin/settings", nil, "admin"), http.StatusOK)
	if after != winner {
		t.Fatal("conflicts changed the successful save", winner, after)
	}
}
