package admins

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/users"
)

const SessionTTL = 7 * 24 * time.Hour
const sessionIssuer = "happy-pet-admin"
const sessionAudience = "admin-console"

type claims struct {
	Version int64 `json:"ver"`
	jwt.RegisteredClaims
}
type Session struct {
	AccessToken string
	ExpiresAt   time.Time
	Account     Account
}

var dummyPasswordHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-account-password"), bcrypt.DefaultCost)

func unauthorized() error { return fail(401, "UNAUTHORIZED", "登录已失效，请重新登录") }

func (s *Service) Login(ctx context.Context, username, password string) (Session, error) {
	denied := fail(401, "INVALID_CREDENTIALS", "账号或密码不正确")
	a, err := s.Q.GetAdminAccountByUsername(ctx, sql.NullString{String: strings.ToLower(strings.TrimSpace(username)), Valid: true})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
			return Session{}, denied
		}
		return Session{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(a.PasswordHash), []byte(password)) != nil {
		return Session{}, denied
	}
	if a.DeletedAt.Valid || a.Status != "active" {
		return Session{}, fail(403, "ACCOUNT_DISABLED", "管理员账号未启用")
	}
	// Re-read under the same lock as password resets before issuing a session.
	err = s.mutate(ctx, a.ID, func(q *dbgen.Queries, current dbgen.AdminAccount) error {
		if current.Status != "active" || current.DeletedAt.Valid || current.PasswordHash != a.PasswordHash {
			return denied
		}
		var e error
		a, e = q.TouchAdminLogin(ctx, a.ID)
		return e
	})
	if err != nil {
		return Session{}, err
	}
	now := time.Now()
	expiry := now.Add(SessionTTL)
	c := claims{Version: a.SessionVersion, RegisteredClaims: jwt.RegisteredClaims{Issuer: sessionIssuer, Subject: a.ID, Audience: jwt.ClaimStrings{sessionAudience}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(expiry)}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(s.Secret)
	return Session{AccessToken: token, ExpiresAt: expiry, Account: View(a)}, err
}
func (s *Service) AuthenticateSession(ctx context.Context, token string) (dbgen.AdminAccount, error) {
	parsed, err := jwt.ParseWithClaims(token, &claims{}, func(_ *jwt.Token) (any, error) { return s.Secret, nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(sessionIssuer), jwt.WithAudience(sessionAudience), jwt.WithExpirationRequired())
	if err != nil || !parsed.Valid {
		return dbgen.AdminAccount{}, unauthorized()
	}
	c, ok := parsed.Claims.(*claims)
	if !ok {
		return dbgen.AdminAccount{}, unauthorized()
	}
	a, err := s.Q.GetAdminAccount(ctx, c.Subject)
	if errors.Is(err, sql.ErrNoRows) {
		return dbgen.AdminAccount{}, unauthorized()
	}
	if err != nil {
		return dbgen.AdminAccount{}, err
	}
	if a.Status != "active" || a.DeletedAt.Valid || a.SessionVersion != c.Version {
		return dbgen.AdminAccount{}, unauthorized()
	}
	return a, nil
}
func tokenDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func (s *Service) AuthenticateAccessToken(ctx context.Context, token string) (dbgen.AdminAccount, error) {
	if !validAccessToken(token) {
		return dbgen.AdminAccount{}, unauthorized()
	}
	a, err := s.Q.GetAdminAccountByTokenHash(ctx, sql.NullString{String: tokenDigest(token), Valid: true})
	if errors.Is(err, sql.ErrNoRows) {
		return dbgen.AdminAccount{}, unauthorized()
	}
	return a, err
}
func (s *Service) Logout(ctx context.Context, id string) error {
	return s.Q.RevokeAdminSessions(ctx, id)
}
func (s *Service) ChangePassword(ctx context.Context, id, currentPassword, password string) error {
	hash, err := passwordHash(password)
	if err != nil {
		return err
	}
	return s.mutate(ctx, id, func(q *dbgen.Queries, a dbgen.AdminAccount) error {
		if a.Status != "active" || a.DeletedAt.Valid {
			return unauthorized()
		}
		if bcrypt.CompareHashAndPassword([]byte(a.PasswordHash), []byte(currentPassword)) != nil {
			return fail(401, "INVALID_CREDENTIALS", "当前密码不正确")
		}
		return q.UpdateAdminPassword(ctx, dbgen.UpdateAdminPasswordParams{ID: id, PasswordHash: hash})
	})
}

type TokenStatus struct {
	Configured bool       `json:"configured"`
	Hint       string     `json:"hint"`
	UpdatedAt  *time.Time `json:"updatedAt"`
}
type TokenResult struct {
	AccessToken string    `json:"accessToken"`
	Hint        string    `json:"hint"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func AccessTokenStatus(a dbgen.AdminAccount) TokenStatus {
	v := TokenStatus{Configured: a.AccessTokenHash.Valid, Hint: a.AccessTokenHint}
	if a.AccessTokenUpdatedAt.Valid {
		v.UpdatedAt = &a.AccessTokenUpdatedAt.Time
	}
	return v
}
func validAccessToken(value string) bool {
	if len(value) < 32 || len(value) > 128 {
		return false
	}
	for _, b := range []byte(value) {
		if b < 33 || b > 126 {
			return false
		}
	}
	return true
}
func (s *Service) SetAccessToken(ctx context.Context, principal dbgen.AdminAccount, value string) (TokenResult, error) {
	if value == "" {
		var raw [32]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return TokenResult{}, err
		}
		value = base64.RawURLEncoding.EncodeToString(raw[:])
	}
	if !validAccessToken(value) {
		return TokenResult{}, users.Invalid("访问令牌需为 32–128 个无空白的可打印 ASCII 字符")
	}
	hint := value[:4] + "…" + value[len(value)-4:]
	var updated dbgen.AdminAccount
	err := s.mutate(ctx, principal.ID, func(q *dbgen.Queries, a dbgen.AdminAccount) error {
		if a.DeletedAt.Valid || a.Status != "active" || a.SessionVersion != principal.SessionVersion || a.AccessTokenHash != principal.AccessTokenHash {
			return unauthorized()
		}
		var err error
		updated, err = q.SetAdminAccessToken(ctx, dbgen.SetAdminAccessTokenParams{ID: a.ID, AccessTokenHash: sql.NullString{String: tokenDigest(value), Valid: true}, AccessTokenHint: hint})
		return err
	})
	return TokenResult{AccessToken: value, Hint: hint, UpdatedAt: updated.AccessTokenUpdatedAt.Time}, err
}
func (s *Service) RevokeAccessToken(ctx context.Context, principal dbgen.AdminAccount) error {
	return s.mutate(ctx, principal.ID, func(q *dbgen.Queries, a dbgen.AdminAccount) error {
		if a.DeletedAt.Valid || a.Status != "active" || a.SessionVersion != principal.SessionVersion || a.AccessTokenHash != principal.AccessTokenHash {
			return unauthorized()
		}
		return q.RevokeAdminAccessToken(ctx, a.ID)
	})
}
