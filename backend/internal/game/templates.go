package game

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/users"
)

type TemplateView struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Layout    Layout    `json:"layout"`
	Version   int32     `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type TemplateInput struct {
	Name    string `json:"name"`
	Layout  Layout `json:"layout"`
	Version int32  `json:"version"`
}

func templateView(row dbgen.LevelTemplate) (TemplateView, error) {
	view := TemplateView{ID: row.ID, Name: row.Name, Version: row.Version, UpdatedAt: row.UpdatedAt}
	err := json.Unmarshal(row.Layout, &view.Layout)
	return view, err
}

func (s *Service) Templates(ctx context.Context) ([]TemplateView, error) {
	rows, err := s.Q.ListLevelTemplates(ctx)
	if err != nil {
		return nil, err
	}
	views := make([]TemplateView, 0, len(rows))
	for _, row := range rows {
		view, err := templateView(row)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) SaveTemplate(ctx context.Context, id string, in TemplateInput) (TemplateView, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 180 {
		return TemplateView{}, users.Invalid("模板名称为 1–180 个字符")
	}
	if err := ValidateLayout(in.Layout); err != nil {
		return TemplateView{}, invalid(err)
	}
	var row dbgen.LevelTemplate
	var err error
	if id == "" {
		row, err = s.Q.CreateLevelTemplate(ctx, dbgen.CreateLevelTemplateParams{ID: users.NewID(), Name: in.Name, Layout: raw(in.Layout)})
	} else {
		if in.Version < 1 {
			return TemplateView{}, users.Invalid("请提供有效的模板版本")
		}
		row, err = s.Q.UpdateLevelTemplate(ctx, dbgen.UpdateLevelTemplateParams{ID: id, Name: in.Name, Layout: raw(in.Layout), Version: in.Version})
		if errors.Is(err, sql.ErrNoRows) {
			return TemplateView{}, s.templateVersionError(ctx, id)
		}
	}
	if err != nil {
		return TemplateView{}, err
	}
	return templateView(row)
}

func (s *Service) DeleteTemplate(ctx context.Context, id string, version int32) error {
	if version < 1 {
		return users.Invalid("请提供有效的模板版本")
	}
	deleted, err := s.Q.DeleteLevelTemplate(ctx, dbgen.DeleteLevelTemplateParams{ID: id, Version: version})
	if err != nil {
		return err
	}
	if deleted == 0 {
		return s.templateVersionError(ctx, id)
	}
	return nil
}

func (s *Service) templateVersionError(ctx context.Context, id string) error {
	if _, err := s.Q.GetLevelTemplate(ctx, id); err != nil {
		return missing(err)
	}
	return conflict("模板已被其他人修改，请刷新后重试")
}
