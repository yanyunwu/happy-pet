package users

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"happy-pet/api/internal/dbgen"
)

type ProfileInput struct {
	Nickname string
	// nil preserves either avatar source; an explicit empty string clears both.
	AvatarURL *string
}

const maxWechatAvatarURLLength = 2048

var wechatImageHost = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?:qlogo|qpic)\.cn$`)

// Only store a public WeChat image URL. The server never downloads the image.
func normalizeWechatAvatarURL(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	invalid := Invalid("请使用有效的微信头像地址")
	if len(value) > maxWechatAvatarURLLength {
		return "", invalid
	}
	decoded, err := url.PathUnescape(value)
	if err != nil || !utf8.ValidString(decoded) || strings.IndexFunc(decoded, func(r rune) bool {
		return unicode.IsControl(r) || unicode.IsSpace(r) || r == '\\'
	}) >= 0 {
		return "", invalid
	}
	address, err := url.Parse(value)
	if err != nil || (address.Scheme != "http" && address.Scheme != "https") || address.Opaque != "" || address.User != nil || strings.Contains(value, "#") || strings.Contains(address.Host, ":") {
		return "", invalid
	}
	host := strings.ToLower(address.Host)
	if len(host) > 253 || !wechatImageHost.MatchString(host) {
		return "", invalid
	}
	// Legacy authorization callbacks may still return HTTP; clients load HTTPS.
	address.Scheme, address.Host = "https", host
	canonical := address.String()
	if len(canonical) > maxWechatAvatarURLLength {
		return "", invalid
	}
	return canonical, nil
}

func (s *Service) UpdateProfile(ctx context.Context, id string, input ProfileInput) (User, error) {
	nickname, err := NormalizeNickname(input.Nickname)
	if err != nil {
		return User{}, err
	}
	params := dbgen.UpdateProfileParams{ID: id, Nickname: nickname, UpdateAvatar: input.AvatarURL != nil}
	if input.AvatarURL != nil {
		params.AvatarUrl, err = normalizeWechatAvatarURL(*input.AvatarURL)
		if err != nil {
			return User{}, err
		}
	}
	updated, err := s.Q.UpdateProfile(ctx, params)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, fail(401, "UNAUTHORIZED", "登录已失效，请重新登录")
	}
	if err != nil {
		return User{}, err
	}
	return s.View(ctx, updated, false)
}
