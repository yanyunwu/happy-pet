package game

import (
	"context"
	"database/sql"
	"time"

	"happy-pet/api/internal/dbgen"
	"happy-pet/api/internal/users"
)

const analyticsTimezone = "Asia/Shanghai"

type LevelAnalyticsLevel struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	Entry               string `json:"entry"`
	Mode                string `json:"mode"`
	Ordinal             int32  `json:"ordinal"`
	PublishedRevisionID string `json:"publishedRevisionId"`
}

type LevelAnalyticsSummary struct {
	Attempts              int64    `json:"attempts"`
	Players               int64    `json:"players"`
	Won                   int64    `json:"won"`
	Lost                  int64    `json:"lost"`
	Abandoned             int64    `json:"abandoned"`
	Unfinished            int64    `json:"unfinished"`
	WinRate               *float64 `json:"winRate"`
	FinishedWinRate       *float64 `json:"finishedWinRate"`
	AvgWinDurationSeconds *float64 `json:"avgWinDurationSeconds"`
	WinDurationSamples    int64    `json:"winDurationSamples"`
	AvgWinMoves           *float64 `json:"avgWinMoves"`
}

type LevelAnalyticsDay struct {
	Date       string   `json:"date"`
	Attempts   int64    `json:"attempts"`
	Won        int64    `json:"won"`
	Lost       int64    `json:"lost"`
	Abandoned  int64    `json:"abandoned"`
	Unfinished int64    `json:"unfinished"`
	WinRate    *float64 `json:"winRate"`
}

type LevelAnalyticsRevision struct {
	ID          string    `json:"id"`
	Version     int32     `json:"version"`
	Title       string    `json:"title"`
	PublishedAt time.Time `json:"publishedAt"`
	Current     bool      `json:"current"`
}

type LevelAnalyticsTool struct {
	Type     string `json:"type"`
	Uses     int64  `json:"uses"`
	Sessions int64  `json:"sessions"`
}

type LevelAnalyticsResult struct {
	Level       LevelAnalyticsLevel      `json:"level"`
	Range       string                   `json:"range"`
	RevisionID  string                   `json:"revisionId"`
	From        *time.Time               `json:"from"`
	To          time.Time                `json:"to"`
	TrendFrom   string                   `json:"trendFrom"`
	Timezone    string                   `json:"timezone"`
	GeneratedAt time.Time                `json:"generatedAt"`
	Summary     LevelAnalyticsSummary    `json:"summary"`
	Daily       []LevelAnalyticsDay      `json:"daily"`
	Revisions   []LevelAnalyticsRevision `json:"revisions"`
	Tools       []LevelAnalyticsTool     `json:"tools"`
}

type analyticsPeriod struct {
	name       string
	from       *time.Time
	start      time.Time
	to         time.Time
	trendStart time.Time
	days       int
}

func analyticsPeriodFor(name string, now time.Time) (analyticsPeriod, error) {
	if name == "" {
		name = "30d"
	}
	period := analyticsPeriod{name: name, to: now}
	switch name {
	case "7d":
		period.days = 7
	case "30d":
		period.days = 30
	case "90d", "all":
		period.days = 90
	default:
		return analyticsPeriod{}, users.Invalid("统计范围仅支持 7d、30d、90d 或 all")
	}
	local := now.In(time.FixedZone(analyticsTimezone, 8*3600))
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
	period.trendStart = today.AddDate(0, 0, -(period.days - 1))
	if name != "all" {
		period.start = period.trendStart
		period.from = &period.start
	}
	return period, nil
}

func analyticsPercentage(numerator, denominator int64) *float64 {
	if denominator == 0 {
		return nil
	}
	value := float64(numerator) / float64(denominator) * 100
	return &value
}

// LevelAnalytics uses a session-start cohort. Unfinished sessions stay separate
// from losses, and duration measures elapsed wall time including idle time.
func (s *Service) LevelAnalytics(ctx context.Context, levelID, rangeName, revisionID string) (LevelAnalyticsResult, error) {
	period, err := analyticsPeriodFor(rangeName, time.Now().UTC())
	if err != nil {
		return LevelAnalyticsResult{}, err
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return LevelAnalyticsResult{}, err
	}
	defer tx.Rollback()
	q := s.Q.WithTx(tx)
	level, err := q.GetLevel(ctx, levelID)
	if err != nil {
		return LevelAnalyticsResult{}, missing(err)
	}
	revisions, err := q.ListLevelAnalyticsRevisions(ctx, levelID)
	if err != nil {
		return LevelAnalyticsResult{}, err
	}
	result := LevelAnalyticsResult{
		Level: LevelAnalyticsLevel{
			ID: level.ID, Title: level.Title, Entry: level.Entry, Mode: level.Mode, Ordinal: level.Ordinal, PublishedRevisionID: level.PublishedRevision.String,
		},
		Range: period.name, RevisionID: revisionID, From: period.from, To: period.to,
		TrendFrom: period.trendStart.Format(time.DateOnly), Timezone: analyticsTimezone, GeneratedAt: period.to,
		Daily: make([]LevelAnalyticsDay, 0, period.days), Revisions: make([]LevelAnalyticsRevision, 0, len(revisions)), Tools: make([]LevelAnalyticsTool, 0, 5),
	}
	validRevision := revisionID == ""
	for _, revision := range revisions {
		validRevision = validRevision || revision.ID == revisionID
		result.Revisions = append(result.Revisions, LevelAnalyticsRevision{
			ID: revision.ID, Version: revision.Version, Title: revision.Title, PublishedAt: revision.CreatedAt, Current: revision.ID == level.PublishedRevision.String,
		})
	}
	if !validRevision {
		return LevelAnalyticsResult{}, users.Invalid("请选择该关卡已发布的版本")
	}
	aggregate, err := q.LevelAnalyticsSummary(ctx, dbgen.LevelAnalyticsSummaryParams{
		LevelID: levelID, RevisionID: revisionID, StartedFrom: period.start, StartedBefore: period.to,
	})
	if err != nil {
		return LevelAnalyticsResult{}, err
	}
	result.Summary = LevelAnalyticsSummary{
		Attempts: aggregate.Attempts, Players: aggregate.Players, Won: aggregate.Won, Lost: aggregate.Lost,
		Abandoned: aggregate.Abandoned, Unfinished: aggregate.Unfinished, WinDurationSamples: aggregate.WinDurationSamples,
		WinRate:         analyticsPercentage(aggregate.Won, aggregate.Attempts),
		FinishedWinRate: analyticsPercentage(aggregate.Won, aggregate.Won+aggregate.Lost+aggregate.Abandoned),
	}
	if aggregate.WinDurationSamples > 0 {
		result.Summary.AvgWinDurationSeconds = &aggregate.AvgWinDurationSeconds
	}
	if aggregate.WinMoveSamples > 0 {
		result.Summary.AvgWinMoves = &aggregate.AvgWinMoves
	}
	days, err := q.LevelAnalyticsDaily(ctx, dbgen.LevelAnalyticsDailyParams{
		LevelID: levelID, RevisionID: revisionID, StartedFrom: period.trendStart, StartedBefore: period.to,
	})
	if err != nil {
		return LevelAnalyticsResult{}, err
	}
	byDay := make(map[string]dbgen.LevelAnalyticsDailyRow, len(days))
	for _, day := range days {
		byDay[day.Day] = day
	}
	for i := 0; i < period.days; i++ {
		date := period.trendStart.AddDate(0, 0, i).Format(time.DateOnly)
		day := byDay[date]
		result.Daily = append(result.Daily, LevelAnalyticsDay{
			Date: date, Attempts: day.Attempts, Won: day.Won, Lost: day.Lost, Abandoned: day.Abandoned, Unfinished: day.Unfinished,
			WinRate: analyticsPercentage(day.Won, day.Attempts),
		})
	}
	toolRows, err := q.LevelAnalyticsTools(ctx, dbgen.LevelAnalyticsToolsParams{
		LevelID: levelID, RevisionID: revisionID, StartedFrom: period.start, StartedBefore: period.to,
	})
	if err != nil {
		return LevelAnalyticsResult{}, err
	}
	byTool := make(map[string]dbgen.LevelAnalyticsToolsRow, len(toolRows))
	for _, tool := range toolRows {
		byTool[tool.ToolType] = tool
	}
	for _, kind := range []string{"undo", "shovel", "hint", "shuffle", "unlock_slot"} {
		tool := byTool[kind]
		result.Tools = append(result.Tools, LevelAnalyticsTool{Type: kind, Uses: tool.Uses, Sessions: tool.Sessions})
	}
	return result, tx.Commit()
}
