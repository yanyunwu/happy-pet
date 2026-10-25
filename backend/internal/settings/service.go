package settings

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/users"
)

const announcementKey = "announcement"

type Service struct {
	q *dbgen.Queries
}

type View struct {
	Announcement string    `json:"announcement"`
	Version      int32     `json:"version"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type announcementValue struct {
	Content string `json:"content"`
}

func New(db *sql.DB) *Service { return &Service{q: dbgen.New(db)} }

func view(row dbgen.AppSetting) (View, error) {
	var value announcementValue
	if err := json.Unmarshal(row.Value, &value); err != nil {
		return View{}, err
	}
	return View{Announcement: value.Content, Version: row.Version, UpdatedAt: row.UpdatedAt}, nil
}

func (s *Service) Get(ctx context.Context) (View, error) {
	row, err := s.q.GetAppSetting(ctx, announcementKey)
	if err != nil {
		return View{}, err
	}
	return view(row)
}

func (s *Service) Save(ctx context.Context, content string, version int32) (View, error) {
	if version < 1 {
		return View{}, users.Invalid("请提供有效的设置版本")
	}
	content = strings.ReplaceAll(strings.ReplaceAll(content, "\r\n", "\n"), "\r", "\n")
	if utf8.RuneCountInString(content) > 2000 {
		return View{}, users.Invalid("公告不能超过 2000 个字符")
	}
	for _, char := range content {
		if unicode.IsControl(char) && char != '\n' && char != '\t' {
			return View{}, users.Invalid("公告不能包含控制字符")
		}
	}
	value, err := json.Marshal(announcementValue{Content: content})
	if err != nil {
		return View{}, err
	}
	row, err := s.q.UpdateAppSetting(ctx, dbgen.UpdateAppSettingParams{Key: announcementKey, Value: value, Version: version})
	if errors.Is(err, sql.ErrNoRows) {
		return View{}, &users.Error{Status: 409, Code: "CONFLICT", Message: "公告已被其他管理员更新，请刷新后重试"}
	}
	if err != nil {
		return View{}, err
	}
	return view(row)
}
