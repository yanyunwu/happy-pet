package game

import (
	"testing"
	"time"
)

func TestAnalyticsPeriodUsesShanghaiCalendar(t *testing.T) {
	for _, tc := range []struct {
		instant, from, trend string
		window               string
		days                 int
	}{
		{"2026-10-24T15:59:59Z", "2026-10-18T00:00:00+08:00", "2026-10-18", "7d", 7},
		{"2026-10-24T16:00:00Z", "2026-10-19T00:00:00+08:00", "2026-10-19", "7d", 7},
		{"2026-01-01T00:00:00Z", "2025-12-03T00:00:00+08:00", "2025-12-03", "", 30},
		{"2026-10-24T16:00:00Z", "", "2026-07-28", "all", 90},
	} {
		t.Run(tc.instant+tc.window, func(t *testing.T) {
			now, err := time.Parse(time.RFC3339, tc.instant)
			if err != nil {
				t.Fatal(err)
			}
			period, err := analyticsPeriodFor(tc.window, now)
			if err != nil {
				t.Fatal(err)
			}
			if period.days != tc.days || period.trendStart.Format(time.DateOnly) != tc.trend || !period.to.Equal(now) {
				t.Fatal("incorrect period", period)
			}
			if tc.from == "" {
				if period.from != nil || !period.start.Equal(time.Time{}) {
					t.Fatal("all range must keep history and omit from", period)
				}
			} else if period.from == nil || period.from.Format(time.RFC3339) != tc.from || !period.start.Equal(*period.from) {
				t.Fatal("range did not use local calendar midnight", period)
			}
			if tc.window == "" && period.name != "30d" {
				t.Fatal("default range is not 30d", period.name)
			}
		})
	}
}
