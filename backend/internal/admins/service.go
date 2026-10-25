// Package admins manages administrator identities independently of game players.
package admins

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/users"
)

type Service struct {
	DB     *sql.DB
	Q      *dbgen.Queries
	Secret []byte
}

func New(db *sql.DB, secret string) *Service {
	return &Service{DB: db, Q: dbgen.New(db), Secret: []byte(secret)}
}

type Account struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	Nickname    string     `json:"nickname"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	Remark      string     `json:"remark"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	LastLoginAt *time.Time `json:"lastLoginAt"`
	DeletedAt   *time.Time `json:"deletedAt"`
}

func View(a dbgen.AdminAccount) Account {
	v := Account{ID: a.ID, Username: a.Username.String, Nickname: a.Nickname, Role: "admin", Status: a.Status, Remark: a.Remark, CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt}
	if a.LastLoginAt.Valid {
		v.LastLoginAt = &a.LastLoginAt.Time
	}
	if a.DeletedAt.Valid {
		v.DeletedAt = &a.DeletedAt.Time
	}
	return v
}

type CreateInput = users.CreateInput
type UpdateInput struct {
	Nickname *string `json:"nickname"`
	Status   *string `json:"status"`
	Remark   *string `json:"remark"`
}
type ListInput struct {
	Q, Status      string
	Page, PageSize int
}
type Page struct {
	Items    []Account `json:"items"`
	Total    int64     `json:"total"`
	Page     int       `json:"page"`
	PageSize int       `json:"pageSize"`
}

func fail(status int, code, message string) error {
	return &users.Error{Status: status, Code: code, Message: message}
}
func classify(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fail(404, "NOT_FOUND", "管理员不存在")
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return fail(409, "CONFLICT", "账号或访问令牌已被使用")
	}
	return err
}
func passwordHash(password string) (string, error) {
	if len(password) < 10 || len(password) > 72 {
		return "", users.Invalid("密码需为 10–72 个字节")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,32}$`)

func (s *Service) Create(ctx context.Context, input CreateInput) (Account, error) {
	input.Username = strings.ToLower(strings.TrimSpace(input.Username))
	if !usernamePattern.MatchString(input.Username) {
		return Account{}, users.Invalid("账号需为 3–32 位字母、数字、下划线、点或横线")
	}
	nickname, err := users.NormalizeNickname(input.Nickname)
	if err != nil {
		return Account{}, err
	}
	if utf8.RuneCountInString(input.Remark) > 500 {
		return Account{}, users.Invalid("备注不能超过 500 字")
	}
	hash, err := passwordHash(input.Password)
	if err != nil {
		return Account{}, err
	}
	a, err := s.Q.CreateAdminAccount(ctx, dbgen.CreateAdminAccountParams{ID: users.NewID(), Username: sql.NullString{String: input.Username, Valid: true}, PasswordHash: hash, Nickname: nickname, Remark: input.Remark})
	return View(a), classify(err)
}

func (s *Service) Get(ctx context.Context, id string) (Account, error) {
	a, err := s.Q.GetAdminAccount(ctx, id)
	return View(a), classify(err)
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
		return Page{}, users.Invalid("查询范围过大")
	}
	if input.Status != "" && input.Status != "active" && input.Status != "disabled" && input.Status != "deleted" {
		return Page{}, users.Invalid("无效状态")
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return Page{}, err
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	params := dbgen.CountAdminAccountsParams{Q: strings.TrimSpace(input.Q), Status: input.Status, IncludeDeleted: input.Status == "deleted"}
	count, err := q.CountAdminAccounts(ctx, params)
	if err != nil {
		return Page{}, err
	}
	rows, err := q.ListAdminAccounts(ctx, dbgen.ListAdminAccountsParams{Q: params.Q, Status: params.Status, IncludeDeleted: params.IncludeDeleted, PageLimit: int32(input.PageSize), PageOffset: int32((input.Page - 1) * input.PageSize)})
	if err != nil {
		return Page{}, err
	}
	page := Page{Items: make([]Account, 0, len(rows)), Total: count, Page: input.Page, PageSize: input.PageSize}
	for _, a := range rows {
		page.Items = append(page.Items, View(a))
	}
	return page, tx.Commit()
}

// All administrative mutations share one transaction lock, so two concurrent
// requests cannot both disable/delete the last active administrator.
func (s *Service) mutate(ctx context.Context, id string, fn func(*dbgen.Queries, dbgen.AdminAccount) error) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	if err = q.LockAdminAdministration(ctx); err != nil {
		return err
	}
	a, err := q.GetAdminAccount(ctx, id)
	if err != nil {
		return classify(err)
	}
	if err = fn(q, a); err != nil {
		return classify(err)
	}
	return tx.Commit()
}
func protectLast(ctx context.Context, q *dbgen.Queries, a dbgen.AdminAccount) error {
	if a.Status != "active" || a.DeletedAt.Valid {
		return nil
	}
	count, err := q.CountActiveAdminAccounts(ctx)
	if err != nil {
		return err
	}
	if count <= 1 {
		return fail(409, "LAST_ADMIN", "至少保留一位正常使用的管理员")
	}
	return nil
}
func (s *Service) Update(ctx context.Context, id string, input UpdateInput) (Account, error) {
	if input.Nickname == nil && input.Status == nil && input.Remark == nil {
		return Account{}, users.Invalid("请提供要修改的账号信息")
	}
	var updated dbgen.AdminAccount
	err := s.mutate(ctx, id, func(q *dbgen.Queries, a dbgen.AdminAccount) error {
		if a.DeletedAt.Valid {
			return fail(404, "NOT_FOUND", "管理员已在回收站")
		}
		if input.Nickname != nil {
			value, err := users.NormalizeNickname(*input.Nickname)
			if err != nil {
				return err
			}
			a.Nickname = value
		}
		status := a.Status
		if input.Status != nil {
			status = *input.Status
			if status != "active" && status != "disabled" {
				return users.Invalid("无效状态")
			}
		}
		if input.Remark != nil {
			if utf8.RuneCountInString(*input.Remark) > 500 {
				return users.Invalid("备注不能超过 500 字")
			}
			a.Remark = *input.Remark
		}
		if status == "disabled" {
			if err := protectLast(ctx, q, a); err != nil {
				return err
			}
		}
		var err error
		updated, err = q.UpdateAdminAccount(ctx, dbgen.UpdateAdminAccountParams{ID: id, Nickname: a.Nickname, Status: status, Remark: a.Remark})
		return err
	})
	return View(updated), err
}
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.mutate(ctx, id, func(q *dbgen.Queries, a dbgen.AdminAccount) error {
		if a.DeletedAt.Valid {
			return fail(404, "NOT_FOUND", "管理员已在回收站")
		}
		if err := protectLast(ctx, q, a); err != nil {
			return err
		}
		return q.DeleteAdminAccount(ctx, id)
	})
}
func (s *Service) Restore(ctx context.Context, id string) (Account, error) {
	var restored dbgen.AdminAccount
	err := s.mutate(ctx, id, func(q *dbgen.Queries, _ dbgen.AdminAccount) error {
		var err error
		restored, err = q.RestoreAdminAccount(ctx, id)
		return err
	})
	return View(restored), err
}
func (s *Service) ResetPassword(ctx context.Context, id, password string) error {
	hash, err := passwordHash(password)
	if err != nil {
		return err
	}
	return s.mutate(ctx, id, func(q *dbgen.Queries, a dbgen.AdminAccount) error {
		if !a.Username.Valid || a.DeletedAt.Valid {
			return users.Invalid("该管理员没有可用的密码账号")
		}
		return q.UpdateAdminPassword(ctx, dbgen.UpdateAdminPasswordParams{ID: id, PasswordHash: hash})
	})
}
