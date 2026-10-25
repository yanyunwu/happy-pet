package users

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
	"happy-pet/api/internal/dbgen"
)

type Error struct {
	Status        int
	Code, Message string
}

func (e *Error) Error() string                    { return e.Message }
func fail(status int, code, message string) error { return &Error{status, code, message} }
func Invalid(message string) error                { return fail(400, "INVALID_INPUT", message) }

type Service struct {
	DB       *sql.DB
	Q        *dbgen.Queries
	Secret   []byte
	Wechat   WechatExchange
	ImageURL func(context.Context, string) (string, error)
}
type User struct {
	ID            string     `json:"id"`
	Username      string     `json:"username"`
	Nickname      string     `json:"nickname"`
	AvatarURL     string     `json:"avatarUrl"`
	AvatarMediaID string     `json:"avatarMediaId"`
	Role          string     `json:"role"`
	Status        string     `json:"status"`
	Source        string     `json:"source"`
	Remark        string     `json:"remark,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	LastLoginAt   *time.Time `json:"lastLoginAt"`
	DeletedAt     *time.Time `json:"deletedAt"`
}
type CreateInput struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
	Remark   string `json:"remark"`
}
type UpdateInput struct {
	Nickname string `json:"nickname"`
	Status   string `json:"status"`
	Remark   string `json:"remark"`
}
type ListInput struct {
	Q, Status, Source string
	Page, PageSize    int
}
type Page struct {
	Items    []User `json:"items"`
	Total    int64  `json:"total"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}
type Stats struct {
	Total    int64 `json:"total"`
	Wechat   int64 `json:"wechat"`
	Disabled int64 `json:"disabled"`
	Today    int64 `json:"today"`
}

func Open(ctx context.Context, databaseURL string) (*sql.DB, error) {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
func New(db *sql.DB, secret string, wechat WechatExchange) *Service {
	return &Service{DB: db, Q: dbgen.New(db), Secret: []byte(secret), Wechat: wechat}
}
func NewID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value[:])
}
func (s *Service) View(ctx context.Context, u dbgen.User, admin bool) (User, error) {
	v := User{ID: u.ID, Username: u.Username.String, Nickname: u.Nickname, Role: u.Role, Status: u.Status, Source: "manual", CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt}
	if u.WechatOpenid.Valid {
		v.Source = "wechat"
	}
	if !u.DeletedAt.Valid {
		v.AvatarURL = u.AvatarUrl
	}
	if u.AvatarMediaID.Valid && !u.DeletedAt.Valid {
		v.AvatarMediaID = u.AvatarMediaID.String
		if v.AvatarURL == "" && s.ImageURL != nil {
			address, err := s.ImageURL(ctx, u.AvatarMediaID.String)
			if err != nil {
				return User{}, err
			}
			v.AvatarURL = address
		}
	}
	if u.LastLoginAt.Valid {
		v.LastLoginAt = &u.LastLoginAt.Time
	}
	if u.DeletedAt.Valid {
		v.DeletedAt = &u.DeletedAt.Time
	}
	if admin {
		v.Remark = u.Remark
	}
	return v, nil
}
func NormalizeNickname(value string) (string, error) {
	value = strings.TrimSpace(value)
	if n := utf8.RuneCountInString(value); n < 1 || n > 32 {
		return "", Invalid("昵称需为 1–32 个字符")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return "", Invalid("昵称不能包含控制字符")
		}
	}
	return value, nil
}
func passwordHash(password string) (string, error) {
	if len(password) < 10 || len(password) > 72 {
		return "", Invalid("密码需为 10–72 个字节")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,32}$`)

func (s *Service) Create(ctx context.Context, input CreateInput) (User, error) {
	input.Username = strings.ToLower(strings.TrimSpace(input.Username))
	if !usernamePattern.MatchString(input.Username) {
		return User{}, Invalid("账号需为 3–32 位字母、数字、下划线、点或横线")
	}
	nickname, err := NormalizeNickname(input.Nickname)
	if err != nil {
		return User{}, err
	}
	if utf8.RuneCountInString(input.Remark) > 500 {
		return User{}, Invalid("备注不能超过 500 字")
	}
	hash, err := passwordHash(input.Password)
	if err != nil {
		return User{}, err
	}
	u, err := s.Q.CreateUser(ctx, dbgen.CreateUserParams{ID: NewID(), Username: sql.NullString{String: input.Username, Valid: true}, PasswordHash: hash, Nickname: nickname, Role: "user", Status: "active", Remark: input.Remark})
	if err != nil {
		return User{}, classify(err)
	}
	return s.View(ctx, u, true)
}
func classify(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return fail(404, "NOT_FOUND", "用户不存在")
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		return fail(409, "CONFLICT", "这个账号已经存在")
	}
	return err
}
func (s *Service) List(ctx context.Context, input ListInput) (Page, error) {
	if input.Page < 1 {
		input.Page = 1
	}
	if input.PageSize < 1 {
		input.PageSize = 20
	}
	if input.PageSize > 100 {
		input.PageSize = 100
	}
	if input.Page > 100000 || utf8.RuneCountInString(input.Q) > 100 {
		return Page{}, Invalid("查询范围过大")
	}
	if input.Status != "" && input.Status != "active" && input.Status != "disabled" && input.Status != "deleted" {
		return Page{}, Invalid("无效状态")
	}
	if input.Source != "" && input.Source != "wechat" && input.Source != "manual" {
		return Page{}, Invalid("无效来源")
	}
	params := dbgen.CountUsersParams{Q: strings.TrimSpace(input.Q), Status: input.Status, Source: input.Source, IncludeDeleted: input.Status == "deleted"}
	// A repeatable-read transaction keeps the count and page from disagreeing during writes.
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return Page{}, err
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	count, err := q.CountUsers(ctx, params)
	if err != nil {
		return Page{}, err
	}
	rows, err := q.ListUsers(ctx, dbgen.ListUsersParams{IncludeDeleted: params.IncludeDeleted, Q: params.Q, Status: params.Status, Source: params.Source, PageLimit: int32(input.PageSize), PageOffset: int32((input.Page - 1) * input.PageSize)})
	if err != nil {
		return Page{}, err
	}
	result := Page{Items: make([]User, 0, len(rows)), Total: count, Page: input.Page, PageSize: input.PageSize}
	for _, u := range rows {
		item, e := s.View(ctx, u, true)
		if e != nil {
			return Page{}, e
		}
		result.Items = append(result.Items, item)
	}
	return result, tx.Commit()
}
func (s *Service) Stats(ctx context.Context) (Stats, error) {
	row, err := s.Q.UserStats(ctx)
	return Stats{row.Total, row.Wechat, row.Disabled, row.Today}, err
}
func (s *Service) Get(ctx context.Context, id string) (User, error) {
	u, err := s.Q.GetUser(ctx, id)
	if err != nil {
		return User{}, classify(err)
	}
	return s.View(ctx, u, true)
}

func (s *Service) mutate(ctx context.Context, id string, fn func(*dbgen.Queries, dbgen.User) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	if err = q.LockUserAdministration(ctx); err != nil {
		return err
	}
	user, err := q.GetUser(ctx, id)
	if err != nil {
		return classify(err)
	}
	if err = fn(q, user); err != nil {
		return classify(err)
	}
	return tx.Commit()
}
func (s *Service) Update(ctx context.Context, id string, input UpdateInput) (User, error) {
	nickname, err := NormalizeNickname(input.Nickname)
	if err != nil {
		return User{}, err
	}
	if input.Status != "active" && input.Status != "disabled" {
		return User{}, Invalid("无效状态")
	}
	if utf8.RuneCountInString(input.Remark) > 500 {
		return User{}, Invalid("备注不能超过 500 字")
	}
	var updated dbgen.User
	err = s.mutate(ctx, id, func(q *dbgen.Queries, previous dbgen.User) error {
		var e error
		updated, e = q.UpdateUser(ctx, dbgen.UpdateUserParams{ID: id, Nickname: nickname, Status: input.Status, Remark: input.Remark})
		if e == nil && previous.Status != input.Status {
			return q.RevokeSessions(ctx, id)
		}
		return e
	})
	if err != nil {
		return User{}, err
	}
	return s.View(ctx, updated, true)
}
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.mutate(ctx, id, func(q *dbgen.Queries, u dbgen.User) error {
		if u.DeletedAt.Valid {
			return fail(404, "NOT_FOUND", "用户已在回收站")
		}
		if err := q.DeleteUser(ctx, id); err != nil {
			return err
		}
		return q.RevokeSessions(ctx, id)
	})
}
func (s *Service) Restore(ctx context.Context, id string) (User, error) {
	var u dbgen.User
	err := s.mutate(ctx, id, func(q *dbgen.Queries, _ dbgen.User) error {
		var e error
		u, e = q.RestoreUser(ctx, id)
		if e != nil {
			return e
		}
		return q.RevokeSessions(ctx, id)
	})
	if err != nil {
		return User{}, err
	}
	return s.View(ctx, u, true)
}
func (s *Service) ResetPassword(ctx context.Context, id, password string) error {
	hash, err := passwordHash(password)
	if err != nil {
		return err
	}
	return s.mutate(ctx, id, func(q *dbgen.Queries, u dbgen.User) error {
		if !u.Username.Valid || u.DeletedAt.Valid {
			return Invalid("该用户没有可用的密码账号")
		}
		if err := q.UpdatePassword(ctx, dbgen.UpdatePasswordParams{ID: id, PasswordHash: hash}); err != nil {
			return err
		}
		return q.RevokeSessions(ctx, id)
	})
}
