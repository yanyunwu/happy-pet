package users

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"happy-pet/api/internal/dbgen"
)

const SessionTTL = 7 * 24 * time.Hour

type Claims struct {
	Version int64 `json:"ver"`
	jwt.RegisteredClaims
}
type Session struct {
	AccessToken string    `json:"accessToken"`
	ExpiresAt   time.Time `json:"expiresAt"`
	User        User      `json:"user"`
}

func (s *Service) issue(ctx context.Context, user dbgen.User, audience string) (Session, error) {
	now := time.Now()
	expiry := now.Add(SessionTTL)
	claims := Claims{Version: user.SessionVersion, RegisteredClaims: jwt.RegisteredClaims{Issuer: "happy-pet", Subject: user.ID, Audience: jwt.ClaimStrings{audience}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(expiry)}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.Secret)
	if err != nil {
		return Session{}, err
	}
	profile, err := s.View(ctx, user, audience == "admin")
	if err != nil {
		return Session{}, err
	}
	return Session{token, expiry, profile}, nil
}
func (s *Service) Authenticate(ctx context.Context, token, audience string) (dbgen.User, error) {
	denied := fail(401, "UNAUTHORIZED", "登录已失效，请重新登录")
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(_ *jwt.Token) (any, error) { return s.Secret, nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("happy-pet"), jwt.WithAudience(audience), jwt.WithExpirationRequired())
	if err != nil || !parsed.Valid {
		return dbgen.User{}, denied
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok {
		return dbgen.User{}, denied
	}
	user, err := s.Q.GetUser(ctx, claims.Subject)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return dbgen.User{}, denied
		}
		return dbgen.User{}, err
	}
	if user.DeletedAt.Valid || user.Status != "active" || user.SessionVersion != claims.Version {
		return dbgen.User{}, denied
	}
	if audience == "admin" && user.Role != "admin" {
		return dbgen.User{}, fail(403, "FORBIDDEN", "这个账号没有管理权限")
	}
	return user, nil
}

var dummyPasswordHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-account-password"), bcrypt.DefaultCost)

func (s *Service) AdminLogin(ctx context.Context, username, password string) (Session, error) {
	denied := fail(401, "INVALID_CREDENTIALS", "账号或密码不正确")
	user, err := s.Q.GetUserByUsername(ctx, sql.NullString{String: strings.ToLower(strings.TrimSpace(username)), Valid: true})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
			return Session{}, denied
		}
		return Session{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return Session{}, denied
	}
	if user.DeletedAt.Valid || user.Status != "active" || user.Role != "admin" {
		return Session{}, fail(403, "ACCOUNT_DISABLED", "账号未启用或没有管理权限")
	}
	user, err = s.Q.TouchLogin(ctx, user.ID)
	if err != nil {
		return Session{}, err
	}
	return s.issue(ctx, user, "admin")
}
func (s *Service) WechatLogin(ctx context.Context, code string) (Session, error) {
	if strings.TrimSpace(code) == "" || len(code) > 256 {
		return Session{}, Invalid("缺少有效的微信登录凭证")
	}
	if s.Wechat == nil {
		return Session{}, fail(503, "WECHAT_UNAVAILABLE", "微信登录暂未配置完成")
	}
	identity, err := s.Wechat.Exchange(ctx, code)
	if err != nil {
		return Session{}, err
	}
	if identity.OpenID == "" {
		return Session{}, fail(502, "WECHAT_INVALID_RESPONSE", "微信登录未返回有效身份")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	if err = q.LockWechatRegistration(ctx, identity.OpenID); err != nil {
		return Session{}, err
	}
	user, err := q.GetUserByOpenID(ctx, sql.NullString{String: identity.OpenID, Valid: true})
	if errors.Is(err, sql.ErrNoRows) {
		user, err = q.CreateUser(ctx, dbgen.CreateUserParams{ID: NewID(), WechatOpenid: sql.NullString{String: identity.OpenID, Valid: true}, WechatUnionid: identity.UnionID, Nickname: "萌宠玩家", Role: "user", Status: "active"})
	}
	if err != nil {
		return Session{}, err
	}
	if user.Status != "active" || user.DeletedAt.Valid {
		return Session{}, fail(403, "ACCOUNT_DISABLED", "账号当前无法使用，请联系管理员")
	}
	user, err = q.TouchLogin(ctx, user.ID)
	if err != nil {
		return Session{}, err
	}
	if err = tx.Commit(); err != nil {
		return Session{}, err
	}
	return s.issue(ctx, user, "miniapp")
}
func (s *Service) Logout(ctx context.Context, id string) error { return s.Q.RevokeSessions(ctx, id) }
