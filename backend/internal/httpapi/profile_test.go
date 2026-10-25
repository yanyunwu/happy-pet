package httpapi

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"happy-pet/api/internal/users"
)

func TestPlayerProfilePersistsAcrossLoginAndAdminViews(t *testing.T) {
	for _, method := range []string{http.MethodPatch, http.MethodPut} {
		t.Run(method, func(t *testing.T) {
			h := setup(t)
			a := login(t, h, "qa-profile-a")
			b := login(t, h, "qa-profile-b")
			if _, err := h.db.ExecContext(context.Background(), "UPDATE users SET remark='private admin note' WHERE id=$1", a.User.ID); err != nil {
				t.Fatal(err)
			}
			avatar := "https://thirdwx.qlogo.cn/mmopen/player-a/132?source=wechat"
			updated := decode[users.User](t, h.call(method, "/api/v1/user/me", map[string]any{
				"nickname": "  小桔🐾  ", "avatarUrl": "http://ThirdWx.QLogo.CN/mmopen/player-a/132?source=wechat",
			}, a.AccessToken), http.StatusOK)
			if updated.ID != a.User.ID || updated.Nickname != "小桔🐾" || updated.AvatarURL != avatar || updated.AvatarMediaID != "" || updated.Role != "user" || updated.Status != "active" || updated.Source != "wechat" || updated.Remark != "" || updated.CreatedAt.IsZero() || updated.UpdatedAt.IsZero() || updated.LastLoginAt == nil {
				t.Fatalf("unexpected full profile: %+v", updated)
			}
			var persistedNickname, persistedAvatar string
			if err := h.db.QueryRowContext(context.Background(), "SELECT nickname,avatar_url FROM users WHERE id=$1", a.User.ID).Scan(&persistedNickname, &persistedAvatar); err != nil || persistedNickname != updated.Nickname || persistedAvatar != avatar {
				t.Fatal("profile was not stored", persistedNickname, persistedAvatar, err)
			}
			me := decode[users.User](t, h.call(http.MethodGet, "/api/v1/user/me", nil, a.AccessToken), http.StatusOK)
			again := login(t, h, "qa-profile-a")
			for _, profile := range []users.User{me, again.User} {
				if profile.ID != a.User.ID || profile.Nickname != updated.Nickname || profile.AvatarURL != avatar || profile.Remark != "" {
					t.Fatal("read or login lost the profile", profile)
				}
			}
			other := decode[users.User](t, h.call(http.MethodGet, "/api/v1/user/me", nil, b.AccessToken), http.StatusOK)
			if other.Nickname != b.User.Nickname || other.AvatarURL != b.User.AvatarURL {
				t.Fatal("another player's profile changed", other)
			}
			adminView := decode[users.User](t, h.call(http.MethodGet, "/api/v1/admin/users/"+a.User.ID, nil, "admin"), http.StatusOK)
			page := decode[users.Page](t, h.call(http.MethodGet, "/api/v1/admin/users?q="+a.User.ID, nil, "admin"), http.StatusOK)
			if adminView.Nickname != updated.Nickname || adminView.AvatarURL != avatar || adminView.Remark != "private admin note" || len(page.Items) != 1 || page.Items[0].AvatarURL != avatar || page.Items[0].Nickname != updated.Nickname {
				t.Fatal("admin views lost the profile", adminView, page)
			}
		})
	}
}

func TestPlayerProfilePreservesAndReplacesLegacyAvatar(t *testing.T) {
	for _, method := range []string{http.MethodPatch, http.MethodPut} {
		t.Run(method, func(t *testing.T) {
			h := setup(t)
			a := login(t, h, "qa-profile-legacy")
			ctx := context.Background()
			if _, err := h.db.ExecContext(ctx, "UPDATE users SET avatar_media_id='legacy-avatar' WHERE id=$1", a.User.ID); err != nil {
				t.Fatal(err)
			}
			legacyURL := "https://legacy.example.test/avatar.png"
			mediaCalls := 0
			h.users.ImageURL = func(_ context.Context, id string) (string, error) {
				mediaCalls++
				if id != "legacy-avatar" {
					return "", fmt.Errorf("unexpected media ID %s", id)
				}
				return legacyURL, nil
			}
			updated := decode[users.User](t, h.call(method, "/api/v1/user/me", map[string]string{"nickname": "保留旧头像"}, a.AccessToken), http.StatusOK)
			if updated.AvatarURL != legacyURL || updated.AvatarMediaID != "legacy-avatar" || mediaCalls != 1 {
				t.Fatal("omitting the avatar lost legacy media", updated, mediaCalls)
			}
			avatar := "https://wx.qpic.cn/avatar/player/132"
			updated = decode[users.User](t, h.call(method, "/api/v1/user/me", map[string]string{"nickname": "新微信头像", "avatarUrl": avatar}, a.AccessToken), http.StatusOK)
			if updated.AvatarURL != avatar || updated.AvatarMediaID != "" || mediaCalls != 1 {
				t.Fatal("replacement did not detach legacy media", updated, mediaCalls)
			}
			updated = decode[users.User](t, h.call(method, "/api/v1/user/me", map[string]string{"nickname": "仅更新昵称"}, a.AccessToken), http.StatusOK)
			if updated.AvatarURL != avatar {
				t.Fatal("omitting the avatar lost the direct URL", updated)
			}
			// Legacy references may coexist after an upgrade; the direct URL must win.
			if _, err := h.db.ExecContext(ctx, "UPDATE users SET avatar_media_id='legacy-avatar' WHERE id=$1", a.User.ID); err != nil {
				t.Fatal(err)
			}
			me := decode[users.User](t, h.call(http.MethodGet, "/api/v1/user/me", nil, a.AccessToken), http.StatusOK)
			if me.AvatarURL != avatar || mediaCalls != 1 {
				t.Fatal("legacy media overrode a direct avatar", me, mediaCalls)
			}
			updated = decode[users.User](t, h.call(method, "/api/v1/user/me", map[string]string{"nickname": "清除头像", "avatarUrl": ""}, a.AccessToken), http.StatusOK)
			var direct string
			var media sql.NullString
			if err := h.db.QueryRowContext(ctx, "SELECT avatar_url,avatar_media_id FROM users WHERE id=$1", a.User.ID).Scan(&direct, &media); err != nil || direct != "" || media.Valid || updated.AvatarURL != "" || updated.AvatarMediaID != "" {
				t.Fatal("explicit clear retained an avatar", updated, direct, media, err)
			}
		})
	}
}

func TestPlayerProfileRequiresCurrentMiniappIdentity(t *testing.T) {
	for _, method := range []string{http.MethodPatch, http.MethodPut} {
		t.Run(method, func(t *testing.T) {
			h := setup(t)
			a := login(t, h, "qa-profile-auth-a")
			b := login(t, h, "qa-profile-auth-b")
			for _, token := range []string{"", "invalid", "admin", h.cookie.Value} {
				w := h.call(method, "/api/v1/user/me", map[string]string{"nickname": "未授权"}, token)
				if w.Code != http.StatusUnauthorized {
					t.Fatalf("unauthorized update returned %d: %s", w.Code, w.Body.String())
				}
			}
			for _, field := range []string{"id", "userId", "role", "status", "remark", "avatarMediaId", "wechatOpenid"} {
				t.Run(field, func(t *testing.T) {
					w := h.call(method, "/api/v1/user/me", map[string]string{"nickname": "不可越权", field: b.User.ID}, a.AccessToken)
					if w.Code != http.StatusBadRequest {
						t.Fatalf("unexpected field accepted: %d %s", w.Code, w.Body.String())
					}
				})
			}
			if w := h.call(method, "/api/v1/user/"+b.User.ID, map[string]string{"nickname": "其他人"}, a.AccessToken); w.Code != http.StatusNotFound {
				t.Fatal("unexpected route allows selecting another user", w.Code)
			}
			for _, session := range []users.Session{a, b} {
				profile := decode[users.User](t, h.call(http.MethodGet, "/api/v1/user/me", nil, session.AccessToken), http.StatusOK)
				if profile.Nickname != session.User.Nickname || profile.Role != "user" || profile.Status != "active" || profile.AvatarURL != "" {
					t.Fatal("rejected request modified a profile", profile)
				}
			}
		})
	}
}

func TestPlayerProfileValidatesNicknameAndWechatAvatar(t *testing.T) {
	for _, method := range []string{http.MethodPatch, http.MethodPut} {
		t.Run(method, func(t *testing.T) {
			h := setup(t)
			a := login(t, h, "qa-profile-validation")
			valid := []struct{ name, input, want string }{
				{"qlogo", "https://qlogo.cn/a/132", "https://qlogo.cn/a/132"},
				{"qpic", "https://qpic.cn/a/132", "https://qpic.cn/a/132"},
				{"subdomain", "https://wx.qpic.cn/a/132", "https://wx.qpic.cn/a/132"},
				{"legacy HTTP", "http://ThirdWx.QLogo.CN/mmopen/a/132", "https://thirdwx.qlogo.cn/mmopen/a/132"},
				{"maximum length", "https://qlogo.cn/" + strings.Repeat("a", 2048-len("https://qlogo.cn/")), "https://qlogo.cn/" + strings.Repeat("a", 2048-len("https://qlogo.cn/"))},
				{"explicit clear", "", ""},
			}
			for _, tc := range valid {
				t.Run(tc.name, func(t *testing.T) {
					profile := decode[users.User](t, h.call(method, "/api/v1/user/me", map[string]string{"nickname": "  " + strings.Repeat("🐾", 32) + "  ", "avatarUrl": tc.input}, a.AccessToken), http.StatusOK)
					if profile.AvatarURL != tc.want || profile.Nickname != strings.Repeat("🐾", 32) {
						t.Fatal("unexpected normalized profile", profile)
					}
				})
			}
			invalidAvatars := []any{
				"https://example.com/a.png", "https://qlogo.cn.evil.test/a", "https://evilqlogo.cn/a", "https://qpic.cn@evil.test/a",
				"https://user:pass@qlogo.cn/a", "https://user@qlogo.cn/a", "https://qlogo.cn:443/a", "https://qlogo.cn:8080/a", "https://qlogo.cn:/a",
				"https://qlogo.cn/a#fragment", "https://qlogo.cn/a#", "ftp://qlogo.cn/a", "javascript:alert(1)", "data:image/png;base64,abc",
				"wxfile://tmp/avatar.png", "blob:https://qlogo.cn/a", "/avatar.png", "//qlogo.cn/a", "https:qlogo.cn/a", "https:///a",
				"https://127.0.0.1/a", "https://[::1]/a", "https://qlogo.cn./a", "https://.qlogo.cn/a", "https://a..qlogo.cn/a", "https://-bad.qlogo.cn/a", "https://bad_.qlogo.cn/a",
				" https://qlogo.cn/a", "https://qlogo.cn/a ", "https://qlogo.cn/a\n", "https://qlogo.cn/a\t", "https://qlogo.cn/a\u0085", "https://qlogo.cn/a%0a", "https://qlogo.cn/a?x=%00", "https://qlogo.cn/a?x=%zz",
				"https://qlogo.cn/" + strings.Repeat("a", 2049), nil, 7, true, map[string]string{"url": "https://qlogo.cn/a"},
			}
			for i, avatar := range invalidAvatars {
				t.Run(fmt.Sprintf("invalid avatar %d", i), func(t *testing.T) {
					w := h.call(method, "/api/v1/user/me", map[string]any{"nickname": "不应保存", "avatarUrl": avatar}, a.AccessToken)
					if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "INVALID_INPUT") {
						t.Fatalf("invalid avatar accepted: %#v: %d %s", avatar, w.Code, w.Body.String())
					}
				})
			}
			for i, nickname := range []any{"", "   ", strings.Repeat("字", 33), "中\n间", "中\x00间", "中\u0085间", nil, 3, true} {
				t.Run(fmt.Sprintf("invalid nickname %d", i), func(t *testing.T) {
					w := h.call(method, "/api/v1/user/me", map[string]any{"nickname": nickname}, a.AccessToken)
					if w.Code != http.StatusBadRequest {
						t.Fatalf("invalid nickname accepted: %#v: %d %s", nickname, w.Code, w.Body.String())
					}
				})
			}
			if w := h.call(method, "/api/v1/user/me", map[string]string{"avatarUrl": "https://qlogo.cn/a"}, a.AccessToken); w.Code != http.StatusBadRequest {
				t.Fatal("missing nickname accepted", w.Code, w.Body.String())
			}
			profile := decode[users.User](t, h.call(http.MethodGet, "/api/v1/user/me", nil, a.AccessToken), http.StatusOK)
			if profile.Nickname != strings.Repeat("🐾", 32) || profile.AvatarURL != "" {
				t.Fatal("invalid input partially saved", profile)
			}
		})
	}
}

func TestPlayerProfileRejectsDisabledDeletedAndRevokedAccounts(t *testing.T) {
	for _, method := range []string{http.MethodPatch, http.MethodPut} {
		t.Run(method, func(t *testing.T) {
			h := setup(t)
			for _, state := range []string{"disabled", "deleted", "revoked"} {
				t.Run(state, func(t *testing.T) {
					a := login(t, h, "qa-profile-"+state)
					var err error
					switch state {
					case "disabled":
						_, err = h.users.Update(context.Background(), a.User.ID, users.UpdateInput{Nickname: a.User.Nickname, Status: "disabled"})
					case "deleted":
						err = h.users.Delete(context.Background(), a.User.ID)
					case "revoked":
						err = h.users.Logout(context.Background(), a.User.ID)
					}
					if err != nil {
						t.Fatal(err)
					}
					w := h.call(method, "/api/v1/user/me", map[string]string{"nickname": "不可更新", "avatarUrl": "https://qlogo.cn/a"}, a.AccessToken)
					if w.Code != http.StatusUnauthorized {
						t.Fatal("unusable session updated profile", w.Code, w.Body.String())
					}
					if state != "revoked" {
						w = h.call(http.MethodPost, "/api/v1/auth/wechat", map[string]string{"code": "qa-profile-" + state}, "")
						if w.Code != http.StatusForbidden {
							t.Fatal("unusable account logged in", w.Code, w.Body.String())
						}
					}
					var nickname string
					if err = h.db.QueryRowContext(context.Background(), "SELECT nickname FROM users WHERE id=$1", a.User.ID).Scan(&nickname); err != nil || nickname != a.User.Nickname {
						t.Fatal("rejected update changed account", nickname, err)
					}
				})
			}
		})
	}
}
